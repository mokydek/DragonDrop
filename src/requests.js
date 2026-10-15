// Deposits (brainrots by request, Telegram Stars) and withdrawals of brainrots.
// A request has a conversation: admins write from the admin panel, the bot delivers
// it to the player, the player answers in the bot ("Reply" button or a Telegram reply).
import crypto from 'node:crypto';
import { GameError, displayName } from './game.js';
import { rarityOf } from './rarity.js';
import { T } from './texts.js';
import { requestSection } from './access.js';

export const OPEN = ['new', 'active'];
export const MAX_OPEN_REQUESTS = 5;
export const STARS_MAX = 10000;
export const MSG_MAX = 2000;
export const OFFER_MAX = 20; // different brainrots in one deposit request
export const OFFER_COUNT_MAX = 99; // copies of one brainrot
export const INVOICE_TTL_SEC = 24 * 3600; // older invoices are refused at checkout (the rate may have changed)

const clip = (s, n = 4000) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function cleanNick(v) {
  if (typeof v !== 'string') throw new GameError('bad_nick');
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^@+/, '');
  if (s.length < 3 || s.length > 32) throw new GameError('bad_nick');
  return s;
}

export function cleanText(v, min, max, code) {
  if (typeof v !== 'string') throw new GameError(code);
  const s = v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length < min || s.length > max) throw new GameError(code);
  return s;
}

export const starsToCoins = (stars, rate) => Math.floor(stars * rate + 1e-9);
/**
 * Invoice payload: player, stars, coins (fixed when the invoice is made), issue time, invoice id and
 * the auto promo code typed in (its id, if any).
 */
export const starsPayload = (userId, stars, coins, ts, invoice, promoId = null) =>
  `bs:${userId}:${stars}:${coins}:${ts}:${invoice}${promoId ? `:${promoId}` : ''}`;

export function parseStarsPayload(p) {
  const m = /^bs:(\d{1,16}):(\d{1,6}):(\d{1,13}):(\d{1,12}):([a-z0-9]{6,24})(?::(\d{1,12}))?$/.exec(String(p || ''));
  if (!m) return null;
  const r = { userId: Number(m[1]), stars: Number(m[2]), coins: Number(m[3]), ts: Number(m[4]), invoice: m[5], ...(m[6] ? { promoId: Number(m[6]) } : {}) };
  if (!Number.isSafeInteger(r.userId) || r.stars < 1 || r.stars > STARS_MAX || r.coins < 1) return null;
  return r;
}

function parseIds(ids, max = 100) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) throw new GameError('bad_request');
  const out = [...new Set(ids.map(Number))];
  if (out.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new GameError('bad_request');
  return out;
}

export function createRequests({ db, settings, game, tg, config, access, referrals, autoPromo, invites }) {
  const httpsWeb = /^https:\/\//.test(config.webUrl || '');
  const section = (kind) => (kind === 'withdraw' ? 'withdrawals' : 'deposits');

  function who(u) {
    const name = (u.first_name || '').trim() || `#${u.id}`;
    return `${name}${u.username ? ` (@${u.username})` : ''} · id ${u.id}`;
  }

  function itemView(e) {
    const it = game.catalog.items.get(e.itemId);
    const pub = it ? game.publicItem(it) : null;
    return {
      id: e.itemId,
      name: e.name,
      value: e.value,
      emoji: pub ? pub.emoji : e.emoji || '🎁',
      rarity: pub ? pub.rarity : rarityOf(e.value),
      image: pub ? pub.image : null,
    };
  }
  const itemNames = (items) => items.map((i) => i.name).join(', ');
  const offerText = (offer) => offer.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(', ');

  /** Brainrots picked for a deposit: [{itemId, count}] -> stored entries (same brainrot merged). */
  function parseOffer(raw) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > OFFER_MAX) throw new GameError('bad_offer');
    const counts = new Map();
    for (const e of raw) {
      const id = Number(e && e.itemId);
      const n = e && e.count !== undefined ? Number(e.count) : 1;
      const it = game.catalog.items.get(id);
      if (!it || !it.enabled || !it.depositable || !Number.isInteger(n) || n < 1 || n > OFFER_COUNT_MAX) throw new GameError('bad_offer');
      counts.set(id, Math.min(OFFER_COUNT_MAX, (counts.get(id) || 0) + n));
    }
    return [...counts].map(([id, count]) => {
      const it = game.catalog.items.get(id);
      return { itemId: it.id, name: it.name, value: it.value, emoji: it.emoji, count };
    });
  }

  function view(r) {
    const out = {
      id: r.id,
      kind: r.kind,
      method: r.method,
      status: r.status,
      nick: r.nick,
      details: r.details,
      offer: r.offer ? r.offer.map((e) => ({ ...itemView(e), count: e.count })) : null,
      offerTotal: r.offer ? r.offer.reduce((s, e) => s + e.value * e.count, 0) : 0,
      items: (r.items || []).map(itemView),
      total: r.total,
      exchange: r.exchange
        ? { from: r.exchange.from.map(itemView), to: r.exchange.to, rest: r.exchange.rest, value: r.exchange.from.reduce((s, i) => s + i.value, 0) }
        : null,
      coins: r.coins,
      stars: r.stars,
      promo: r.promo_code ? { code: r.promo_code, pct: r.promo_pct, bonus: Number(r.promo_bonus || 0) } : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
    if ('last_author' in r) {
      out.waiting = r.method === 'brainrot' && OPEN.includes(r.status) && (r.last_author === null || r.last_author === 'user');
      out.lastText = r.last_text || null;
    }
    if (r.uid !== undefined) {
      out.user = {
        id: r.uid,
        name: displayName({ id: r.uid, first_name: r.first_name, username: r.username }),
        username: r.username,
        photo: r.photo_url && /^https:\/\//.test(r.photo_url) ? r.photo_url : null,
      };
      if (r.user_balance !== undefined) {
        Object.assign(out.user, { balance: r.user_balance, blockedBot: r.blocked_bot, startedBot: r.started_bot, ref: r.ref_code || null });
      }
    }
    return out;
  }

  async function markBlocked(sent, userId) {
    if (!sent.ok && sent.code === 403) await db.query('UPDATE bs_users SET blocked_bot = TRUE WHERE id = $1', [userId]).catch(() => {});
  }

  async function notifyAdmins(makeText, row) {
    let admins = [];
    try {
      admins = await db.many(
        `SELECT id, lang FROM bs_users
          WHERE (is_admin OR id = ANY($1::bigint[])) AND started_bot AND NOT blocked_bot AND NOT is_banned`,
        [config.adminIds],
      );
    } catch (e) {
      console.warn('[requests] admin list failed:', e.message);
    }
    for (const a of admins) {
      // only admins who see this kind of request in the panel
      if (access && !access.can(a.id, requestSection(row))) continue;
      const t = T(a.lang);
      const extra = httpsWeb
        ? { reply_markup: { inline_keyboard: [[{ text: t.btnOpenRequest, web_app: { url: `${config.webUrl}/?go=admin/${section(row.kind)}/${row.id}` } }]] } }
        : {};
      const sent = await tg.send(a.id, clip(makeText(t)), extra);
      await markBlocked(sent, a.id);
    }
  }

  const replyKb = (t, id, label) => ({ reply_markup: { inline_keyboard: [[{ text: label || t.btnReply, callback_data: `rq:${id}` }]] } });

  async function lockUserAndCheckLimit(cl, userId) {
    await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [userId]);
    const { rows } = await cl.query(
      "SELECT count(*)::int AS n FROM bs_requests WHERE user_id = $1 AND method = 'brainrot' AND status IN ('new', 'active')",
      [userId],
    );
    if (rows[0].n >= MAX_OPEN_REQUESTS) throw new GameError('too_many_requests');
  }

  async function insertRequest(cl, user, fields) {
    const row = (
      await cl.query(
        `INSERT INTO bs_requests (user_id, kind, method, nick, details, items, total, offer)
         VALUES ($1, $2, 'brainrot', $3, $4, $5::jsonb, $6, $7::jsonb) RETURNING *`,
        [user.id, fields.kind, fields.nick, fields.details ?? null, JSON.stringify(fields.items || []), fields.total || 0, fields.offer ? JSON.stringify(fields.offer) : null],
      )
    ).rows[0];
    const sys = (
      await cl.query("INSERT INTO bs_request_msgs (request_id, author, author_id, text) VALUES ($1, 'system', $2, 'created') RETURNING id", [
        row.id,
        user.id,
      ])
    ).rows[0];
    await cl.query('UPDATE bs_users SET roblox_nick = $2 WHERE id = $1', [user.id, fields.nick]);
    return { row, sysId: sys.id };
  }

  /** Confirmation to the player (they can answer it) and a heads-up to the admins. */
  async function announce(user, row, sysId) {
    const t = T(user.lang);
    const text =
      row.kind === 'deposit'
        ? t.depositCreated(row.id, row.nick, row.details)
        : t.withdrawCreated(row.id, row.nick, itemNames(row.items), row.total, row.exchange ? row.exchange.rest : 0);
    const sent = await tg.send(user.id, clip(text), replyKb(t, row.id, t.btnWrite));
    if (sent.ok) await db.query('UPDATE bs_request_msgs SET tg_msg_id = $2 WHERE id = $1', [sysId, sent.message.message_id]);
    await markBlocked(sent, user.id);
    await notifyAdmins(
      (at) =>
        row.kind === 'deposit'
          ? at.aNewDeposit(row.id, who(user), row.nick, row.details)
          : at.aNewWithdraw(row.id, who(user), row.nick, itemNames(row.items), row.total),
      row,
    );
  }

  // ------------------------------------------------------------ player
  /** Deposit by brainrots: the player picks which brainrots they will give (`offer`). */
  async function createDeposit(user, body = {}, promo = null) {
    // admins can close brainrot deposits for a while (requests already sent are handled as usual)
    if (settings.get('deposits_brainrots_open') === false) throw new GameError('deposits_closed');
    const nick = cleanNick(body.nick);
    let offer = null;
    let details;
    if (body.offer !== undefined) {
      offer = parseOffer(body.offer);
      details = offerText(offer);
    } else {
      details = cleanText(body.details, 2, 500, 'bad_details'); // app versions before the picker
    }
    const { row, sysId } = await db.tx(async (cl) => {
      await lockUserAndCheckLimit(cl, user.id);
      const res = await insertRequest(cl, user, { kind: 'deposit', nick, details, offer });
      // the auto promo code typed in: used up by this request, its bonus comes with the coins credited
      if (promo) {
        if (!(await autoPromo.claim(cl, promo.id, user.id, res.row.id))) throw new GameError('promo_used');
        res.row = (
          await cl.query('UPDATE bs_requests SET promo_id = $2, promo_code = $3, promo_pct = $4 WHERE id = $1 RETURNING *', [res.row.id, promo.id, promo.code, promo.pct])
        ).rows[0];
      }
      return res;
    });
    await announce(user, row, sysId);
    return { request: view(row) };
  }

  /**
   * Withdrawal of inventory brainrots. Only "withdrawable" ones leave as they are; the others
   * must be exchanged for one withdrawable brainrot (`exchangeTo`) worth no more than they are,
   * the difference goes to the balance.
   */
  async function createWithdraw(user, body = {}) {
    const nick = cleanNick(body.nick);
    const ids = parseIds(body.ids);
    let target = null;
    if (body.exchangeTo !== undefined && body.exchangeTo !== null) {
      target = game.catalog.items.get(Number(body.exchangeTo));
      if (!target || !target.withdrawable || !target.enabled) throw new GameError('not_withdrawable');
    }
    const entry = (it, invId) => ({ ...(invId ? { invId } : {}), itemId: it.id, name: it.name, value: it.value, emoji: it.emoji });
    const { row, sysId, removed, rest, balance } = await db.tx(async (cl) => {
      await lockUserAndCheckLimit(cl, user.id);
      const del = await cl.query('DELETE FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) RETURNING id, item_id', [
        user.id,
        ids,
      ]);
      if (del.rowCount !== ids.length) throw new GameError('items_missing');
      const taken = del.rows.map((x) => ({ invId: x.id, it: game.catalog.items.get(x.item_id) })).filter((x) => x.it);
      const keep = taken.filter((x) => x.it.withdrawable);
      const swap = taken.filter((x) => !x.it.withdrawable);
      const swapValue = swap.reduce((s, x) => s + x.it.value, 0);
      if (swap.length && !target) throw new GameError('need_exchange', 400, { value: swapValue });
      if (!swap.length && target) throw new GameError('bad_request');
      if (target && target.value > swapValue) throw new GameError('exchange_too_expensive', 400, { value: swapValue });
      const items = keep.map((x) => entry(x.it, x.invId));
      if (target) items.push(entry(target));
      items.sort((a, b) => b.value - a.value);
      const total = items.reduce((s, i) => s + i.value, 0);
      const out = await insertRequest(cl, user, { kind: 'withdraw', nick, items, total });
      let restCoins = 0;
      let bal = null;
      if (target) {
        restCoins = swapValue - target.value;
        const exchange = { from: swap.map((x) => entry(x.it, x.invId)), to: target.id, rest: restCoins };
        await cl.query('UPDATE bs_requests SET exchange = $2::jsonb WHERE id = $1', [out.row.id, JSON.stringify(exchange)]);
        out.row.exchange = exchange;
        const upd = await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1 RETURNING balance', [user.id, restCoins]);
        bal = upd.rows[0].balance;
        if (restCoins > 0) {
          await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [user.id, restCoins, `exchange:#${out.row.id}`]);
        }
      }
      return { ...out, removed: del.rows.map((x) => x.id), rest: restCoins, balance: bal };
    });
    await announce(user, row, sysId);
    return { request: view(row), removed, rest, ...(balance === null ? {} : { balance }) };
  }

  async function starsInvoice(user, raw, promo = null) {
    const stars = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (!Number.isSafeInteger(stars) || stars < 1 || stars > STARS_MAX) throw new GameError('bad_stars');
    const coins = starsToCoins(stars, settings.get('stars_rate'));
    if (coins < 1) throw new GameError('bad_stars');
    if (!tg.enabled) throw new GameError('bot_disabled', 503);
    const t = T(user.lang);
    const invoice = crypto.randomBytes(8).toString('hex');
    try {
      const link = await tg.starsInvoice({
        title: t.invoiceTitle,
        description: t.invoiceDesc(coins),
        payload: starsPayload(user.id, stars, coins, Math.floor(Date.now() / 1000), invoice, promo ? promo.id : null),
        label: t.invoiceLabel(coins),
        stars,
      });
      return { link, stars, coins, invoice, ...(promo ? { promo: { code: promo.code, pct: promo.pct } } : {}) };
    } catch (e) {
      console.warn('[stars] createInvoiceLink failed:', e.description || e.message);
      throw new GameError('invoice_failed', 502);
    }
  }

  /** Was this invoice of the player paid? (the app polls it after opening the invoice) */
  async function invoiceStatus(user, invoice) {
    if (typeof invoice !== 'string' || !/^[a-z0-9]{6,24}$/.test(invoice)) throw new GameError('bad_request');
    const r = await db.one(
      "SELECT r.coins, r.bonus, r.promo_bonus, u.balance FROM bs_requests r JOIN bs_users u ON u.id = r.user_id WHERE r.invoice = $1 AND r.user_id = $2 AND r.method = 'stars'",
      [invoice, user.id],
    );
    return r ? { paid: true, coins: Number(r.coins) + Number(r.bonus) + Number(r.promo_bonus), balance: r.balance } : { paid: false };
  }

  /** pre_checkout_query: our fresh invoice, the same player, the exact amount, not banned. */
  async function preCheckout(q, now = Date.now()) {
    const p = parseStarsPayload(q.invoice_payload);
    if (!p || q.currency !== 'XTR' || q.total_amount !== p.stars || !q.from || q.from.id !== p.userId) return false;
    if (now / 1000 - p.ts > INVOICE_TTL_SEC) return false;
    const u = await db.one('SELECT is_banned FROM bs_users WHERE id = $1', [p.userId]);
    return !!u && !u.is_banned;
  }

  /** successful_payment: credits coins once per Telegram charge id. */
  async function creditStars(fromId, pay) {
    const p = parseStarsPayload(pay.invoice_payload);
    if (!p || pay.currency !== 'XTR' || p.userId !== fromId || !pay.telegram_payment_charge_id) {
      console.error('[stars] unexpected payment', JSON.stringify(pay));
      return null;
    }
    const stars = pay.total_amount;
    const coins = stars === p.stars ? p.coins : starsToCoins(stars, settings.get('stars_rate'));
    return db.tx(async (cl) => {
      // the referral bonus by the code's level before this payment
      const bonus = referrals ? await referrals.bonusCoins(cl, p.userId, coins) : 0;
      const ins = await cl.query(
        `INSERT INTO bs_requests (user_id, kind, method, status, stars, coins, charge_id, invoice)
         VALUES ($1, 'deposit', 'stars', 'done', $2, $3, $4, $5)
         ON CONFLICT (charge_id) DO NOTHING RETURNING id`,
        [p.userId, stars, coins, pay.telegram_payment_charge_id, p.invoice],
      );
      if (!ins.rowCount) return { duplicate: true };
      const id = ins.rows[0].id;
      // the auto promo code typed in when the invoice was made: its bonus, once per player
      let promoBonus = 0;
      if (p.promoId && autoPromo) {
        const pr = (await cl.query('SELECT id, code, pct FROM bs_auto_promos WHERE id = $1', [p.promoId])).rows[0];
        if (pr && (await autoPromo.claim(cl, pr.id, p.userId, id))) {
          promoBonus = autoPromo.bonusOf(coins, pr.pct);
          await cl.query('UPDATE bs_requests SET promo_id = $2, promo_code = $3, promo_pct = $4, promo_bonus = $5 WHERE id = $1', [id, pr.id, pr.code, pr.pct, promoBonus]);
        }
      }
      const upd = await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1 RETURNING balance, lang', [p.userId, coins + bonus + promoBonus]);
      await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [p.userId, coins, `stars:#${id}`]);
      if (bonus > 0) {
        await cl.query('UPDATE bs_requests SET bonus = $2 WHERE id = $1', [id, bonus]);
        await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [p.userId, bonus, `refbonus:#${id}`]);
      }
      if (promoBonus > 0) await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, $3)', [p.userId, promoBonus, `autopromo:#${id}`]);
      if (invites) await invites.reward(cl, p.userId, coins, id); // the share of the friend who invited the player
      return { id, coins, bonus, promoBonus, stars, balance: upd.rows[0].balance, lang: upd.rows[0].lang };
    });
  }

  /** A player's message about a request (from the bot). */
  async function userReply(user, id, raw) {
    const text = cleanText(String(raw || '').slice(0, MSG_MAX), 1, MSG_MAX, 'bad_text');
    const row = await db.one('SELECT * FROM bs_requests WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!row) throw new GameError('not_found', 404);
    if (!OPEN.includes(row.status)) throw new GameError('request_closed');
    await db.query("INSERT INTO bs_request_msgs (request_id, author, author_id, text) VALUES ($1, 'user', $2, $3)", [id, user.id, text]);
    await db.query('UPDATE bs_requests SET updated_at = now() WHERE id = $1', [id]);
    await notifyAdmins((t) => t.aUserReply(row.id, who(user), text), row);
    return row;
  }

  async function ownRequest(userId, id) {
    return db.one('SELECT * FROM bs_requests WHERE id = $1 AND user_id = $2', [id, userId]);
  }

  /** Request the bot message `msgId` (in the player's chat) belongs to. */
  async function findByTgMessage(userId, msgId) {
    const r = await db.one(
      `SELECT m.request_id FROM bs_request_msgs m JOIN bs_requests r ON r.id = m.request_id
        WHERE m.tg_msg_id = $1 AND r.user_id = $2 ORDER BY m.id DESC LIMIT 1`,
      [msgId, userId],
    );
    return r ? r.request_id : null;
  }

  // ------------------------------------------------------------ admin
  const LAST_MSG = `LEFT JOIN LATERAL (
      SELECT m.author, m.text FROM bs_request_msgs m
       WHERE m.request_id = r.id AND m.author <> 'system' ORDER BY m.id DESC LIMIT 1
    ) lm ON TRUE`;

  // admin tabs: in progress (new + active) / done / declined; "all" for everything
  const SCOPES = { active: OPEN, open: OPEN, done: ['done'], rejected: ['rejected'], all: null };

  /** `methods`: only these ('brainrot' / 'stars'); null for all. */
  async function list({ kind, scope = 'active', methods = null } = {}) {
    if (kind !== 'deposit' && kind !== 'withdraw') throw new GameError('bad_field', 400, { field: 'kind' });
    if (!Object.hasOwn(SCOPES, scope)) throw new GameError('bad_field', 400, { field: 'scope' });
    const rows = await db.many(
      `SELECT r.*, u.id AS uid, u.first_name, u.username, u.photo_url,
              lm.author AS last_author, lm.text AS last_text
         FROM bs_requests r JOIN bs_users u ON u.id = r.user_id ${LAST_MSG}
        WHERE r.kind = $1 AND ($2::text[] IS NULL OR r.status = ANY($2::text[]))
          AND ($3::text[] IS NULL OR r.method = ANY($3::text[]))
        ORDER BY r.updated_at DESC, r.id DESC LIMIT 200`,
      [kind, SCOPES[scope], methods],
    );
    return rows.map(view);
  }

  /** The admin panel section a request is in (null if there is no such request). */
  async function sectionOf(id) {
    const r = await db.one('SELECT kind, method FROM bs_requests WHERE id = $1', [id]);
    return r ? requestSection(r) : null;
  }

  /** Open requests that wait for an admin (new or the player wrote last). */
  async function counts() {
    const rows = await db.many(
      `SELECT r.kind, count(*)::int AS n FROM bs_requests r ${LAST_MSG}
        WHERE r.method = 'brainrot' AND r.status IN ('new', 'active') AND (lm.author IS NULL OR lm.author = 'user')
        GROUP BY r.kind`,
    );
    const out = { deposit: 0, withdraw: 0 };
    for (const r of rows) out[r.kind] = r.n;
    return out;
  }

  async function detail(id) {
    const r = await db.one(
      `SELECT r.*, u.id AS uid, u.first_name, u.username, u.photo_url,
              u.balance AS user_balance, u.blocked_bot, u.started_bot, u.ref_code,
              lm.author AS last_author, lm.text AS last_text
         FROM bs_requests r JOIN bs_users u ON u.id = r.user_id ${LAST_MSG}
        WHERE r.id = $1`,
      [id],
    );
    if (!r) throw new GameError('not_found', 404);
    const msgs = await db.many(
      `SELECT m.id, m.author, m.author_id, m.text, m.created_at, m.tg_msg_id, a.first_name AS admin_name
         FROM bs_request_msgs m LEFT JOIN bs_users a ON m.author = 'admin' AND a.id = m.author_id
        WHERE m.request_id = $1 ORDER BY m.id LIMIT 1000`,
      [id],
    );
    return {
      request: view(r),
      messages: msgs.map((m) => ({
        id: m.id,
        author: m.author,
        text: m.text,
        at: m.created_at,
        adminName: m.admin_name || null,
        delivered: m.author === 'admin' ? m.tg_msg_id !== null : undefined,
      })),
    };
  }

  async function adminMessage(admin, id, raw) {
    const text = cleanText(raw, 1, MSG_MAX, 'bad_text');
    const row = await db.one('SELECT r.*, u.lang FROM bs_requests r JOIN bs_users u ON u.id = r.user_id WHERE r.id = $1', [id]);
    if (!row) throw new GameError('not_found', 404);
    const t = T(row.lang);
    const sent = await tg.send(row.user_id, clip(t.adminMsg(row.id, text)), OPEN.includes(row.status) ? replyKb(t, row.id) : {});
    await markBlocked(sent, row.user_id);
    await db.query(
      "INSERT INTO bs_request_msgs (request_id, author, author_id, text, tg_msg_id) VALUES ($1, 'admin', $2, $3, $4)",
      [id, admin.id, text, sent.ok ? sent.message.message_id : null],
    );
    await db.query(
      "UPDATE bs_requests SET status = CASE WHEN status = 'new' THEN 'active' ELSE status END, admin_id = $2, updated_at = now() WHERE id = $1",
      [id, admin.id],
    );
    return { delivered: sent.ok, ...(await detail(id)) };
  }

  async function lockOpen(cl, id, kind) {
    const row = (await cl.query('SELECT * FROM bs_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new GameError('not_found', 404);
    if (row.method !== 'brainrot' || (kind && row.kind !== kind)) throw new GameError('bad_request');
    if (!OPEN.includes(row.status)) throw new GameError('request_closed');
    return row;
  }

  const touch = (cl, id, adminId) =>
    cl.query(
      "UPDATE bs_requests SET status = CASE WHEN status = 'new' THEN 'active' ELSE status END, admin_id = $2, updated_at = now() WHERE id = $1",
      [id, adminId],
    );
  const sysMsg = (cl, id, adminId, text) =>
    cl.query("INSERT INTO bs_request_msgs (request_id, author, author_id, text) VALUES ($1, 'system', $2, $3)", [id, adminId, text]);

  /** Credits coins to the player of a deposit request. */
  async function credit(admin, id, amount) {
    const n = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount;
    if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000_000) throw new GameError('bad_field', 400, { field: 'amount' });
    await db.tx(async (cl) => {
      const row = await lockOpen(cl, id, 'deposit');
      const bonus = referrals ? await referrals.bonusCoins(cl, row.user_id, n) : 0;
      const promoBonus = row.promo_pct ? Math.floor((n * row.promo_pct) / 100) : 0; // the auto promo code sent with it
      await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1', [row.user_id, n + bonus + promoBonus]);
      await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason, admin_id) VALUES ($1, $2, $3, $4)', [
        row.user_id,
        n,
        `deposit:#${id}`,
        admin.id,
      ]);
      if (bonus > 0) {
        await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason, admin_id) VALUES ($1, $2, $3, $4)', [row.user_id, bonus, `refbonus:#${id}`, admin.id]);
      }
      if (promoBonus > 0) {
        await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason, admin_id) VALUES ($1, $2, $3, $4)', [row.user_id, promoBonus, `autopromo:#${id}`, admin.id]);
      }
      await cl.query('UPDATE bs_requests SET coins = coins + $2, bonus = bonus + $3, promo_bonus = promo_bonus + $4 WHERE id = $1', [id, n, bonus, promoBonus]);
      if (invites) await invites.reward(cl, row.user_id, n, id);
      await touch(cl, id, admin.id);
      await sysMsg(cl, id, admin.id, `credit:${n}`);
    });
    return detail(id);
  }

  /** Gives a brainrot (item) to the player of a deposit request. */
  async function give(admin, id, itemId) {
    const it = game.catalog.items.get(Number(itemId));
    if (!it) throw new GameError('item_not_found', 404);
    await db.tx(async (cl) => {
      const row = await lockOpen(cl, id, 'deposit');
      await game.giveItem(cl, row.user_id, it, 'deposit', { ref: row.id });
      const entry = { itemId: it.id, name: it.name, value: it.value, emoji: it.emoji };
      await cl.query('UPDATE bs_requests SET items = items || $2::jsonb WHERE id = $1', [id, JSON.stringify([entry])]);
      if (invites) await invites.reward(cl, row.user_id, it.value, id);
      await touch(cl, id, admin.id);
      await sysMsg(cl, id, admin.id, `give:${it.id}`);
    });
    return detail(id);
  }

  /** done / rejected. A rejected withdrawal returns the held brainrots. */
  async function setStatus(admin, id, status) {
    if (status !== 'done' && status !== 'rejected') throw new GameError('bad_field', 400, { field: 'status' });
    const row = await db.tx(async (cl) => {
      const r = await lockOpen(cl, id);
      if (r.kind === 'withdraw' && status === 'rejected') {
        for (const e of r.items || []) {
          const it = game.catalog.items.get(e.itemId);
          if (it) await game.giveItem(cl, r.user_id, it, 'refund', { ref: r.id });
        }
      }
      await cl.query('UPDATE bs_requests SET status = $2, admin_id = $3, updated_at = now() WHERE id = $1', [id, status, admin.id]);
      await sysMsg(cl, id, admin.id, `status:${status}`);
      const u = (await cl.query('SELECT lang FROM bs_users WHERE id = $1', [r.user_id])).rows[0];
      return { ...r, lang: u ? u.lang : 'ru' };
    });
    const t = T(row.lang);
    let text;
    if (status === 'rejected') text = t.rejected(row.id, row.kind);
    else if (row.kind === 'deposit') text = t.depositDone(row.id, row.coins, itemNames(row.items || []));
    else text = t.withdrawDone(row.id);
    const sent = await tg.send(row.user_id, clip(text));
    if (sent.ok) {
      await db.query(
        "UPDATE bs_request_msgs SET tg_msg_id = $2 WHERE id = (SELECT max(id) FROM bs_request_msgs WHERE request_id = $1 AND author = 'system')",
        [id, sent.message.message_id],
      );
    }
    await markBlocked(sent, row.user_id);
    return detail(id);
  }

  return {
    createDeposit,
    createWithdraw,
    starsInvoice,
    invoiceStatus,
    preCheckout,
    creditStars,
    userReply,
    ownRequest,
    findByTgMessage,
    list,
    sectionOf,
    counts,
    detail,
    adminMessage,
    credit,
    give,
    setStatus,
  };
}
