import { displayName } from './game.js';

const ONLINE_WINDOW_MS = 60_000;
const FEED_SIZE = 30;

/** Online counter, live drops feed, top drop for 24h and the SSE stream. */
export function createLive({ db, getPublicItem, revealDelayMs = 0 }) {
  const seen = new Map(); // userId -> last activity timestamp
  const clients = new Set();
  let feed = [];
  let top24 = null;
  let lastOnline = -1;
  const timers = [];

  function touch(userId) {
    seen.set(userId, Date.now());
  }

  function online() {
    const cut = Date.now() - ONLINE_WINDOW_MS;
    let n = 0;
    for (const [id, t] of seen) {
      if (t >= cut) n++;
      else seen.delete(id);
    }
    return n;
  }

  function send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(res);
    }
  }

  function broadcast(event, data) {
    for (const res of clients) send(res, event, data);
  }

  function rowToDrop(r) {
    return {
      id: r.id,
      at: r.created_at,
      kind: r.kind,
      value: r.value,
      item: getPublicItem(r.item_id),
      user: { name: displayName({ first_name: r.first_name, username: r.username, id: r.uid }) },
      caseId: r.case_id,
    };
  }

  // admins' drops (their tests) are never shown: the feed and the top of the day are the players'
  const DROP_SQL = `SELECT d.id, d.item_id, d.value, d.kind, d.case_id, d.created_at,
                           u.id AS uid, u.first_name, u.username
                      FROM bs_drops d JOIN bs_users u ON u.id = d.user_id
                     WHERE NOT u.is_admin`;

  async function refreshTop() {
    const r = await db.one(
      `${DROP_SQL} AND d.created_at > now() - interval '24 hours' ORDER BY d.value DESC, d.id DESC LIMIT 1`,
    );
    const next = r ? rowToDrop(r) : null;
    const changed = (next && next.id) !== (top24 && top24.id);
    top24 = next;
    if (changed) broadcast('top24', top24);
  }

  async function init() {
    const rows = await db.many(`${DROP_SQL} ORDER BY d.id DESC LIMIT ${FEED_SIZE}`);
    feed = rows.map(rowToDrop).filter((d) => d.item);
    await refreshTop();
    timers.push(
      setInterval(() => {
        const n = online();
        if (n !== lastOnline) {
          lastOnline = n;
          broadcast('online', { online: n });
        }
        for (const res of clients) {
          try {
            res.write(': ping\n\n');
          } catch {
            clients.delete(res);
          }
        }
      }, 5000),
      setInterval(() => refreshTop().catch((e) => console.warn('[live] top24 refresh failed:', e.message)), 60_000),
    );
    for (const t of timers) t.unref?.();
  }

  const pending = new Set();

  /** Publishes a drop (not an admin's); `delay` lets the player's animation finish before others see it. */
  function pushDrop(drop, delay = revealDelayMs) {
    if (!drop || !drop.item || drop.admin) return;
    if (delay > 0) {
      const tm = setTimeout(() => {
        pending.delete(tm);
        pushDrop(drop, 0);
      }, delay);
      pending.add(tm);
      return;
    }
    feed.unshift(drop);
    if (feed.length > FEED_SIZE) feed.length = FEED_SIZE;
    broadcast('drop', drop);
    if (!top24 || drop.value > top24.value || Date.now() - new Date(top24.at).getTime() > 86_400_000) {
      top24 = drop;
      broadcast('top24', top24);
    }
  }

  function snapshot() {
    return { feed, top24, online: online() };
  }

  function sseHandler(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    clients.add(res);
    send(res, 'online', { online: online() });
    req.on('close', () => clients.delete(res));
  }

  function stop() {
    for (const t of timers) clearInterval(t);
    for (const t of pending) clearTimeout(t);
    pending.clear();
    for (const res of clients) {
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
    clients.clear();
  }

  return { touch, online, pushDrop, snapshot, sseHandler, init, refreshTop, stop, clients, upgradeDelayMs: revealDelayMs ? Math.round(revealDelayMs * 0.85) : 0 };
}
