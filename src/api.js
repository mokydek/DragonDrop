import express from 'express';
import { validateInitData, verifyWebToken } from './auth.js';
import { GameError } from './game.js';
import { LANGS } from './texts.js';
import { THEMES } from './users.js';
import { normRef } from './referrals.js';
import { GATES, gatesState } from './access.js';

/** Sends GameError / unexpected errors as { error } JSON. */
export function sendError(res, e) {
  if (e instanceof GameError) return res.status(e.status).json({ error: e.code, ...e.extra });
  if (e && e.code === 'bad_setting') return res.status(400).json({ error: 'bad_setting', key: e.key, message: e.message });
  if (e && e.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request' });
  if (e && e.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  console.error('[api] unexpected error:', e);
  return res.status(500).json({ error: 'server_error' });
}

export const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    sendError(res, e);
  }
};

/** Very small fixed-window limiter keyed by user id. */
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs * 2);
  timer.unref?.();
  return (req, res, next) => {
    const key = req.user ? req.user.id : req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.n > limit) return res.status(429).json({ error: 'rate_limited' });
    next();
  };
}

export function createAuth({ config, db, users, live, settings, access }) {
  const lastSeenWrite = new Map();
  return async function auth(req, res, next) {
    try {
      const h = req.get('authorization') || '';
      let user = null;
      if (h.startsWith('tma ')) {
        const data = validateInitData(h.slice(4), config.botToken, config.initDataMaxAge);
        if (!data) return res.status(401).json({ error: 'unauthorized' });
        req.tgUser = data.user;
        req.startParam = data.startParam; // the Mini App opened by a link with ?startapp=…
        // Bootstrap refreshes the profile (name, username, photo); other calls just load the row.
        user = req.path === '/bootstrap' ? null : await users.ensureUser(data.user.id);
        if (!user) user = await users.upsertFromTelegram(data.user);
      } else if (h.startsWith('web ')) {
        const t = verifyWebToken(h.slice(4), config.sessionSecret);
        if (!t) return res.status(401).json({ error: 'unauthorized' });
        user = await users.ensureUser(t.userId);
        if (!user || user.web_ver !== t.ver) return res.status(401).json({ error: 'unauthorized' });
      } else {
        return res.status(401).json({ error: 'unauthorized' });
      }
      if (user.is_banned) return res.status(403).json({ error: 'banned' });
      // maintenance (the main admin's switch): only the main admin gets in
      if (settings.get('maintenance') && !(user.is_admin && access.isMain(user.id))) return res.status(403).json({ error: 'maintenance' });
      req.user = user;
      live.touch(user.id);
      const now = Date.now();
      if ((lastSeenWrite.get(user.id) || 0) < now - 60_000) {
        lastSeenWrite.set(user.id, now);
        db.query('UPDATE bs_users SET last_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
      }
      next();
    } catch (e) {
      sendError(res, e);
    }
  };
}

export function meView(u) {
  return {
    id: u.id,
    name: u.first_name || u.username || `#${u.id}`,
    username: u.username,
    photo: u.photo_url && /^https:\/\//.test(u.photo_url) ? u.photo_url : null,
    lang: u.lang,
    theme: u.theme,
    balance: u.balance,
    isAdmin: u.is_admin,
    nick: u.roblox_nick || null,
    ref: u.ref_code || null, // referral code the player came with
    createdAt: u.created_at,
  };
}

export function createApi(deps) {
  const { config, db, settings, game, live, users, tg, requests, access, crash, dice, referrals, autoPromo, invites } = deps;
  // admins: which admin panel sections they see (the main admin decides for the others)
  const adminPart = (u) => (u.is_admin ? { adminSections: access.sections(u.id) } : {});
  const r = express.Router();
  const auth = createAuth(deps);
  const limitActions = rateLimiter(12, 3000);
  const limitLight = rateLimiter(60, 10_000);
  // top-ups: coins for a Star; whether brainrot deposits are open (admins close them for a while); what
  // the buffs of a deposited brainrot add to its price
  const topupState = () => {
    const open = settings.get(GATES.deposits) !== false; // top-ups as a whole (the main admin's switch)
    return {
      starsRate: settings.get('stars_rate'),
      starsOpen: open,
      brainrotsOpen: open && settings.get('deposits_brainrots_open') !== false,
      buffs: settings.get('buffs'),
    };
  };
  // what players can use now (the main admin closes a part for a while); top-ups are in topupState
  const modes = () => {
    const { deposits, ...rest } = gatesState(settings);
    return rest;
  };
  // a closed part refuses the request before anything happens
  const gate = (name, code) => (req, res, next) => (settings.get(GATES[name]) === false ? res.status(403).json({ error: code }) : next());
  const casesGate = gate('cases', 'cases_closed');

  r.get('/health', (req, res) => res.json({ ok: true, bot: tg.botUsername || null }));

  // public: any site may read it (the old BrainrotSpin page links to this bot); the maintenance screen
  // asks it whether the maintenance is over
  r.get('/public', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ bot: tg.botUsername || null, webUrl: config.webUrl || null, maintenance: !!settings.get('maintenance') });
  });

  r.get('/feed', (req, res) => res.json(live.snapshot()));
  r.get('/stream', (req, res) => live.sseHandler(req, res));

  // uploaded pictures of items and cases (stored as data URLs)
  const sendImage = (table) => async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return res.status(404).end();
    const row = await db.one(`SELECT image_data FROM ${table} WHERE id = $1`, [id]).catch(() => null);
    const m = row && /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(row.image_data || '');
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(Buffer.from(m[3], 'base64'));
  };
  r.get('/img/item/:id', sendImage('bs_items'));
  r.get('/img/case/:id', sendImage('bs_cases'));

  // ------------------------------------------------------------ player
  r.post(
    '/bootstrap',
    auth,
    limitLight,
    wrap(async (req) => {
      const u = req.user;
      // opened by a friend's link (?startapp=inv_CODE): the friend gets a share of the player's top-ups
      if (invites && req.startParam) await invites.bind(u, req.startParam).catch((e) => console.warn('[invites] bind failed:', e.message));
      return {
        me: meView(u),
        ...adminPart(u),
        cases: game.listCases(),
        categories: game.listCategories(),
        items: game.listItems(),
        withdrawIds: game.withdrawIds(),
        depositIds: game.depositIds(),
        upgrade: game.upgradeSettings(u),
        crash: crash.publicConfig(),
        dice: dice.publicConfig(),
        autoPromo: await autoPromo.publicState(u),
        free: game.freeState(u),
        nick: game.nickState(u),
        share: game.shareState(u),
        live: live.snapshot(),
        stats: await game.stats(u.id),
        inventory: await game.inventory(u.id),
        bot: tg.botUsername || null,
        topup: topupState(),
        queue: await requests.queueState(u.id), // the brainrot deposit in the queue (or being handled), if any
        withdraw: await requests.withdrawState(u), // withdrawals open after the first top-ups (Stars or brainrots)
        modes: modes(),
        halloween: !!settings.get('halloween'),
        partner: await referrals.isPartner(u.id), // has a referral code of their own (the "Referrals" screen)
        links: {
          news: settings.get('news_url') || settings.get('channel_url') || null,
          support: settings.get('support_url') || null,
        },
      };
    }),
  );

  r.post('/ping', auth, limitLight, (req, res) => res.json({ online: live.online() }));

  r.post(
    '/prefs',
    auth,
    limitLight,
    wrap(async (req) => {
      const { lang, theme } = req.body || {};
      if (lang !== undefined && !LANGS.includes(lang)) throw new GameError('bad_request');
      if (theme !== undefined && !THEMES.includes(theme)) throw new GameError('bad_request');
      const u = await db.one(
        'UPDATE bs_users SET lang = COALESCE($2, lang), theme = COALESCE($3, theme) WHERE id = $1 RETURNING lang, theme',
        [req.user.id, lang ?? null, theme ?? null],
      );
      return u;
    }),
  );

  r.get(
    '/me',
    auth,
    limitLight,
    wrap(async (req) => ({
      me: meView(req.user),
      ...adminPart(req.user),
      stats: await game.stats(req.user.id),
      free: game.freeState(req.user),
      nick: game.nickState(req.user),
      share: game.shareState(req.user),
      partner: await referrals.isPartner(req.user.id),
      topup: topupState(),
      queue: await requests.queueState(req.user.id),
      withdraw: await requests.withdrawState(req.user),
      modes: modes(),
    })),
  );
  // a partner's referral codes: level, stats and the players who came with them
  r.get('/referrals/mine', auth, limitLight, wrap(async (req) => referrals.mine(req.user.id)));

  // ------------------------------------------------------------ invite friends
  // the player's own link, the friends who came by it and what their top-ups brought; moving it to the balance
  r.get('/invites', auth, limitLight, wrap(async (req) => invites.state(req.user)));
  r.post('/invites/claim', auth, limitActions, wrap(async (req) => invites.claim(req.user)));
  // the link sent from the app: a prepared message (picture, caption, a button with the link) or a share link
  r.post(
    '/invites/share',
    auth,
    limitActions,
    wrap(async (req) => {
      const url = invites.link(await invites.codeOf(req.user.id));
      if (!url) throw new GameError('bot_disabled', 503);
      const opts = { halloween: !!settings.get('halloween'), url };
      let preparedId = null;
      if (tg.enabled && String(req.get('authorization') || '').startsWith('tma ')) {
        try {
          preparedId = await tg.prepareShare(req.user.id, req.user.lang, opts);
        } catch (e) {
          console.warn('[invites] savePreparedInlineMessage failed:', e.message);
        }
      }
      return { preparedId, url: tg.shareFallbackUrl(req.user.lang, opts) };
    }),
  );
  r.get('/inventory', auth, limitLight, wrap(async (req) => ({ inventory: await game.inventory(req.user.id) })));
  r.get(
    '/catalog',
    auth,
    limitLight,
    wrap(async (req) => ({
      cases: game.listCases(),
      categories: game.listCategories(),
      items: game.listItems(),
      withdrawIds: game.withdrawIds(),
      depositIds: game.depositIds(),
      upgrade: game.upgradeSettings(req.user),
      crash: crash.publicConfig(),
      dice: dice.publicConfig(),
      autoPromo: await autoPromo.publicState(req.user),
      topup: topupState(),
      modes: modes(),
      halloween: !!settings.get('halloween'),
    })),
  );

  r.post('/case/:id/open', auth, casesGate, limitActions, wrap(async (req) => game.openCase(req.user, req.params.id, (req.body || {}).count)));

  // ------------------------------------------------------------ rocket (crash)
  const crashId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new GameError('bad_request');
    return id;
  };
  r.post('/crash/start', auth, gate('crash', 'crash_closed'), limitActions, wrap(async (req) => crash.start(req.user, req.body || {})));
  r.get('/crash/active', auth, limitLight, wrap(async (req) => ({ round: await crash.active(req.user) })));
  r.post('/crash/:id/cashout', auth, limitActions, wrap(async (req) => crash.cashout(req.user, crashId(req))));
  r.post('/crash/:id/wait', auth, limitLight, wrap(async (req) => crash.wait(req.user, crashId(req))));

  // ------------------------------------------------------------ colour dice
  r.post('/dice/roll', auth, gate('dice', 'dice_closed'), limitActions, wrap(async (req) => dice.roll(req.user, req.body || {})));

  r.post(
    '/free/check',
    auth,
    limitActions,
    wrap(async (req) => {
      // one channel for both: checked when the FREE case or the share case needs the subscription
      const st = game.freeState(req.user);
      const share = game.shareState(req.user);
      const subscribed = st.requireSub || share.requireSub ? await game.checkSubscription(req.user.id) : true;
      return { ...st, subscribed, share };
    }),
  );

  r.post(
    '/free/share',
    auth,
    limitActions,
    wrap(async (req) => {
      const lang = req.user.lang;
      const opts = { halloween: !!settings.get('halloween') }; // the Halloween picture and caption while it's on
      let preparedId = null;
      if (tg.enabled && req.get('authorization').startsWith('tma ')) {
        try {
          preparedId = await tg.prepareShare(req.user.id, lang, opts);
        } catch (e) {
          console.warn('[share] savePreparedInlineMessage failed:', e.message);
        }
      }
      return { preparedId, url: tg.shareFallbackUrl(lang, opts) };
    }),
  );

  r.post(
    '/free/shared',
    auth,
    limitActions,
    wrap(async (req) => {
      await game.markShared(req.user.id);
      const u = await users.ensureUser(req.user.id);
      return { ...game.freeState(u), share: game.shareState(u) };
    }),
  );

  r.post('/free/open', auth, casesGate, limitActions, wrap(async (req) => game.openFree(req.user)));
  // the nick case: Telegram is asked for the player's current name (req.tgUser is the signed fallback)
  r.post('/nick/open', auth, casesGate, limitActions, wrap(async (req) => game.openNick(req.user, req.tgUser)));
  // the share case: opens after share_case_count shares of the bot (counted by /free/shared)
  r.post('/share/open', auth, casesGate, limitActions, wrap(async (req) => game.openShare(req.user)));

  r.post('/sell', auth, limitActions, wrap(async (req) => game.sell(req.user.id, req.body || {})));

  r.post('/upgrade', auth, gate('upgrade', 'upgrade_closed'), limitActions, wrap(async (req) => game.upgrade(req.user, req.body || {})));

  r.post('/promo', auth, limitActions, wrap(async (req) => game.redeemPromo(req.user.id, (req.body || {}).code)));

  // ------------------------------------------------------------ auto promo code
  r.get('/auto-promo', auth, limitLight, wrap(async (req) => ({ autoPromo: await autoPromo.publicState(req.user) })));

  /**
   * The code typed in a top-up form: the auto promo code of this moment (its bonus comes with this
   * top-up) or a referral code (ties the player to it the first time; a tied player keeps theirs).
   */
  async function topupCode(user, raw) {
    const promo = await autoPromo.match(user, raw);
    if (promo) return { promo, ref: user.ref_code || null };
    const code = normRef(raw);
    if (code && user.ref_code) {
      // already tied to a code: another referral code changes nothing, anything else is a mistake
      if (await referrals.exists(code)) return { promo: null, ref: user.ref_code };
      throw new GameError((await autoPromo.expired(code)) ? 'promo_expired' : 'bad_ref');
    }
    try {
      return { promo: null, ref: await referrals.bind(user, raw) };
    } catch (e) {
      if (e.code === 'bad_ref' && (await autoPromo.expired(code))) throw new GameError('promo_expired');
      throw e;
    }
  }

  // ------------------------------------------------------------ deposits & withdrawals
  // top-ups: the code typed in is the auto promo code (a bonus to this top-up) or a referral code
  // (first time only: ties the player to it before the deposit)
  r.post(
    '/topup/stars',
    auth,
    gate('deposits', 'topup_closed'),
    limitActions,
    wrap(async (req) => {
      const b = req.body || {};
      const { promo, ref } = await topupCode(req.user, b.ref);
      return { ...(await requests.starsInvoice(req.user, b.stars, promo)), ref };
    }),
  );
  r.get('/topup/stars/:invoice', auth, limitLight, wrap(async (req) => requests.invoiceStatus(req.user, req.params.invoice)));
  r.post(
    '/requests/deposit',
    auth,
    gate('deposits', 'topup_closed'),
    limitActions,
    wrap(async (req) => {
      const b = req.body || {};
      const { promo, ref } = await topupCode(req.user, b.ref);
      return { ...(await requests.createDeposit(req.user, b, promo)), ref };
    }),
  );
  r.post('/requests/withdraw', auth, gate('withdrawals', 'withdrawals_closed'), limitActions, wrap(async (req) => requests.createWithdraw(req.user, req.body || {})));

  // the deposit queue: the player's place and time (?id= a request of theirs, else the open one), cancel
  const reqParam = (v) => {
    const id = Number(v);
    if (!Number.isSafeInteger(id) || id < 1) throw new GameError('bad_request');
    return id;
  };
  r.get(
    '/requests/queue',
    auth,
    limitLight,
    wrap(async (req) => ({ queue: await requests.queueState(req.user.id, req.query.id === undefined ? null : reqParam(req.query.id)) })),
  );
  r.post('/requests/:id/cancel', auth, limitActions, wrap(async (req) => requests.cancel(req.user, reqParam(req.params.id))));

  return { router: r, auth };
}
