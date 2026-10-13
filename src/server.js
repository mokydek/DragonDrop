import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb, migrate, addNickCaseOnce, addShareCaseOnce } from './db.js';
import { createSettings, lowerLuckOnce, tuneRocketOnce, diceFromFiveOnce } from './settings.js';
import { createGame } from './game.js';
import { createLive } from './live.js';
import { createUsers } from './users.js';
import { createTg } from './tg.js';
import { createApi, sendError } from './api.js';
import { createAdmin } from './admin.js';
import { createBot, ALLOWED_UPDATES } from './bot.js';
import { createRequests } from './requests.js';
import { createAccess } from './access.js';
import { createCrash } from './crash.js';
import { createDice } from './dice.js';
import { createAutoPromo } from './autopromo.js';
import { createReferrals, levelsOnce } from './referrals.js';
import { GameError } from './game.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  web: path.join(root, 'web'),
  banner: path.join(root, 'web', 'img', 'banner.jpg'),
  bannerHalloween: path.join(root, 'web', 'img', 'banner-halloween.jpg'),
  avatar: path.join(root, 'assets', 'avatar.jpg'),
  avatarBytes: () => readFileSync(path.join(root, 'assets', 'avatar.jpg')),
};

function cors(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

const noBroadcaster = {
  status: () => ({ running: false, total: 0, sent: 0, failed: 0, startedAt: null, finishedAt: null }),
  start: async () => {
    throw new GameError('bot_disabled', 503);
  },
};

/** Builds the whole app. Call start() to listen and connect the bot. */
export async function createServer(env = process.env, overrides = {}) {
  const config = { ...loadConfig(env), ...(overrides.config || {}) };
  const db = overrides.db || createDb(config.databaseUrl, config.databaseSsl, config.databaseSchema);
  await migrate(db);
  const settings = createSettings(db);
  await settings.load();
  await lowerLuckOnce(settings).catch((e) => console.warn('[settings] bad luck 1.06:', e.message));
  await tuneRocketOnce(settings).catch((e) => console.warn('[settings] rocket tune:', e.message));
  await diceFromFiveOnce(settings).catch((e) => console.warn('[settings] dice from 5:', e.message));
  await addNickCaseOnce(db, settings).catch((e) => console.warn('[db] nick case:', e.message));
  await addShareCaseOnce(db, settings).catch((e) => console.warn('[db] share case:', e.message));
  await levelsOnce(db, settings).catch((e) => console.warn('[db] referral levels:', e.message));

  const holder = { bot: null, game: null };
  const tg = overrides.tg || createTg(() => holder.bot, config);
  const live = createLive({
    db,
    getPublicItem: (id) => holder.game.publicItem(holder.game.catalog.items.get(id)),
    // Drops appear in the live feed when the opening animation ends (≈6 s).
    revealDelayMs: Number(env.REVEAL_DELAY_MS ?? (config.isTest ? 0 : 6200)),
  });
  const game = createGame({ db, settings, live, tg, rng: overrides.rng });
  holder.game = game;
  await game.reloadCatalog();
  await live.init();
  const users = createUsers({ db, settings, config });
  const access = createAccess({ settings, users });
  const referrals = createReferrals({ db, settings });
  const autoPromo = createAutoPromo({ db, settings, rng: overrides.autoPromoRng, now: overrides.now });
  const requests = createRequests({ db, settings, game, tg, config, access, referrals, autoPromo });
  const crash = createCrash({ db, settings, game, rng: overrides.rng, now: overrides.now });
  const dice = createDice({ db, settings, game, rng: overrides.rng });

  let botPart = null;
  if (config.botToken && config.botMode !== 'off') {
    botPart = createBot({ config, db, settings, game, users, live, paths, requests });
    holder.bot = botPart.bot;
  }

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(cors(config));

  if (botPart) app.post(config.webhookPath, express.json({ limit: '1mb' }), botPart.webhookHandler);

  const { router, auth } = createApi({ config, db, settings, game, live, users, tg, requests, access, crash, dice, referrals, autoPromo });
  app.use(
    '/api/admin',
    express.json({ limit: '1mb' }),
    auth,
    createAdmin({ db, settings, game, live, tg, users, requests, access, referrals, broadcaster: botPart ? botPart.broadcaster : noBroadcaster }),
  );
  app.use('/api', express.json({ limit: '64kb' }), router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  app.use(
    express.static(paths.web, {
      index: 'index.html',
      setHeaders(res, file) {
        // the page, its scripts and styles are checked on every load (an unchanged file is a quick 304),
        // so after a release nobody runs a new script with an old cached one (e.g. without new texts)
        if (/\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-cache');
        else res.set('Cache-Control', 'public, max-age=3600');
      },
    }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => sendError(res, err));

  let server = null;
  const ctx = { config, db, settings, game, live, users, tg, requests, crash, dice, referrals, autoPromo, bot: botPart, app };

  ctx.start = async (port = config.port) => {
    await new Promise((resolve) => {
      server = app.listen(port, resolve);
    });
    ctx.port = server.address().port;
    if (botPart) {
      try {
        await botPart.bot.init();
        console.log(`[bot] @${botPart.bot.botInfo.username} ready (${config.botMode})`);
        if (config.botMode === 'webhook') await botPart.setupWebhook();
        else if (config.botMode === 'polling') {
          await botPart.bot.api.deleteWebhook();
          botPart.bot.start({ allowed_updates: ALLOWED_UPDATES }).catch((e) =>
            console.error('[bot] polling stopped:', e.message),
          );
        }
        if (config.setupBotProfile) {
          botPart.setupProfile().catch((e) => console.warn('[bot] profile setup failed:', e.message));
        }
      } catch (e) {
        console.error('[bot] failed to start:', e.description || e.message);
      }
    }
    return ctx.port;
  };

  ctx.stop = async () => {
    live.stop();
    crash.close();
    if (botPart && botPart.bot.isRunning()) await botPart.bot.stop();
    if (server) await new Promise((r) => server.close(r));
    if (!overrides.db) await db.end();
  };

  return ctx;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ctx = await createServer();
  const port = await ctx.start();
  console.log(`[server] listening on :${port}`);
  const shutdown = async () => {
    console.log('[server] shutting down');
    await ctx.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
