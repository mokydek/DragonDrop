import crypto from 'node:crypto';
import { Bot, InputFile, webhookCallback } from 'grammy';
import { signWebToken } from './auth.js';
import { GameError } from './game.js';
import { LANGS, T, pickLang } from './texts.js';
import { MSG_MAX } from './requests.js';

export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member', 'pre_checkout_query'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function createBot({ config, db, settings, game, users, live, paths, requests, invites }) {
  const bot = new Bot(config.botToken, config.telegramApiRoot ? { client: { apiRoot: config.telegramApiRoot } } : {});
  const httpsWeb = /^https:\/\//.test(config.webUrl);
  const adminAttempts = new Map();

  const webAppUrl = () => `${config.webUrl}/`;
  const webLoginUrl = (u) => `${config.webUrl}/?login=${encodeURIComponent(signWebToken(u.id, u.web_ver, config.sessionSecret))}`;

  function newsLink() {
    const ch = settings.get('channel');
    return settings.get('news_url') || settings.get('channel_url') || (ch && ch.startsWith('@') ? `https://t.me/${ch.slice(1)}` : '');
  }

  function startKeyboard(u) {
    const t = T(u.lang);
    const rows = [];
    if (httpsWeb) rows.push([{ text: t.btnPlayTg, web_app: { url: webAppUrl() } }, { text: t.btnPlayWeb, url: webLoginUrl(u) }]);
    const row2 = [];
    const news = newsLink();
    const support = settings.get('support_url');
    if (news) row2.push({ text: t.btnNews, url: news });
    if (support) row2.push({ text: t.btnSupport, url: support });
    if (row2.length) rows.push(row2);
    rows.push([{ text: t.btnPromo, callback_data: 'promo' }]);
    return { inline_keyboard: rows };
  }

  async function sendWelcome(ctx, u) {
    const t = T(u.lang);
    // Halloween (admin switch): the Halloween picture, and the Halloween text unless admins wrote their own
    const halloween = !!settings.get('halloween');
    const caption = settings.get(`welcome_${u.lang}`) || (halloween ? t.welcomeHalloween : t.welcome);
    const banner = halloween ? paths.bannerHalloween : paths.banner;
    const cacheKey = halloween ? '_banner_halloween_file_id' : '_banner_file_id';
    const reply_markup = startKeyboard(u);
    const cached = settings.get(cacheKey);
    let msg;
    try {
      msg = await ctx.replyWithPhoto(cached || new InputFile(banner), { caption, reply_markup });
    } catch (e) {
      if (!cached) throw e;
      msg = await ctx.replyWithPhoto(new InputFile(banner), { caption, reply_markup });
    }
    const fileId = msg?.photo?.at(-1)?.file_id;
    if (fileId && fileId !== cached) await settings.setInternal(cacheKey, fileId);
    if (httpsWeb) {
      await ctx.api
        .setChatMenuButton({ chat_id: ctx.chat.id, menu_button: { type: 'web_app', text: t.menuButton, web_app: { url: webAppUrl() } } })
        .catch((e) => console.warn('[bot] setChatMenuButton failed:', e.message));
    }
  }

  // Keep the users table in sync and count bot users as online.
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) live.touch(ctx.from.id);
    await next();
  });

  // Maintenance (the main admin's switch): the main admin uses the bot as usual, everyone else gets
  // one line. Payments still go through (an invoice made before the maintenance).
  const isMainAdmin = (u) => !!u && u.is_admin && (users.isOwnerId(u.id) || !users.hasOwner());
  bot.use(async (ctx, next) => {
    if (!settings.get('maintenance') || !ctx.from || ctx.from.is_bot) return next();
    if (ctx.preCheckoutQuery || ctx.myChatMember || ctx.message?.successful_payment) return next();
    if (ctx.chat?.type !== 'private') return next();
    // /start keeps the player (to tell them when it is over); anything else only looks the player up
    const start = /^\/start(@\w+)?(\s|$)/i.test(ctx.message?.text || '');
    const u = start ? await users.upsertFromTelegram(ctx.from, { started: true }) : await users.ensureUser(ctx.from.id);
    if (isMainAdmin(u)) return next();
    const t = T(u ? u.lang : pickLang(ctx.from.language_code));
    if (ctx.callbackQuery) return ctx.answerCallbackQuery({ text: t.maintenance }).catch(() => {});
    if (ctx.message) await ctx.reply(t.maintenance);
  });

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const u = await users.upsertFromTelegram(ctx.from, { started: true });
    if (u.is_banned) return ctx.reply(T(u.lang).banned);
    if (u.awaiting) await db.query('UPDATE bs_users SET awaiting = NULL WHERE id = $1', [u.id]);
    // came by a friend's link: the friend gets a share of the player's top-ups
    if (invites && ctx.match) await invites.bind(u, ctx.match).catch((e) => console.warn('[invites] bind failed:', e.message));
    await sendWelcome(ctx, u);
  });

  bot.command('admin', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const u = await users.upsertFromTelegram(ctx.from);
    const t = T(u.lang);
    const now = Date.now();
    const a = adminAttempts.get(u.id) || { n: 0, reset: now + 600_000 };
    if (a.reset < now) Object.assign(a, { n: 0, reset: now + 600_000 });
    a.n += 1;
    adminAttempts.set(u.id, a);
    const code = String(ctx.match || '').trim();
    if (a.n > 5 || !config.adminCode || !code || !safeEqual(code, config.adminCode)) return ctx.reply(t.adminBad);
    await db.query('UPDATE bs_users SET is_admin = TRUE WHERE id = $1', [u.id]);
    return ctx.reply(t.adminOk, httpsWeb ? { reply_markup: { inline_keyboard: [[{ text: t.btnPlayTg, web_app: { url: webAppUrl() } }]] } } : {});
  });

  bot.callbackQuery('promo', async (ctx) => {
    const u = await users.upsertFromTelegram(ctx.from);
    await ctx.answerCallbackQuery();
    if (u.is_banned) return;
    await db.query("UPDATE bs_users SET awaiting = 'promo' WHERE id = $1", [u.id]);
    await ctx.reply(T(u.lang).promoAsk, { reply_markup: { force_reply: true, input_field_placeholder: 'PROMO' } });
  });

  // "Reply" / "Write" under a request message: the next text goes to the admins.
  bot.callbackQuery(/^rq:(\d{1,15})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== 'private') return;
    const u = await users.ensureUser(ctx.from.id);
    if (!u || u.is_banned) return;
    const id = Number(ctx.match[1]);
    const r = await requests.ownRequest(u.id, id);
    if (!r) return;
    const t = T(u.lang);
    if (r.status === 'done' || r.status === 'rejected') return ctx.reply(t.reqClosed(id));
    await db.query('UPDATE bs_users SET awaiting = $2 WHERE id = $1', [u.id, `rq:${id}`]);
    await ctx.reply(t.replyAsk(id), { reply_markup: { force_reply: true } });
  });

  // ------------------------------------------------------------ Telegram Stars
  bot.on('pre_checkout_query', async (ctx) => {
    let ok = false;
    try {
      ok = await requests.preCheckout(ctx.preCheckoutQuery);
    } catch (e) {
      console.error('[stars] pre-checkout check failed:', e.message);
    }
    const u = ok ? null : await users.ensureUser(ctx.from.id).catch(() => null);
    await ctx.answerPreCheckoutQuery(ok, ok ? undefined : { error_message: T(u ? u.lang : 'ru').payCheckFailed });
  });

  bot.on('message:successful_payment', async (ctx) => {
    const r = await requests.creditStars(ctx.from.id, ctx.message.successful_payment);
    if (r && !r.duplicate) await ctx.reply(T(r.lang).starsOk(r.coins + (r.bonus || 0) + (r.promoBonus || 0), r.balance));
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    const u = await users.ensureUser(ctx.from.id);
    if (!u || u.is_banned) return;
    const t = T(u.lang);

    // a message for the admins about a request: after "Reply", or a Telegram reply to a request message
    let reqId = u.awaiting && u.awaiting.startsWith('rq:') ? Number(u.awaiting.slice(3)) : null;
    if (!reqId && ctx.message.reply_to_message && ctx.message.reply_to_message.from?.id === ctx.me.id) {
      reqId = await requests.findByTgMessage(u.id, ctx.message.reply_to_message.message_id);
    }
    if (reqId) {
      if (u.awaiting) await db.query('UPDATE bs_users SET awaiting = NULL WHERE id = $1', [u.id]);
      try {
        await requests.userReply(u, reqId, text.slice(0, MSG_MAX));
        await ctx.reply(t.replySent);
      } catch (e) {
        if (!(e instanceof GameError)) console.error('[bot] request reply error:', e);
        else if (e.code === 'request_closed') await ctx.reply(t.reqClosed(reqId));
      }
      return;
    }

    if (u.awaiting !== 'promo') return;
    await db.query('UPDATE bs_users SET awaiting = NULL WHERE id = $1', [u.id]);
    try {
      const r = await game.redeemPromo(u.id, text);
      await ctx.reply(t.promoOk(r.amount, r.balance));
    } catch (e) {
      let err = e;
      // not a promo code of the admins: maybe a friend's code (their partner promo code)
      if (e instanceof GameError && e.code === 'promo_invalid' && invites) {
        try {
          const friend = await invites.useCode(u, text);
          if (friend) return ctx.reply(t.friendCodeOk(friend.inviter.name));
        } catch (e2) {
          err = e2;
        }
      }
      if (!(err instanceof GameError)) console.error('[bot] promo error:', err);
      await ctx.reply(t.promoErr[err.code] || t.promoErr.default);
    }
  });

  bot.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const status = ctx.myChatMember.new_chat_member.status;
    await db.query('UPDATE bs_users SET blocked_bot = $2 WHERE id = $1', [ctx.from.id, status === 'kicked']);
  });

  bot.catch((err) => console.error('[bot] handler error:', err.error?.message || err.message));

  // ------------------------------------------------------------ profile
  async function setupProfile() {
    const desc = Object.fromEntries(LANGS.map((l) => [l, [T(l).description, T(l).shortDescription, T(l).cmdStart]]));
    const avatarHash = crypto.createHash('sha1').update(paths.avatarBytes()).digest('hex');
    const hash = crypto.createHash('sha1').update(JSON.stringify({ desc, web: config.webUrl, name: 'DragonDrop', avatarHash, v: 2 })).digest('hex');
    if (settings.get('_profile_hash') === hash) return false;
    const api = bot.api;
    const soft = (p, label) => p.catch((e) => console.warn(`[bot] ${label} failed:`, e.description || e.message));
    if (bot.botInfo.first_name !== 'DragonDrop') await soft(api.setMyName('DragonDrop'), 'setMyName');
    for (const lang of ['', ...LANGS]) {
      const t = T(lang || 'ru');
      const extra = lang ? { language_code: lang } : {};
      await soft(api.setMyDescription(t.description, extra), 'setMyDescription');
      await soft(api.setMyShortDescription(t.shortDescription, extra), 'setMyShortDescription');
      await soft(api.setMyCommands([{ command: 'start', description: t.cmdStart }], extra), 'setMyCommands');
    }
    if (httpsWeb) {
      await soft(
        api.setChatMenuButton({ menu_button: { type: 'web_app', text: T('ru').menuButton, web_app: { url: webAppUrl() } } }),
        'setChatMenuButton',
      );
    }
    if (settings.get('_avatar_hash') !== avatarHash) {
      try {
        await api.setMyProfilePhoto({ type: 'static', photo: new InputFile(paths.avatar) });
        await settings.setInternal('_avatar_hash', avatarHash);
      } catch (e) {
        console.warn('[bot] setMyProfilePhoto failed:', e.description || e.message);
      }
    }
    await settings.setInternal('_profile_hash', hash);
    return true;
  }

  async function setupWebhook() {
    const url = `${config.apiUrl}${config.webhookPath}`;
    const info = await bot.api.getWebhookInfo();
    const have = [...(info.allowed_updates || [])].sort().join(',');
    if (info.url !== url || have !== [...ALLOWED_UPDATES].sort().join(',')) {
      await bot.api.setWebhook(url, {
        secret_token: config.webhookSecret,
        allowed_updates: ALLOWED_UPDATES,
      });
      console.log('[bot] webhook set to', url);
    }
  }

  // ------------------------------------------------------------ broadcast
  let bcast = { running: false, total: 0, sent: 0, failed: 0, startedAt: null, finishedAt: null };
  const broadcaster = {
    status: () => ({ ...bcast }),
    async start(text, { withButton = true } = {}) {
      // Claim the slot synchronously so two requests can't start two broadcasts.
      if (bcast.running) throw new GameError('broadcast_running');
      bcast = { running: true, total: 0, sent: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: null };
      let list;
      try {
        list = await db.many('SELECT id, lang FROM bs_users WHERE started_bot AND NOT blocked_bot AND NOT is_banned ORDER BY id');
      } catch (e) {
        bcast.running = false;
        throw e;
      }
      bcast.total = list.length;
      (async () => {
        for (const u of list) {
          const extra = { link_preview_options: { is_disabled: true } };
          if (withButton && httpsWeb) {
            extra.reply_markup = { inline_keyboard: [[{ text: T(u.lang).btnPlayTg, web_app: { url: webAppUrl() } }]] };
          }
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await bot.api.sendMessage(u.id, text, extra);
              bcast.sent++;
              break;
            } catch (e) {
              if (e.error_code === 429 && attempt < 2) {
                await sleep(((e.parameters && e.parameters.retry_after) || 1) * 1000 + 250);
                continue;
              }
              if (e.error_code === 403) {
                await db.query('UPDATE bs_users SET blocked_bot = TRUE WHERE id = $1', [u.id]).catch(() => {});
              }
              bcast.failed++;
              break;
            }
          }
          await sleep(config.isTest ? 0 : 40);
        }
        bcast.running = false;
        bcast.finishedAt = new Date().toISOString();
      })().catch((e) => {
        console.error('[bot] broadcast crashed:', e);
        bcast.running = false;
      });
      return broadcaster.status();
    },
  };

  const webhookHandler = webhookCallback(bot, 'express', { secretToken: config.webhookSecret, onTimeout: 'return' });

  return { bot, setupProfile, setupWebhook, broadcaster, webhookHandler, sendWelcome, startKeyboard };
}
