// Giveaways, like on Case Battle: every day and every week a brainrot is raffled among the players who
// joined. To join, a player tops up at least `min_topup` coins while the giveaway runs (Telegram Stars,
// coins credited and brainrots given for a deposit request; several top-ups add up) and presses
// «Участвовать». When the time is up, one of those who joined wins at random (each the same chance):
// the brainrot goes to their inventory, the bot tells them, the winner is shown under the giveaway, and
// the next giveaway of that kind starts right away (if the main admin keeps it on).
import { GameError, displayName, cryptoRng } from './game.js';
import { T } from './texts.js';

/** How long a giveaway of each kind runs (ms). */
export const KINDS = { day: 86_400_000, week: 7 * 86_400_000 };
const KIND_LIST = Object.keys(KINDS);
const PERIOD_SQL = { day: '1 day', week: '7 days' };
const WINNERS_SHOWN = 3;
const MIN_TOPUP_MAX = 100_000_000;

/**
 * Once per database: the daily giveaway of a Garama and Madundung and the weekly one of a Dragon
 * Cannelloni, for players who topped up at least 100 coins (50 ⭐) / 500 coins (250 ⭐) meanwhile.
 * After that the main admin changes or stops them in the admin panel.
 */
export async function giveawaysOnce(db, settings) {
  if (settings.get('_giveaways_1')) return false;
  const plan = [
    ['day', 'garama and madundung', 100],
    ['week', 'dragon cannelloni', 500],
  ];
  for (const [kind, name, min] of plan) {
    const it = await db.one('SELECT id FROM bs_items WHERE lower(name) = $1 ORDER BY id LIMIT 1', [name]);
    await db.query(
      `INSERT INTO bs_giveaway_plans (kind, active, item_id, min_topup) VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind) DO NOTHING`,
      [kind, !!it, it ? it.id : null, min],
    );
  }
  await settings.setInternal('_giveaways_1', true);
  return true;
}

export function createGiveaways({ db, game, tg, config = {}, rng = cryptoRng, tickMs = 30_000 }) {
  const item = (id) => game.publicItem(game.catalog.items.get(Number(id)));

  /** What a player topped up since `from` (coins; Stars, coins credited, brainrots given). */
  async function toppedUp(q, userId, from) {
    const r = await q.query('SELECT coalesce(sum(value), 0)::bigint AS n FROM bs_topups WHERE user_id = $1 AND created_at >= $2', [userId, from]);
    return Number(r.rows[0].n);
  }

  /** A top-up of `value` coins (inside its transaction): counted for the giveaways running now. */
  async function topup(cl, userId, value, requestId = null) {
    const v = Math.floor(Number(value) || 0);
    if (v < 1) return;
    await cl.query('INSERT INTO bs_topups (user_id, request_id, value) VALUES ($1, $2, $3)', [userId, requestId, v]);
  }

  /** Starts the giveaway of every kind that is on and has none running (one at a time per kind). */
  async function ensure() {
    await db.query(
      `INSERT INTO bs_giveaways (kind, item_id, min_topup, starts_at, ends_at)
       SELECT p.kind, p.item_id, p.min_topup, now(), now() + (CASE p.kind WHEN 'week' THEN interval '7 days' ELSE interval '1 day' END)
         FROM bs_giveaway_plans p
        WHERE p.active AND p.item_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM bs_giveaways g WHERE g.kind = p.kind AND g.status = 'open')
       ON CONFLICT (kind) WHERE status = 'open' DO NOTHING`,
    );
  }

  /**
   * Draws one giveaway whose time is up: a random player of those who joined wins its brainrot. Then
   * the next one of that kind starts where this one ended (the same time of day), or now if the server
   * was off for longer than a whole period. Several servers at once: only one of them draws it.
   */
  async function draw(id) {
    const res = await db.tx(async (cl) => {
      const g = (await cl.query("SELECT * FROM bs_giveaways WHERE id = $1 AND status = 'open' AND ends_at <= now() FOR UPDATE SKIP LOCKED", [id])).rows[0];
      if (!g) return null;
      // banned players don't win; the entries are in a fixed order, so only the random number picks
      const entries = (
        await cl.query(
          `SELECT e.user_id, u.lang FROM bs_giveaway_entries e JOIN bs_users u ON u.id = e.user_id
            WHERE e.giveaway_id = $1 AND NOT u.is_banned ORDER BY e.created_at, e.user_id`,
          [id],
        )
      ).rows;
      const it = game.catalog.items.get(Number(g.item_id));
      let winner = null;
      let invId = null;
      if (entries.length && it) {
        winner = entries[rng.int(entries.length)];
        invId = await game.giveItem(cl, winner.user_id, it, 'giveaway', { ref: g.id });
      } else if (entries.length) console.error(`[giveaways] #${g.id}: brainrot ${g.item_id} not found, nobody gets it`);
      await cl.query("UPDATE bs_giveaways SET status = 'done', winner_id = $2, inv_id = $3, entries = $4, drawn_at = now() WHERE id = $1", [
        g.id,
        winner ? winner.user_id : null,
        invId,
        entries.length,
      ]);
      await cl.query(
        `INSERT INTO bs_giveaways (kind, item_id, min_topup, starts_at, ends_at)
         SELECT p.kind, p.item_id, p.min_topup, s.at, s.at + $3::interval
           FROM bs_giveaway_plans p,
                LATERAL (SELECT CASE WHEN $2::timestamptz + $3::interval > now() THEN $2::timestamptz ELSE now() END AS at) s
          WHERE p.kind = $1 AND p.active AND p.item_id IS NOT NULL
         ON CONFLICT (kind) WHERE status = 'open' DO NOTHING`,
        [g.kind, g.ends_at, PERIOD_SQL[g.kind]],
      );
      return { g, winner, it };
    });
    if (res && res.winner && res.it) await tellWinner(res.g, res.winner, res.it);
    return res;
  }

  async function tellWinner(g, w, it) {
    const t = T(w.lang);
    const https = /^https:\/\//.test(config.webUrl || '');
    const extra = https ? { reply_markup: { inline_keyboard: [[{ text: t.btnInventory, web_app: { url: `${config.webUrl}/?go=profile` } }]] } } : {};
    const sent = await tg.send(w.user_id, t.giveawayWon(g.kind, g.id, it.name, it.value), extra);
    if (!sent.ok && sent.code === 403) await db.query('UPDATE bs_users SET blocked_bot = TRUE WHERE id = $1', [w.user_id]).catch(() => {});
  }

  let busy = null;
  /** Draws the giveaways whose time is up and starts the ones that should run. */
  function tick() {
    if (!busy) {
      busy = (async () => {
        try {
          const due = await db.many("SELECT id FROM bs_giveaways WHERE status = 'open' AND ends_at <= now() ORDER BY ends_at, id");
          for (const d of due) await draw(d.id);
          await ensure();
        } finally {
          busy = null;
        }
      })();
    }
    return busy;
  }

  let timer = null;
  /** Draws what is due now and then every `tickMs` (0: never by itself). */
  function start() {
    if (timer || !tickMs) return;
    const run = () => tick().catch((e) => console.warn('[giveaways] tick failed:', e.message));
    run();
    timer = setInterval(run, tickMs);
    timer.unref?.();
  }
  /** Stops the timer; a draw going on finishes first. */
  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (busy) await busy.catch(() => {});
  }

  // ------------------------------------------------------------ what players see
  const OPEN_SQL = `SELECT g.id, g.kind, g.item_id, g.min_topup, g.starts_at, g.ends_at, (g.ends_at <= now()) AS over
                      FROM bs_giveaways g WHERE g.status = 'open' ORDER BY CASE g.kind WHEN 'day' THEN 0 ELSE 1 END`;

  /** The giveaways running now; the ones whose time is up are drawn first. */
  async function openRounds() {
    let rows = await db.many(OPEN_SQL);
    if (rows.some((r) => r.over)) {
      await tick();
      rows = await db.many(OPEN_SQL);
    }
    return rows.filter((r) => !r.over && item(r.item_id));
  }

  /** The last winners of each kind: the player's name, when, which giveaway, what they won. */
  async function winners(kinds) {
    const rows = await db.many(
      `SELECT w.* FROM unnest($1::text[]) k(kind),
         LATERAL (SELECT g.id, g.kind, g.item_id, g.drawn_at, u.id AS uid, u.first_name, u.username
                    FROM bs_giveaways g JOIN bs_users u ON u.id = g.winner_id
                   WHERE g.kind = k.kind AND g.status = 'done' AND g.winner_id IS NOT NULL
                   ORDER BY g.id DESC LIMIT ${WINNERS_SHOWN}) w`,
      [kinds],
    );
    const out = Object.fromEntries(kinds.map((k) => [k, []]));
    for (const r of rows) {
      out[r.kind].push({ id: Number(r.id), at: r.drawn_at, name: displayName({ id: r.uid, first_name: r.first_name, username: r.username }), item: item(r.item_id) });
    }
    return out;
  }

  /** For the cases screen: the giveaways running now, their prize and when they end. */
  async function brief() {
    return (await openRounds()).map((r) => ({ id: Number(r.id), kind: r.kind, item: item(r.item_id), endsAt: r.ends_at }));
  }

  /** The giveaways page: each giveaway, its condition, how many joined, whether the player did, and its last winners. */
  async function list(user) {
    const rows = await openRounds();
    const ids = rows.map((r) => r.id);
    const mine = rows.length
      ? new Set((await db.many('SELECT giveaway_id FROM bs_giveaway_entries WHERE user_id = $1 AND giveaway_id = ANY($2::bigint[])', [user.id, ids])).map((r) => Number(r.giveaway_id)))
      : new Set();
    const counts = new Map(
      rows.length
        ? (await db.many('SELECT giveaway_id, count(*)::int AS n FROM bs_giveaway_entries WHERE giveaway_id = ANY($1::bigint[]) GROUP BY giveaway_id', [ids])).map((r) => [Number(r.giveaway_id), r.n])
        : [],
    );
    const won = await winners(KIND_LIST);
    return {
      giveaways: rows.map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        item: item(r.item_id),
        min: Number(r.min_topup),
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        entries: counts.get(Number(r.id)) || 0,
        joined: mine.has(Number(r.id)),
        winners: won[r.kind],
      })),
    };
  }

  /**
   * «Участвовать»: the player joins if they topped up at least the minimum since the giveaway began;
   * otherwise the error says how much is left. Admins don't take part. Joining twice changes nothing.
   */
  async function join(user, id) {
    const gid = Number(id);
    if (!Number.isSafeInteger(gid) || gid < 1) throw new GameError('not_found', 404);
    if (user.is_admin) throw new GameError('giveaway_admin');
    await db.tx(async (cl) => {
      // the draw locks the giveaway: a player who presses at the last second either joins before it or gets «over»
      const g = (await cl.query('SELECT id, status, min_topup, starts_at, (ends_at <= now()) AS over FROM bs_giveaways WHERE id = $1 FOR SHARE', [gid])).rows[0];
      if (!g) throw new GameError('not_found', 404);
      if (g.status !== 'open' || g.over) throw new GameError('giveaway_over');
      const had = await cl.query('SELECT 1 FROM bs_giveaway_entries WHERE giveaway_id = $1 AND user_id = $2', [gid, user.id]);
      if (had.rowCount) return;
      const topped = await toppedUp(cl, user.id, g.starts_at);
      const min = Number(g.min_topup);
      if (topped < min) throw new GameError('giveaway_topup', 400, { left: min - topped, min, topped });
      await cl.query('INSERT INTO bs_giveaway_entries (giveaway_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, user.id]);
    });
    return list(user);
  }

  // ------------------------------------------------------------ the admin panel
  function cleanPlan(body) {
    const b = body || {};
    if (typeof b.active !== 'boolean') throw new GameError('bad_field', 400, { field: 'active' });
    const itemId = typeof b.itemId === 'string' && b.itemId.trim() !== '' ? Number(b.itemId) : b.itemId;
    if (!Number.isSafeInteger(itemId) || !game.catalog.items.get(itemId)) throw new GameError('bad_field', 400, { field: 'itemId' });
    const min = typeof b.min === 'string' && b.min.trim() !== '' ? Number(b.min) : b.min;
    if (!Number.isSafeInteger(min) || min < 0 || min > MIN_TOPUP_MAX) throw new GameError('bad_field', 400, { field: 'min' });
    return { active: b.active, itemId, min };
  }

  /**
   * The main admin changes a kind: on / off, the brainrot, the minimum top-up. A giveaway running now
   * that nobody joined yet takes the change at once (switched off — it stops); one with players goes on
   * as it was and the change counts from the next one.
   */
  async function setPlan(kind, body) {
    if (!KIND_LIST.includes(kind)) throw new GameError('not_found', 404);
    const p = cleanPlan(body);
    await db.tx(async (cl) => {
      await cl.query(
        `INSERT INTO bs_giveaway_plans (kind, active, item_id, min_topup, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (kind) DO UPDATE SET active = EXCLUDED.active, item_id = EXCLUDED.item_id, min_topup = EXCLUDED.min_topup, updated_at = now()`,
        [kind, p.active, p.itemId, p.min],
      );
      const g = (await cl.query("SELECT id, (SELECT count(*)::int FROM bs_giveaway_entries e WHERE e.giveaway_id = g.id) AS n FROM bs_giveaways g WHERE kind = $1 AND status = 'open' FOR UPDATE", [kind])).rows[0];
      if (g && g.n === 0) {
        if (p.active) await cl.query('UPDATE bs_giveaways SET item_id = $2, min_topup = $3 WHERE id = $1', [g.id, p.itemId, p.min]);
        else await cl.query("UPDATE bs_giveaways SET status = 'done', entries = 0, drawn_at = now(), ends_at = LEAST(ends_at, now()) WHERE id = $1", [g.id]);
      }
    });
    await ensure();
    return adminView();
  }

  /** Each kind: its settings, the giveaway running now (with who joined) and the last ones drawn. */
  async function adminView() {
    const plans = await db.many('SELECT kind, active, item_id, min_topup FROM bs_giveaway_plans');
    const open = await db.many(
      `SELECT g.id, g.kind, g.item_id, g.min_topup, g.starts_at, g.ends_at,
              (SELECT count(*)::int FROM bs_giveaway_entries e WHERE e.giveaway_id = g.id) AS n
         FROM bs_giveaways g WHERE g.status = 'open'`,
    );
    const done = await db.many(
      `SELECT w.* FROM unnest($1::text[]) k(kind),
         LATERAL (SELECT g.id, g.kind, g.item_id, g.entries, g.drawn_at, g.winner_id, u.first_name, u.username
                    FROM bs_giveaways g LEFT JOIN bs_users u ON u.id = g.winner_id
                   WHERE g.kind = k.kind AND g.status = 'done' ORDER BY g.id DESC LIMIT 10) w`,
      [KIND_LIST],
    );
    const out = {};
    for (const kind of KIND_LIST) {
      const p = plans.find((x) => x.kind === kind);
      const g = open.find((x) => x.kind === kind);
      out[kind] = {
        active: !!(p && p.active),
        item: p && p.item_id ? item(p.item_id) : null,
        min: p ? Number(p.min_topup) : 0,
        current: g ? { id: Number(g.id), item: item(g.item_id), min: Number(g.min_topup), startsAt: g.starts_at, endsAt: g.ends_at, entries: g.n } : null,
        past: done
          .filter((x) => x.kind === kind)
          .map((x) => ({
            id: Number(x.id),
            item: item(x.item_id),
            entries: x.entries,
            at: x.drawn_at,
            winner: x.winner_id ? { id: Number(x.winner_id), name: displayName({ id: x.winner_id, first_name: x.first_name, username: x.username }) } : null,
          })),
      };
    }
    return { giveaways: out };
  }

  /** Who joined the giveaway running now (the admin panel). */
  async function entries(id) {
    const rows = await db.many(
      `SELECT u.id, u.first_name, u.username, e.created_at FROM bs_giveaway_entries e JOIN bs_users u ON u.id = e.user_id
        WHERE e.giveaway_id = $1 ORDER BY e.created_at, u.id`,
      [Number(id)],
    );
    return { entries: rows.map((r) => ({ id: Number(r.id), name: displayName(r), username: r.username || null, at: r.created_at })) };
  }

  return { topup, toppedUp, ensure, draw, tick, start, stop, brief, list, join, setPlan, adminView, entries };
}
