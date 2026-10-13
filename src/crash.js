// Rocket (crash): the player bets coins, the multiplier grows from 1.00x until the rocket explodes;
// "cash out" before that pays bet × multiplier, otherwise the bet is lost. The explosion point is
// drawn when the round starts, the same way for every bet and every player:
// P(the rocket reaches x) = (1 − edge) / x. The server's clock decides what a cash-out gets.
import { GameError, cryptoRng } from './game.js';

/** Multiplier growth: e^(speed · ms) — 2x after ~8.7 s, 10x after ~29 s (same formula in the app). */
export const CRASH_SPEED = 0.00008;

/** Multiplier after `ms` of flight (2 decimals, rounded down). */
export function crashMultAt(ms) {
  if (!(ms > 0)) return 1;
  return Math.floor(Math.exp(CRASH_SPEED * ms) * 100 + 1e-6) / 100; // + 1e-6: float error at exactly x
}

/** Milliseconds of flight until the multiplier reaches `m`. */
export function crashTimeOf(m) {
  return m > 1 ? Math.log(m) / CRASH_SPEED : 0;
}

/** Explosion point for a uniform `u` in [0, 1): (1 − edge) / (1 − u), 2 decimals, from 1.00x up to `max`. */
export function crashPoint(u, edgePct, max) {
  const x = Math.floor((100 - edgePct) / (1 - u)) / 100;
  return Math.min(max, Math.max(1, x));
}

export function createCrash({ db, settings, game, rng = cryptoRng, now = () => Date.now() }) {
  // long polls waiting for a rocket: woken up by a cash-out (and when the server stops)
  const waiters = new Map(); // round id -> Set of wake functions
  let closed = false;
  function wake(id) {
    const set = waiters.get(id);
    if (!set) return;
    waiters.delete(id);
    for (const f of set) f();
  }
  function sleepFor(id, ms) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        const set = waiters.get(id);
        if (set) {
          set.delete(done);
          if (!set.size) waiters.delete(id);
        }
        resolve();
      };
      const timer = setTimeout(done, ms);
      if (!waiters.has(id)) waiters.set(id, new Set());
      waiters.get(id).add(done);
    });
  }

  function config() {
    return {
      edge: settings.get('crash_edge'),
      minBet: settings.get('crash_min_bet'),
      maxBet: settings.get('crash_max_bet'),
      maxMult: settings.get('crash_max_mult'),
    };
  }

  /** What the app gets (the explosion point only once the rocket has exploded). */
  function view(r) {
    const kind = r.bet_kind || 'coins';
    const out = { id: Number(r.id), bet: Number(r.bet), kind, status: r.status };
    if (kind === 'brainrots' && r.bet_items) out.betItems = r.bet_items;
    if (r.status === 'flying') out.elapsed = Math.max(0, now() - Number(r.started_ms));
    if (r.status === 'cashed') {
      out.mult = Number(r.cash_mult);
      out.win = Number(r.win); // the total value won
      if (kind === 'brainrots') {
        out.item = r.win_item || null; // the brainrot handed out (null if the win was too small for any)
        out.coins = Number(r.win) - (r.win_item ? Number(r.win_item.value) : 0); // the rest in coins
      }
    }
    if (r.status === 'crashed') out.crashPoint = Number(r.crash_point);
    return out;
  }

  /** The ids the player wants to stake, cleaned (1..12 distinct positive ints) or null. */
  function parseIds(ids) {
    if (ids === undefined || ids === null) return null;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 12) throw new GameError('bad_request');
    const list = [...new Set(ids.map(Number))];
    if (list.length !== ids.length || list.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new GameError('bad_request');
    return list;
  }

  /** The most valuable enabled brainrot worth no more than `value` (null if none). */
  function bestItem(value) {
    let best = null;
    for (const it of game.catalog.items.values()) {
      if (it.enabled && it.value <= value && (!best || it.value > best.value)) best = it;
    }
    return best;
  }
  const itemEntry = (it) => ({ itemId: it.id, name: it.name, value: it.value, emoji: it.emoji, rarity: it.rarity });

  const exploded = (r) => now() - Number(r.started_ms) >= crashTimeOf(Number(r.crash_point));

  /** Marks a flying round whose rocket has already exploded (the player didn't cash out in time). */
  async function settle(cl, r) {
    if (r.status !== 'flying' || !exploded(r)) return r;
    const u = await cl.query("UPDATE bs_crash SET status = 'crashed' WHERE id = $1 RETURNING *", [r.id]);
    return u.rows[0];
  }

  async function start(user, body = {}) {
    const c = config();
    const ids = parseIds(body.ids);
    const point = crashPoint(rng.int(1_000_000_000) / 1_000_000_000, c.edge, c.maxMult);
    const res = await db.tx(async (cl) => {
      await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [user.id]);
      const open = (await cl.query("SELECT * FROM bs_crash WHERE user_id = $1 AND status = 'flying' FOR UPDATE", [user.id])).rows[0];
      if (open && (await settle(cl, open)).status === 'flying') throw new GameError('crash_active', 409, { round: view(open) });

      let bet;
      let kind = 'coins';
      let items = null;
      if (ids) {
        // brainrots: take them out of the inventory, the bet is their total value
        kind = 'brainrots';
        const inv = await cl.query('SELECT id, item_id FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE', [user.id, ids]);
        if (inv.rowCount !== ids.length) throw new GameError('items_missing');
        const got = inv.rows.map((x) => game.catalog.items.get(x.item_id)).filter(Boolean);
        bet = got.reduce((sum, it) => sum + it.value, 0);
        if (bet < c.minBet || bet > c.maxBet) throw new GameError('bad_bet', 400, { min: c.minBet, max: c.maxBet });
        await cl.query('DELETE FROM bs_inventory WHERE id = ANY($1::bigint[])', [ids]);
        items = got.map(itemEntry);
      } else {
        // coins
        bet = typeof body.bet === 'string' && body.bet.trim() !== '' ? Number(body.bet) : body.bet;
        if (!Number.isSafeInteger(bet) || bet < c.minBet || bet > c.maxBet) throw new GameError('bad_bet', 400, { min: c.minBet, max: c.maxBet });
        const u = (await cl.query('SELECT balance FROM bs_users WHERE id = $1', [user.id])).rows[0];
        if (u.balance < bet) throw new GameError('not_enough', 400, { balance: u.balance });
        await cl.query('UPDATE bs_users SET balance = balance - $2 WHERE id = $1', [user.id, bet]);
      }
      const row = (
        await cl.query(
          'INSERT INTO bs_crash (user_id, bet, crash_point, started_ms, bet_kind, bet_items) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *',
          [user.id, bet, point, Math.floor(now()), kind, items ? JSON.stringify(items) : null],
        )
      ).rows[0];
      if (kind === 'coins') await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [user.id, -bet, `crash:#${row.id}`]);
      const bal = (await cl.query('SELECT balance FROM bs_users WHERE id = $1', [user.id])).rows[0].balance;
      return { row, balance: bal };
    });
    return { round: view(res.row), balance: res.balance };
  }

  async function cashout(user, id) {
    return db.tx(async (cl) => {
      await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [user.id]);
      let r = (await cl.query('SELECT * FROM bs_crash WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, user.id])).rows[0];
      if (!r) throw new GameError('not_found', 404);
      r = await settle(cl, r);
      if (r.status === 'flying') {
        const mult = crashMultAt(now() - Number(r.started_ms));
        const win = Math.floor(Number(r.bet) * mult);
        if ((r.bet_kind || 'coins') === 'brainrots') {
          // hand out the most valuable brainrot worth no more than the win, the rest as coins
          const it = bestItem(win);
          const coins = win - (it ? it.value : 0);
          r = (await cl.query("UPDATE bs_crash SET status = 'cashed', cash_mult = $2, win = $3, win_item = $4::jsonb WHERE id = $1 RETURNING *", [r.id, mult, win, it ? JSON.stringify(itemEntry(it)) : null])).rows[0];
          if (it) await game.giveItem(cl, user.id, it, 'crash', { ref: r.id });
          if (coins > 0) {
            await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1', [user.id, coins]);
            await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [user.id, coins, `crash:#${r.id}`]);
          }
        } else {
          r = (await cl.query("UPDATE bs_crash SET status = 'cashed', cash_mult = $2, win = $3 WHERE id = $1 RETURNING *", [r.id, mult, win])).rows[0];
          await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1', [user.id, win]);
          await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [user.id, win, `crash:#${r.id}`]);
        }
      }
      const bal = (await cl.query('SELECT balance FROM bs_users WHERE id = $1', [user.id])).rows[0].balance;
      return { round: view(r), balance: bal };
    }).finally(() => wake(id));
  }

  /** Long poll: answers when the rocket explodes (or after `maxMs`, if it is still flying). */
  async function wait(user, id, { maxMs = 20_000 } = {}) {
    const r = await db.one('SELECT * FROM bs_crash WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!r) throw new GameError('not_found', 404);
    if (r.status === 'flying') {
      const left = crashTimeOf(Number(r.crash_point)) - (now() - Number(r.started_ms));
      if (left > 0 && !closed) await sleepFor(r.id, Math.min(Math.ceil(left), maxMs));
      if (closed) return { round: view(r) };
    }
    return db.tx(async (cl) => {
      const cur = (await cl.query('SELECT * FROM bs_crash WHERE id = $1 FOR UPDATE', [id])).rows[0];
      return { round: view(await settle(cl, cur)) };
    });
  }

  /** The player's round in the air (after a reload), or null. */
  async function active(user) {
    return db.tx(async (cl) => {
      const r = (await cl.query("SELECT * FROM bs_crash WHERE user_id = $1 AND status = 'flying' FOR UPDATE", [user.id])).rows[0];
      if (!r) return null;
      const s = await settle(cl, r);
      return s.status === 'flying' ? view(s) : null;
    });
  }

  /** For the app: limits and how fast the multiplier grows. */
  function publicConfig() {
    const c = config();
    return { minBet: c.minBet, maxBet: c.maxBet, maxMult: c.maxMult, speed: CRASH_SPEED };
  }

  /** Server stopping: answer the waiting long polls now. */
  function close() {
    closed = true;
    for (const id of [...waiters.keys()]) wake(id);
  }

  return { start, cashout, wait, active, publicConfig, config, close };
}
