// Invite friends: every player has a link of their own (https://t.me/<bot>?start=inv_CODE). A new
// player who comes by it becomes that player's friend, and the inviter gets invite_pct % (main admin's
// setting) of every top-up of the friend: Telegram Stars, coins credited and brainrots given for a
// deposit request. It is kept apart until the inviter moves it to the balance.
import crypto from 'node:crypto';
import { GameError, displayName } from './game.js';

export const INVITE_PREFIX = 'inv_';
const LINK_RE = /^inv_([A-Za-z0-9]{8})$/;
const NEW_FOR_SEC = 3600; // a player can still be invited for an hour after their first visit
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function randomCode() {
  return Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function createInvites({ db, settings, tg }) {
  const pct = () => Number(settings.get('invite_pct')) || 0;

  /** The player's link (null while the bot is off). */
  const link = (code) => (tg.botUsername ? `https://t.me/${tg.botUsername}?start=${INVITE_PREFIX}${code}` : null);

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
   * A player who came by a friend's link (/start inv_CODE): the friend becomes their inviter if the
   * player is new (came less than an hour ago) and has none yet; not themselves. Returns the inviter's
   * id or null.
   */
  async function bind(user, payload) {
    const m = LINK_RE.exec(String(payload || '').trim());
    if (!m || !user || user.inviter_id) return null;
    const r = await db.one(
      `UPDATE bs_users u SET inviter_id = i.id, invited_at = now()
         FROM bs_users i
        WHERE u.id = $1 AND i.invite_code = $2 AND i.id <> u.id AND u.inviter_id IS NULL
          AND u.created_at > now() - make_interval(secs => $3)
        RETURNING i.id`,
      [user.id, m[1], NEW_FOR_SEC],
    );
    if (!r) return null;
    user.inviter_id = r.id;
    return Number(r.id);
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
    await cl.query('UPDATE bs_users SET invite_balance = invite_balance + $2, invite_earned = invite_earned + $2 WHERE id = $1', [u.inviter_id, coins]);
    await cl.query('INSERT INTO bs_invite_rewards (inviter_id, user_id, request_id, coins) VALUES ($1, $2, $3, $4)', [u.inviter_id, userId, requestId, coins]);
    return coins;
  }

  /** Everything the "Invite friends" screen shows: the %, the link, the friends and what they brought. */
  async function state(user) {
    const code = await codeOf(user.id);
    const me = await db.one(
      `SELECT invite_balance, invite_earned,
              (SELECT count(*)::int FROM bs_users f WHERE f.inviter_id = $1) AS friends,
              (SELECT count(DISTINCT w.user_id)::int FROM bs_invite_rewards w WHERE w.inviter_id = $1) AS paying
         FROM bs_users WHERE id = $1`,
      [user.id],
    );
    const list = await db.many(
      `SELECT f.id, f.first_name, f.username, f.invited_at,
              (SELECT coalesce(sum(w.coins), 0)::bigint FROM bs_invite_rewards w WHERE w.inviter_id = $1 AND w.user_id = f.id) AS earned
         FROM bs_users f WHERE f.inviter_id = $1 ORDER BY f.invited_at DESC, f.id DESC LIMIT 100`,
      [user.id],
    );
    return {
      pct: pct(),
      link: link(code),
      friends: me.friends,
      paying: me.paying,
      earned: Number(me.invite_earned),
      balance: Number(me.invite_balance),
      list: list.map((f) => ({ name: displayName(f), at: f.invited_at, earned: Number(f.earned) })),
    };
  }

  /** Moves what the friends brought to the balance. */
  function claim(user) {
    return db.tx(async (cl) => {
      const u = (await cl.query('SELECT invite_balance FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
      const n = Number(u ? u.invite_balance : 0);
      if (n < 1) throw new GameError('nothing_to_claim');
      const r = await cl.query('UPDATE bs_users SET balance = balance + $2, invite_balance = 0 WHERE id = $1 RETURNING balance', [user.id, n]);
      await cl.query("INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, 'invites')", [user.id, n]);
      return { claimed: n, balance: Number(r.rows[0].balance) };
    });
  }

  /** The admin player card: who invited the player, how many friends they brought and what it gave. */
  async function adminView(u) {
    const inviter = u.inviter_id ? await db.one('SELECT id, first_name, username FROM bs_users WHERE id = $1', [u.inviter_id]) : null;
    const n = await db.one('SELECT count(*)::int AS n FROM bs_users WHERE inviter_id = $1', [u.id]);
    return {
      inviter: inviter ? { id: Number(inviter.id), name: displayName(inviter) } : null,
      friends: n.n,
      earned: Number(u.invite_earned || 0),
      balance: Number(u.invite_balance || 0),
    };
  }

  return { pct, link, codeOf, bind, reward, state, claim, adminView };
}
