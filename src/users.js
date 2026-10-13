import { pickLang } from './texts.js';

export const THEMES = ['sunset', 'graphite', 'mint', 'redblue', 'violet', 'ocean'];

function cleanStr(v, max) {
  if (v === undefined || v === null) return null;
  return String(v).slice(0, max);
}

export function createUsers({ db, settings, config }) {
  // owner username -> Telegram id of the account that first used it (so a later
  // holder of the same username doesn't become the main admin)
  const pins = () => settings.get('_owner_pins') || {};

  function isOwnerId(id) {
    return config.ownerIds.includes(Number(id)) || Object.values(pins()).includes(Number(id));
  }

  /** Is a main admin configured at all (OWNER_IDS / OWNER_USERNAMES)? */
  function hasOwner() {
    return config.ownerIds.length > 0 || config.ownerUsernames.length > 0;
  }

  async function claimOwner(u) {
    const name = (u.username || '').toLowerCase();
    if (!name || !config.ownerUsernames.includes(name)) return false;
    const p = pins();
    if (p[name] !== undefined) return p[name] === Number(u.id);
    await settings.setInternal('_owner_pins', { ...p, [name]: Number(u.id) });
    return true;
  }

  /** The main admin always stays an admin and is never banned. */
  async function syncOwner(u) {
    if (!u) return u;
    const owner = isOwnerId(u.id) || (await claimOwner(u));
    if (!owner || (u.is_admin && !u.is_banned)) return u;
    return db.one('UPDATE bs_users SET is_admin = TRUE, is_banned = FALSE WHERE id = $1 RETURNING *', [u.id]);
  }

  async function upsertFromTelegram(tgUser, { started = false } = {}) {
    const photo = typeof tgUser.photo_url === 'string' && /^https:\/\//.test(tgUser.photo_url) ? tgUser.photo_url : null;
    const u = await db.one(
      `INSERT INTO bs_users (id, username, first_name, last_name, photo_url, lang, balance, is_admin, started_bot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         photo_url = COALESCE(EXCLUDED.photo_url, bs_users.photo_url),
         is_admin = bs_users.is_admin OR EXCLUDED.is_admin,
         started_bot = bs_users.started_bot OR EXCLUDED.started_bot,
         blocked_bot = CASE WHEN EXCLUDED.started_bot THEN FALSE ELSE bs_users.blocked_bot END,
         last_seen_at = now()
       RETURNING *, (xmax = 0) AS inserted`,
      [
        tgUser.id,
        cleanStr(tgUser.username, 64),
        cleanStr(tgUser.first_name, 128) || '',
        cleanStr(tgUser.last_name, 128),
        photo,
        pickLang(tgUser.language_code),
        settings.get('start_balance') || 0,
        config.adminIds.includes(tgUser.id),
        started,
      ],
    );
    if (u.inserted && u.balance > 0) {
      await db.query("INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, 'start_bonus')", [u.id, u.balance]);
    }
    return syncOwner(u);
  }

  async function ensureUser(id) {
    return syncOwner(await db.one('SELECT * FROM bs_users WHERE id = $1', [id]));
  }

  return { upsertFromTelegram, ensureUser, isOwnerId, hasOwner };
}
