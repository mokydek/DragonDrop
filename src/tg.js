import { T } from './texts.js';

const MEMBER = new Set(['creator', 'administrator', 'member']);

/** Telegram calls used outside of update handlers. */
export function createTg(getBot, config) {
  return {
    get enabled() {
      return !!getBot();
    },
    get botUsername() {
      const bot = getBot();
      return (bot && bot.isInited() && bot.botInfo.username) || '';
    },

    async isSubscribed(channel, userId) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const m = await bot.api.getChatMember(channel, userId);
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
      const base = config.apiUrl || config.webUrl;
      const photo = `${base}/img/${halloween ? 'banner-halloween' : 'banner'}.jpg`;
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
