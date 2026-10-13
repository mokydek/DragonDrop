import crypto from 'node:crypto';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Validates Telegram Mini App initData (HMAC-SHA256 with the bot token).
 * Returns { user, authDate, startParam } or null.
 */
export function validateInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
  if (!initData || !botToken || typeof initData !== 'string' || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

  const matches = (skipSignature) => {
    const pairs = [];
    for (const [k, v] of params) {
      if (k === 'hash' || (skipSignature && k === 'signature')) continue;
      pairs.push([k, v]);
    }
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dataCheck = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
    const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
    return safeEqual(calc, hash);
  };
  if (!matches(false) && !(params.has('signature') && matches(true))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (maxAgeSec > 0 && now / 1000 - authDate > maxAgeSec) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return { user, authDate, startParam: params.get('start_param') || null };
}

/** Builds signed initData — used by tests and local tooling. */
export function buildInitData(user, botToken, authDate = Math.floor(Date.now() / 1000), extra = {}) {
  const fields = { auth_date: String(authDate), query_id: 'AAE' + user.id, user: JSON.stringify(user), ...extra };
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const dataCheck = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

/** Login token for the "Play on website" button: userId.version.expiry.signature */
export function signWebToken(userId, ver, secret, ttlSec = 30 * 86400, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const payload = `${userId}.${ver}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifyWebToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [uid, ver, exp, sig] = parts;
  const payload = `${uid}.${ver}.${exp}`;
  const calc = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
  if (!safeEqual(calc, sig)) return null;
  const userId = Number(uid);
  const version = Number(ver);
  const expiry = Number(exp);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(version) || !Number.isFinite(expiry)) return null;
  if (expiry < now / 1000) return null;
  return { userId, ver: version };
}
