// Colour dice: the player picks one of six colours and stakes coins or brainrots; three dice with a
// colour on every side are thrown. Two dice of one colour (a pair, whatever the colour) lose the
// throw; otherwise the colour on 1 / 3 of the dice pays ×2 / ×4 (the stake included), on none the
// stake is lost. Fair dice: each shows every colour with the same chance, so the game gives back
// (60 × 2 + 1 × 4) / 216 = 124 / 216 ≈ 57.4 % on average.
import { GameError, cryptoRng } from './game.js';

export const DICE_COLORS = ['red', 'yellow', 'green', 'blue', 'purple', 'orange'];
/** What a stake is multiplied by for 0, 1, 2, 3 dice showing the colour (two of a colour is a pair). */
export const DICE_PAYS = [0, 2, 0, 4];
/** Exactly two of the three dice show the same colour: the throw is lost. */
export const isPair = (dice) => new Set(dice).size === 2;

/** The ids the player wants to stake, cleaned (1..12 distinct positive ints) or null. */
export function parseStakeIds(ids) {
  if (ids === undefined || ids === null) return null;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 12) throw new GameError('bad_request');
  const list = [...new Set(ids.map(Number))];
  if (list.length !== ids.length || list.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new GameError('bad_request');
  return list;
}

export function createDice({ db, settings, game, rng = cryptoRng }) {
  const config = () => ({ minBet: settings.get('dice_min_bet'), maxBet: settings.get('dice_max_bet') });

  /** The most valuable enabled brainrot worth no more than `value` (null if none). */
  function bestItem(value) {
    let best = null;
    for (const it of game.catalog.items.values()) {
      if (it.enabled && it.value <= value && (!best || it.value > best.value)) best = it;
    }
    return best;
  }
  const itemEntry = (it) => ({ itemId: it.id, name: it.name, value: it.value, emoji: it.emoji, rarity: it.rarity });

  /** What the app gets for a throw. */
  function view(r) {
    const kind = r.bet_kind || 'coins';
    const out = { id: Number(r.id), color: r.color, dice: r.dice, matches: r.matches, mult: r.mult, bet: Number(r.bet), win: Number(r.win), kind };
    if (kind === 'brainrots') {
      out.betItems = r.bet_items || [];
      out.item = r.win_item || null; // the brainrot handed out (null if the win was too small for any)
      out.coins = Number(r.win) - (r.win_item ? Number(r.win_item.value) : 0); // the rest in coins
    }
    return out;
  }

  /** One throw: `color` and either `bet` (coins) or `ids` (brainrots from the inventory). */
  async function roll(user, body = {}) {
    const color = String(body.color ?? '');
    if (!DICE_COLORS.includes(color)) throw new GameError('bad_request');
    const ids = parseStakeIds(body.ids);
    const c = config();
    return db.tx(async (cl) => {
      await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [user.id]);
      let bet;
      let kind = 'coins';
      let items = null;
      if (ids) {
        // brainrots: they leave the inventory, the stake is their total value
        kind = 'brainrots';
        const inv = await cl.query('SELECT id, item_id FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE', [user.id, ids]);
        if (inv.rowCount !== ids.length) throw new GameError('items_missing');
        const got = inv.rows.map((x) => game.catalog.items.get(x.item_id)).filter(Boolean);
        bet = got.reduce((sum, it) => sum + it.value, 0);
        if (bet < c.minBet || bet > c.maxBet) throw new GameError('bad_bet', 400, { min: c.minBet, max: c.maxBet });
        await cl.query('DELETE FROM bs_inventory WHERE id = ANY($1::bigint[])', [ids]);
        items = got.map(itemEntry);
      } else {
        bet = typeof body.bet === 'string' && body.bet.trim() !== '' ? Number(body.bet) : body.bet;
        if (!Number.isSafeInteger(bet) || bet < c.minBet || bet > c.maxBet) throw new GameError('bad_bet', 400, { min: c.minBet, max: c.maxBet });
        const u = (await cl.query('SELECT balance FROM bs_users WHERE id = $1', [user.id])).rows[0];
        if (Number(u.balance) < bet) throw new GameError('not_enough', 400, { balance: u.balance });
        await cl.query('UPDATE bs_users SET balance = balance - $2 WHERE id = $1', [user.id, bet]);
      }
      // three fair dice
      const dice = [0, 1, 2].map(() => DICE_COLORS[rng.int(DICE_COLORS.length)]);
      const matches = dice.filter((d) => d === color).length;
      const mult = isPair(dice) ? 0 : DICE_PAYS[matches];
      const win = bet * mult;
      const best = kind === 'brainrots' && win > 0 ? bestItem(win) : null;
      let r = (
        await cl.query(
          `INSERT INTO bs_dice (user_id, color, bet, bet_kind, bet_items, dice, matches, mult, win, win_item)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, $8, $9, $10::jsonb) RETURNING *`,
          [user.id, color, bet, kind, items ? JSON.stringify(items) : null, dice, matches, mult, win, best ? JSON.stringify(itemEntry(best)) : null],
        )
      ).rows[0];
      const log = (delta) => cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [user.id, delta, `dice:#${r.id}`]);
      if (kind === 'coins') {
        await log(-bet);
        if (win > 0) {
          await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1', [user.id, win]);
          await log(win);
        }
      } else if (win > 0) {
        // the most valuable brainrot worth no more than the win, the rest as coins
        if (best) await game.giveItem(cl, user.id, best, 'dice', { ref: r.id });
        const coins = win - (best ? best.value : 0);
        if (coins > 0) {
          await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1', [user.id, coins]);
          await log(coins);
        }
      }
      r = { ...r, dice: r.dice.slice() };
      const bal = (await cl.query('SELECT balance FROM bs_users WHERE id = $1', [user.id])).rows[0].balance;
      return { roll: view(r), balance: bal };
    });
  }

  /** For the app: the limits, the colours and what 0 / 1 / 2 / 3 dice pay (2 = a pair, lost). */
  function publicConfig() {
    const c = config();
    return { minBet: c.minBet, maxBet: c.maxBet, colors: DICE_COLORS, pays: DICE_PAYS };
  }

  return { roll, publicConfig, config };
}
