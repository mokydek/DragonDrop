import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { T } from './texts.js';

const MEMBER = new Set(['creator', 'administrator', 'member']);

/**
 * getChatMember answers that mean "this player is not in the channel", not "can't check": a player who
 * never joined it can come back as one of these errors instead of the status "left".
 */
const NOT_IN_CHAT = /PARTICIPANT_ID_INVALID|USER_NOT_PARTICIPANT|USER_ID_INVALID|user not found|member not found|participant not found/i;

/** A short hash of a file ('' when it can't be read). */
function fileVersion(file) {
  try {
    return crypto.createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * Telegram calls used outside of update handlers. `files`: the pictures sent by URL
 * ({ banner, bannerHalloween }: paths on disk, see paths in server.js).
 */
export function createTg(getBot, config, files = {}) {
  const versions = {};
  // Telegram keeps a picture it once fetched by its URL, and the old BrainrotSpin used the very same
  // URLs for its banners: the hash of the file in the URL makes Telegram fetch the picture we have now
  const imageUrl = (name, file) => {
    if (!(name in versions)) versions[name] = file ? fileVersion(file) : '';
    return `${config.apiUrl || config.webUrl}/img/${name}.jpg${versions[name] ? `?v=${versions[name]}` : ''}`;
  };

  return {
    get enabled() {
      return !!getBot();
    },
    get botUsername() {
      const bot = getBot();
      return (bot && bot.isInited() && bot.botInfo.username) || '';
    },

    /** Is the player in the channel? Throws when it can't be checked (no such channel, the bot is not an admin there). */
    async isSubscribed(channel, userId) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      let m;
      try {
        m = await bot.api.getChatMember(channel, userId);
      } catch (e) {
        if (e && e.error_code === 400 && NOT_IN_CHAT.test(e.description || '')) return false;
        throw e;
      }
      return MEMBER.has(m.status) || (m.status === 'restricted' && !!m.is_member);
    },

    /** The player's names as Telegram has them right now (works once the player has a chat with the bot). */
    async userNames(userId) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const c = await bot.api.getChat(userId);
      return { first_name: c.first_name || '', last_name: c.last_name || '', username: c.username || '' };
    },

    /** Checks that the channel exists and the bot can see its members (is an admin). */
    async checkChannel(channel) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const chat = await bot.api.getChat(channel);
      const me = await bot.api.getChatMember(channel, bot.botInfo.id);
      return { title: chat.title || chat.username || String(chat.id), botIsAdmin: me.status === 'administrator' || me.status === 'creator' };
    },

    /** Sends a message; never throws. Returns { ok, message } or { ok: false, code }. */
    async send(chatId, text, extra = {}) {
      const bot = getBot();
      if (!bot) return { ok: false, code: 0 };
      try {
        const message = await bot.api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true }, ...extra });
        return { ok: true, message };
      } catch (e) {
        return { ok: false, code: e.error_code || 0, description: e.description || e.message };
      }
    },

    /** Invoice link paid in Telegram Stars (currency XTR, no provider token). */
    async starsInvoice({ title, description, payload, label, stars }) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      return bot.api.createInvoiceLink(title, description, payload, '', 'XTR', [{ label, amount: stars }]);
    },

    shareFallbackUrl(lang, { halloween = false } = {}) {
      const link = `https://t.me/${this.botUsername}`;
      const text = halloween ? T(lang).shareCaptionHalloween : T(lang).shareCaption;
      return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    },

    /** Prepared message for Telegram.WebApp.shareMessage (Bot API 8.0+). */
    async prepareShare(userId, lang, { halloween = false } = {}) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const photo = halloween ? imageUrl('banner-halloween', files.bannerHalloween) : imageUrl('banner', files.banner);
      const res = await bot.api.savePreparedInlineMessage(
        userId,
        {
          type: 'photo',
          id: `share-${userId}-${Date.now()}`,
          photo_url: photo,
          thumbnail_url: photo,
          caption: halloween ? T(lang).shareCaptionHalloween : T(lang).shareCaption,
          reply_markup: {
            inline_keyboard: [[{ text: T(lang).shareButton, url: `https://t.me/${this.botUsername}?start=share` }]],
          },
        },
        { allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true, allow_bot_chats: false },
      );
      return res.id;
    },
  };
}
