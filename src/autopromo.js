// Auto promo code: every `auto_promo_hours` hours the server makes up a new code (a word that is not
// a referral or promo code) with a bonus of `auto_promo_min`..`auto_promo_max` % to a top-up. The
// app shows it on the cases screen; players type it in the top-up form (Stars or brainrots) and get
// the bonus once per code. It is paid apart from the referral bonus (both can come with a top-up).
import { GameError, cryptoRng } from './game.js';
import { REF_RE, normRef } from './referrals.js';

/** Words the codes are made of. */
export const AUTO_WORDS = [
  'TRALALA', 'BOMBARDIRO', 'TUNGTUNG', 'SAHUR', 'CAPPUCCINO', 'PATAPIM', 'LIRILI', 'BRRBRR', 'BALLERINA',
  'CROCODILO', 'BANANINI', 'TRIPPI', 'TROPPI', 'BONECA', 'AMBALABU', 'GLORBO', 'FRUTTO', 'SPIJUNIRO',
  'GOLUBIRO', 'LARILA', 'ZIBRA', 'ORANGUTINI', 'BURBALONI', 'LULILOLI', 'TIMCHEESE', 'SPOOKY', 'PUMPKIN',
  'MEOWL', 'GRIFFIN', 'ARCADRAGON', 'NARWHAL', 'STRAWBERRY', 'LUCKY', 'JACKPOT', 'ROCKET', 'BRAINROT',
  'COMBO', 'TURBO', 'MEGA', 'GOLDEN', 'DIAMOND', 'CRYSTAL', 'COSMIC', 'GALAXY', 'RAINBOW', 'THUNDER',
];

const HOUR = 3_600_000;

export function createAutoPromo({ db, settings, rng = cryptoRng, now = () => Date.now() }) {
  let cache = null; // the code of the moment: { id, code, pct, startsAt, endsAt } (ms)

  const view = (r) => ({ id: Number(r.id), code: r.code, pct: Number(r.pct), startsAt: new Date(r.starts_at).getTime(), endsAt: new Date(r.ends_at).getTime() });

  /** The code of this moment (made up when the last one is over); null while switched off. */
  async function current() {
    if (!settings.get('auto_promo')) return null;
    const t = now();
    if (cache && cache.startsAt <= t && t < cache.endsAt) return cache;
    const r = await db.one('SELECT * FROM bs_auto_promos WHERE starts_at <= $1 AND ends_at > $1 ORDER BY id DESC LIMIT 1', [new Date(t)]);
    cache = view(r || (await make(t)));
    return cache;
  }

  /**
   * A new code from now to the next full period (periods are counted from midnight UTC, so with 2 hours
   * the codes change at 00:00, 02:00, … UTC). The bonus is a whole % between the min and the max.
   */
  async function make(t) {
    const period = settings.get('auto_promo_hours') * HOUR;
    const last = await db.one('SELECT ends_at FROM bs_auto_promos ORDER BY ends_at DESC LIMIT 1');
    const aligned = Math.floor(t / period) * period;
    // right after a code (also when the period was changed meanwhile), else from the period's start
    const lastEnd = last ? new Date(last.ends_at).getTime() : 0;
    const start = lastEnd > aligned && lastEnd <= t ? lastEnd : aligned;
    const end = aligned + period;
    // a word that is not a referral or promo code and was not one of the last codes
    const taken = new Set((await db.many('SELECT code FROM bs_ref_codes UNION SELECT code FROM bs_promo_codes')).map((x) => x.code));
    const recent = new Set((await db.many('SELECT code FROM bs_auto_promos ORDER BY id DESC LIMIT 12')).map((x) => x.code));
    let words = AUTO_WORDS.filter((w) => !taken.has(w) && !recent.has(w));
    if (!words.length) words = AUTO_WORDS.filter((w) => !taken.has(w));
    const code = words.length ? words[rng.int(words.length)] : `BONUS${100 + rng.int(900)}`;
    const min = settings.get('auto_promo_min');
    const max = Math.max(min, settings.get('auto_promo_max'));
    const pct = min + rng.int(max - min + 1);
    const ins = await db.query(
      'INSERT INTO bs_auto_promos (code, pct, starts_at, ends_at) VALUES ($1, $2, $3, $4) ON CONFLICT (starts_at) DO NOTHING RETURNING *',
      [code, pct, new Date(start), new Date(end)],
    );
    // two requests at once: the other one made it
    return ins.rows[0] || db.one('SELECT * FROM bs_auto_promos WHERE starts_at = $1', [new Date(start)]);
  }

  /** For the app: the code, its bonus, when the next one comes, how often, and whether the player used it. */
  async function publicState(user) {
    const c = await current();
    if (!c) return null;
    const used = user ? !!(await db.one('SELECT 1 AS x FROM bs_auto_promo_uses WHERE promo_id = $1 AND user_id = $2', [c.id, user.id])) : false;
    return { code: c.code, pct: c.pct, endsAt: new Date(c.endsAt).toISOString(), hours: settings.get('auto_promo_hours'), used };
  }

  /**
   * The code typed in a top-up form: the auto code of this moment → its promo (refused if the player
   * already got its bonus); anything else → null (the caller treats it as a referral code).
   */
  async function match(user, raw) {
    const code = normRef(raw);
    if (!code || !REF_RE.test(code)) return null;
    const c = await current();
    if (!c || c.code !== code) return null;
    if (await db.one('SELECT 1 AS x FROM bs_auto_promo_uses WHERE promo_id = $1 AND user_id = $2', [c.id, user.id])) throw new GameError('promo_used');
    return c;
  }

  /** Was this an auto code that is over now (typed in late)? */
  async function expired(raw) {
    const code = normRef(raw);
    if (!code) return false;
    return !!(await db.one("SELECT 1 AS x FROM bs_auto_promos WHERE code = $1 AND ends_at <= $2 AND ends_at > $2::timestamptz - interval '2 days'", [code, new Date(now())]));
  }

  /** Marks the code as used by the player (in the top-up's transaction); false if it already was. */
  async function claim(cl, promoId, userId, requestId = null) {
    const r = await cl.query('INSERT INTO bs_auto_promo_uses (promo_id, user_id, request_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING promo_id', [promoId, userId, requestId]);
    return r.rowCount === 1;
  }

  /** The bonus coins of `pct` % on `coins`. */
  const bonusOf = (coins, pct) => (coins > 0 && pct > 0 ? Math.floor((coins * pct) / 100) : 0);

  return { current, publicState, match, expired, claim, bonusOf, reset: () => (cache = null) };
}
