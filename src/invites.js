// Invite friends — the referral page. Every player has a code of their own (8 capital letters and
// digits, the player can change it) and a link with it: https://t.me/<bot>?start=CODE. A new player who
// comes by the link, or types the code in «Промокод» or in a top-up form before their first top-up,
// becomes the player's friend, and the inviter gets invite_pct % (main admin's setting) of every top-up
// of the friend: Telegram Stars, coins credited and brainrots given for a deposit request.
// What the friends bring is pending first: every Saturday at 15:00 Astana time (13:00 in Moscow) the
// week's income goes to the referral balance, from where the player moves it to the balance.
import crypto from 'node:crypto';
import { GameError, displayName } from './game.js';

export const INVITE_PREFIX = 'inv_'; // links made before the codes could be changed: ?start=inv_CODE
const LEGACY_RE = /^inv_([A-Za-z0-9]{8})$/;
export const CODE_RE = /^[A-Z0-9]{4,16}$/;
const RESERVED = new Set(['SHARE', 'START', 'ADMIN', 'PROMO']); // words the bot uses after /start
const NEW_FOR_SEC = 3600; // by a link, a player can still be invited for an hour after their first visit
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0 / O, 1 / I: easy to type in from a screen
// the payout: Saturday 15:00 Astana time (UTC+5, no summer time) = Saturday 10:00 UTC
const PAYOUT_DAY = 6;
const PAYOUT_HOUR_UTC = 10;
const DAY = 86_400_000;

/** The last payout at or before `now` and the next one (ms). */
export function payoutWindow(now = Date.now()) {
  const d = new Date(now);
  let last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PAYOUT_HOUR_UTC) - ((d.getUTCDay() - PAYOUT_DAY + 7) % 7) * DAY;
  if (last > now) last -= 7 * DAY;
  return { last, next: last + 7 * DAY };
}

/** A code as typed: capitals, no spaces, no @ in front. */
export const normCode = (raw) =>
  String(raw ?? '')
    .trim()
    .replace(/^@+/, '')
    .toUpperCase();

// a code looked up as it came (a link, typed in): the same letters first, then in capitals — an older
// code that could not be made capital (another one would read the same) keeps its small letters
const LOOKUP_RE = /^[A-Za-z0-9]{4,16}$/;
const asTyped = (raw) =>
  String(raw ?? '')
    .replace(/\s+/g, '')
    .replace(/^@+/, '');

function randomCode() {
  return Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Once per database: from now on the income is paid out on Saturdays. What the friends brought before
 * this moment stays on the referral balance as it was.
 */
export async function weeklyOnce(db, settings) {
  if (settings.get('_invite_weekly_from')) return false;
  const r = await db.one('SELECT now() AS now');
  await settings.setInternal('_invite_weekly_from', new Date(r.now).toISOString());
  return true;
}

export function createInvites({ db, settings, tg }) {
  const pct = () => Number(settings.get('invite_pct')) || 0;

  /** The player's link (null while the bot is off). */
  const link = (code) => (tg.botUsername ? `https://t.me/${tg.botUsername}?start=${code}` : null);

  /** Income from before this moment is on the referral balance; from after it, pending. */
  function paidUntil(now = Date.now()) {
    const from = Date.parse(settings.get('_invite_weekly_from') || '') || 0;
    return new Date(Math.max(payoutWindow(now).last, from));
  }

  // what the friends brought before `$2` (paid out), after it (pending), and what was moved to the balance
  const MONEY = `
    (SELECT coalesce(sum(w.coins), 0)::bigint FROM bs_invite_rewards w WHERE w.inviter_id = $1 AND w.created_at < $2) AS paid,
    (SELECT coalesce(sum(w.coins), 0)::bigint FROM bs_invite_rewards w WHERE w.inviter_id = $1 AND w.created_at >= $2) AS pending,
    (SELECT coalesce(sum(l.delta), 0)::bigint FROM bs_balance_log l WHERE l.user_id = $1 AND l.reason = 'invites') AS claimed`;
  const moneyOf = (r) => ({ pending: Number(r.pending), balance: Math.max(0, Number(r.paid) - Number(r.claimed)) });

  /** The player's own code, made the first time it is asked for. */
  async function codeOf(userId) {
    for (let k = 0; k < 5; k++) {
      const u = await db.one('SELECT invite_code FROM bs_users WHERE id = $1', [userId]);
      if (!u) throw new GameError('not_found', 404);
      if (u.invite_code) return u.invite_code;
      try {
        const r = await db.one('UPDATE bs_users SET invite_code = $2 WHERE id = $1 AND invite_code IS NULL RETURNING invite_code', [userId, randomCode()]);
        if (r) return r.invite_code;
      } catch (e) {
        if (e.code !== '23505') throw e; // taken by someone else: another one
      }
    }
    throw new Error('no free invite code');
  }

  /**
   * A player who came by a friend's link (/start CODE, or /start inv_CODE of an older link): the friend
   * becomes their inviter if the player is new (came less than an hour ago) and has none yet; not
   * themselves, not a friend of theirs. Returns the inviter's id or null.
   */
  async function bind(user, payload) {
    if (!user || user.inviter_id) return null;
    const raw = String(payload || '').trim();
    const legacy = LEGACY_RE.exec(raw);
    const code = legacy ? legacy[1] : asTyped(raw);
    if (!LOOKUP_RE.test(code)) return null;
    const r = await db.one(
      `UPDATE bs_users u SET inviter_id = i.id, invited_at = now()
         FROM (SELECT id, inviter_id FROM bs_users WHERE invite_code IN ($2, upper($2)) ORDER BY (invite_code = $2) DESC LIMIT 1) i
        WHERE u.id = $1 AND i.id <> u.id AND u.inviter_id IS NULL AND i.inviter_id IS DISTINCT FROM u.id
          AND u.created_at > now() - make_interval(secs => $3)
        RETURNING i.id`,
      [user.id, code, NEW_FOR_SEC],
    );
    if (!r) return null;
    user.inviter_id = r.id;
    return Number(r.id);
  }

  /**
   * A code typed in («Промокод», a top-up form): if it is a player's code, that player becomes the
   * friend who invited this one — before the first top-up only, once, not themselves, not a friend of
   * theirs. Returns null when it is not a player's code (the caller tries other codes), else
   * { inviter: { name }, already } (already: that player invited them before).
   */
  async function useCode(user, raw) {
    const code = asTyped(raw);
    if (!user || !LOOKUP_RE.test(code)) return null;
    const owner = await db.one(
      'SELECT id, first_name, username, inviter_id FROM bs_users WHERE invite_code IN ($1, upper($1)) ORDER BY (invite_code = $1) DESC LIMIT 1',
      [code],
    );
    if (!owner) return null;
    if (Number(owner.id) === Number(user.id)) throw new GameError('invite_self');
    const inviter = { name: displayName(owner) };
    return db.tx(async (cl) => {
      const u = (await cl.query('SELECT inviter_id FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
      if (!u) throw new GameError('unauthorized', 401);
      if (u.inviter_id) {
        if (Number(u.inviter_id) === Number(owner.id)) return { inviter, already: true };
        throw new GameError('invite_taken');
      }
      if (Number(owner.inviter_id) === Number(user.id)) throw new GameError('invite_mutual');
      const paid = await cl.query("SELECT 1 FROM bs_requests WHERE user_id = $1 AND kind = 'deposit' AND status = 'done' LIMIT 1", [user.id]);
      if (paid.rowCount) throw new GameError('invite_late');
      await cl.query('UPDATE bs_users SET inviter_id = $2, invited_at = now() WHERE id = $1', [user.id, owner.id]);
      user.inviter_id = owner.id;
      return { inviter, already: false };
    });
  }

  /**
   * The player changes their code: 4–16 capital letters and digits, not someone else's, not a partner's
   * referral code or an admin's promo code (those would win when it is typed in). The link changes too.
   */
  async function setCode(user, raw) {
    const code = normCode(raw);
    if (!CODE_RE.test(code) || RESERVED.has(code)) throw new GameError('bad_code');
    if ((await codeOf(user.id)) === code) return { code, link: link(code) };
    const clash = await db.one(
      `SELECT EXISTS (SELECT 1 FROM bs_ref_codes WHERE code = $1) OR EXISTS (SELECT 1 FROM bs_promo_codes WHERE upper(code) = $1) AS taken`,
      [code],
    );
    if (clash.taken) throw new GameError('code_taken');
    try {
      await db.query('UPDATE bs_users SET invite_code = $2 WHERE id = $1', [user.id, code]);
    } catch (e) {
      if (e.code === '23505') throw new GameError('code_taken');
      throw e;
    }
    return { code, link: link(code) };
  }

  /**
   * The inviter's share of a friend's top-up of `value` coins (Stars coins, coins credited, the price
   * of a brainrot given), inside the top-up's transaction. Returns the coins the inviter got.
   */
  async function reward(cl, userId, value, requestId = null) {
    const p = pct();
    if (!(value > 0) || !(p > 0)) return 0;
    const u = (await cl.query('SELECT inviter_id FROM bs_users WHERE id = $1', [userId])).rows[0];
    if (!u || !u.inviter_id) return 0;
    const coins = Math.floor((value * p) / 100);
    if (coins < 1) return 0;
    await cl.query('UPDATE bs_users SET invite_earned = invite_earned + $2 WHERE id = $1', [u.inviter_id, coins]);
    await cl.query('INSERT INTO bs_invite_rewards (inviter_id, user_id, request_id, coins) VALUES ($1, $2, $3, $4)', [u.inviter_id, userId, requestId, coins]);
    return coins;
  }

  /**
   * Everything the referral page shows: the link, the code, the %, the pending income and when it is
   * paid out, the referral balance, the friends and what they brought.
   */
  async function state(user) {
    const code = await codeOf(user.id);
    const me = await db.one(
      `SELECT invite_earned,
              (SELECT count(*)::int FROM bs_users f WHERE f.inviter_id = $1) AS friends,
              (SELECT count(DISTINCT w.user_id)::int FROM bs_invite_rewards w WHERE w.inviter_id = $1) AS paying,
              ${MONEY}
         FROM bs_users WHERE id = $1`,
      [user.id, paidUntil()],
    );
    const list = await db.many(
      `SELECT f.id, f.first_name, f.username, f.invited_at,
              (SELECT coalesce(sum(w.coins), 0)::bigint FROM bs_invite_rewards w WHERE w.inviter_id = $1 AND w.user_id = f.id) AS earned
         FROM bs_users f WHERE f.inviter_id = $1 ORDER BY f.invited_at DESC, f.id DESC LIMIT 100`,
      [user.id],
    );
    return {
      pct: pct(),
      code,
      link: link(code),
      friends: me.friends,
      paying: me.paying,
      earned: Number(me.invite_earned),
      ...moneyOf(me),
      payoutAt: new Date(payoutWindow().next).toISOString(),
      list: list.map((f) => ({ name: displayName(f), at: f.invited_at, earned: Number(f.earned) })),
    };
  }

  /** Moves the referral balance (what was paid out and not moved yet) to the balance. */
  function claim(user) {
    return db.tx(async (cl) => {
      // one at a time: a second tap waits and then finds nothing to move
      if (!(await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rowCount) throw new GameError('unauthorized', 401);
      const m = moneyOf((await cl.query(`SELECT ${MONEY}`, [user.id, paidUntil()])).rows[0]);
      if (m.balance < 1) throw new GameError('nothing_to_claim');
      const r = await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1 RETURNING balance', [user.id, m.balance]);
      await cl.query("INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, 'invites')", [user.id, m.balance]);
      return { claimed: m.balance, balance: Number(r.rows[0].balance) };
    });
  }

  /** The admin player card: who invited the player, how many friends they brought and what it gave. */
  async function adminView(u) {
    const inviter = u.inviter_id ? await db.one('SELECT id, first_name, username FROM bs_users WHERE id = $1', [u.inviter_id]) : null;
    const n = await db.one(`SELECT (SELECT count(*)::int FROM bs_users WHERE inviter_id = $1) AS n, ${MONEY}`, [u.id, paidUntil()]);
    return {
      inviter: inviter ? { id: Number(inviter.id), name: displayName(inviter) } : null,
      friends: n.n,
      earned: Number(u.invite_earned || 0),
      ...moneyOf(n),
    };
  }

  return { pct, link, codeOf, bind, useCode, setCode, reward, state, claim, adminView };
}
