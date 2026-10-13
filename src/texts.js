// Bot texts in Russian, Ukrainian and English.

export const LANGS = ['ru', 'uk', 'en'];

export function pickLang(code) {
  const c = String(code || '').toLowerCase();
  if (!c) return 'ru';
  if (c.startsWith('uk')) return 'uk';
  if (c.startsWith('ru') || c.startsWith('be') || c.startsWith('kk') || c.startsWith('uz') || c.startsWith('ky')) return 'ru';
  return 'en';
}

const fmt = (n, lang) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : lang === 'uk' ? 'uk-UA' : 'ru-RU').format(n);

export const TEXTS = {
  ru: {
    welcome:
      '😎 Добро пожаловать в DragonDrop!\n\n' +
      'Кейсы и апгрейдер по игре «Steal a Brainrot»:\n' +
      '» Открывай кейсы и собирай брейнротов\n' +
      '» Прокачивай их в Апгрейдере\n' +
      '» Бесплатный кейс каждый день 🎁\n\n' +
      '🍀 Испытай удачу!\n\n' +
      'Кнопка «Играть на сайте» сразу входит в твой аккаунт — никому её не пересылай.',
    welcomeHalloween:
      '🎃 Хэллоуин в DragonDrop! 👻\n\n' +
      'Кейсы и апгрейдер по игре «Steal a Brainrot»:\n' +
      '» Открывай кейсы и собирай брейнротов\n' +
      '» Прокачивай их в Апгрейдере\n' +
      '» Бесплатный кейс каждый день 🎁\n\n' +
      '🦇 Испытай удачу в самую жуткую ночь года!\n\n' +
      'Кнопка «Играть на сайте» сразу входит в твой аккаунт — никому её не пересылай.',
    btnPlayTg: '🎮 Играть в Telegram',
    btnPlayWeb: '🌐 Играть на сайте',
    btnNews: '📢 Новости',
    btnSupport: '💬 Поддержка',
    btnPromo: '🎁 Ввести промокод',
    menuButton: 'Играть',
    promoAsk: '🎁 Отправь промокод одним сообщением:',
    promoOk: (amount, balance) => `✅ Промокод активирован: +${fmt(amount, 'ru')} 🪙\nБаланс: ${fmt(balance, 'ru')} 🪙`,
    promoErr: {
      promo_invalid: '❌ Такого промокода нет.',
      promo_expired: '⌛ Срок действия промокода истёк.',
      promo_used: '⚠️ Ты уже активировал этот промокод.',
      promo_limit: '⚠️ У промокода закончились активации.',
      default: '❌ Не получилось активировать промокод, попробуй позже.',
    },
    adminOk: '✅ Готово, теперь ты админ. Админ-панель — во вкладке «Админ» в приложении.',
    adminBad: '❌ Неверный код.',
    banned: '⛔ Доступ к боту ограничен.',
    maintenance: '🛠 Технические работы — скоро вернёмся.',
    description: 'DragonDrop 🎁\nКейсы и апгрейдер по игре «Steal a Brainrot».',
    shortDescription: 'DragonDrop — кейсы и апгрейдер по игре «Steal a Brainrot» 🎁',
    cmdStart: 'Главное меню',
    shareCaption: '🎁 Залетай в DragonDrop — открывай кейсы с брейнротами из «Steal a Brainrot»!',
    shareCaptionHalloween: '🎃 Хэллоуин в DragonDrop — залетай и открывай кейсы с брейнротами из «Steal a Brainrot»! 👻',
    shareButton: '🎮 Играть',
    btnWrite: '✍️ Написать',
    btnReply: '✍️ Ответить',
    btnOpenRequest: '📂 Открыть заявку',
    depositCreated: (id, nick, details) =>
      `📥 Заявка на пополнение #${id} принята.\n\nНик в Roblox: ${nick}\nЧто пополняешь: ${details}\n\nАдминистратор свяжется с тобой в этом чате.`,
    withdrawCreated: (id, nick, items, total, rest) =>
      `📤 Заявка на вывод #${id} принята.\n\nНик в Roblox: ${nick}\nБрейнроты: ${items}\nНа сумму: ${fmt(total, 'ru')} 🪙` +
      (rest ? `\nОстаток на баланс: +${fmt(rest, 'ru')} 🪙` : '') +
      `\n\nАдминистратор свяжется с тобой в этом чате.`,
    adminMsg: (id, text) => `💬 Администратор по заявке #${id}:\n\n${text}`,
    replyAsk: (id) => `✍️ Напиши сообщение по заявке #${id}:`,
    replySent: '✅ Сообщение отправлено администратору.',
    reqClosed: (id) => `⚠️ Заявка #${id} уже закрыта.`,
    depositDone: (id, coins, items) =>
      `✅ Заявка на пополнение #${id} выполнена.` +
      (coins ? `\nЗачислено: +${fmt(coins, 'ru')} 🪙` : '') +
      (items ? `\nВыдано: ${items}` : ''),
    withdrawDone: (id) => `✅ Вывод по заявке #${id} выполнен.`,
    rejected: (id, kind) => `❌ Заявка #${id} отклонена.` + (kind === 'withdraw' ? '\nБрейнроты вернулись в инвентарь.' : ''),
    starsOk: (coins, balance) => `✅ Оплата получена: +${fmt(coins, 'ru')} 🪙\nБаланс: ${fmt(balance, 'ru')} 🪙`,
    invoiceTitle: 'Пополнение баланса',
    invoiceDesc: (coins) => `${fmt(coins, 'ru')} монет в DragonDrop`,
    invoiceLabel: (coins) => `${fmt(coins, 'ru')} монет`,
    payCheckFailed: 'Платёж не прошёл проверку. Создай новый счёт в приложении.',
    aNewDeposit: (id, who, nick, details) => `🆕 Пополнение #${id}\n\n👤 ${who}\n🎮 Ник: ${nick}\n📝 ${details}`,
    aNewWithdraw: (id, who, nick, items, total) => `🆕 Вывод #${id}\n\n👤 ${who}\n🎮 Ник: ${nick}\n🧠 ${items}\n💰 ${fmt(total, 'ru')} 🪙`,
    aUserReply: (id, who, text) => `💬 Заявка #${id} — ${who}:\n\n${text}`,
  },
  uk: {
    welcome:
      '😎 Ласкаво просимо до DragonDrop!\n\n' +
      'Кейси та апгрейдер за грою «Steal a Brainrot»:\n' +
      '» Відкривай кейси та збирай брейнротів\n' +
      '» Прокачуй їх в Апгрейдері\n' +
      '» Безкоштовний кейс щодня 🎁\n\n' +
      '🍀 Випробуй удачу!\n\n' +
      'Кнопка «Грати на сайті» одразу входить у твій акаунт — нікому її не пересилай.',
    welcomeHalloween:
      '🎃 Хелловін у DragonDrop! 👻\n\n' +
      'Кейси та апгрейдер за грою «Steal a Brainrot»:\n' +
      '» Відкривай кейси та збирай брейнротів\n' +
      '» Прокачуй їх в Апгрейдері\n' +
      '» Безкоштовний кейс щодня 🎁\n\n' +
      '🦇 Випробуй удачу в найстрашнішу ніч року!\n\n' +
      'Кнопка «Грати на сайті» одразу входить у твій акаунт — нікому її не пересилай.',
    btnPlayTg: '🎮 Грати в Telegram',
    btnPlayWeb: '🌐 Грати на сайті',
    btnNews: '📢 Новини',
    btnSupport: '💬 Підтримка',
    btnPromo: '🎁 Ввести промокод',
    menuButton: 'Грати',
    promoAsk: '🎁 Надішли промокод одним повідомленням:',
    promoOk: (amount, balance) => `✅ Промокод активовано: +${fmt(amount, 'uk')} 🪙\nБаланс: ${fmt(balance, 'uk')} 🪙`,
    promoErr: {
      promo_invalid: '❌ Такого промокоду немає.',
      promo_expired: '⌛ Термін дії промокоду минув.',
      promo_used: '⚠️ Ти вже активував цей промокод.',
      promo_limit: '⚠️ У промокоду закінчилися активації.',
      default: '❌ Не вдалося активувати промокод, спробуй пізніше.',
    },
    adminOk: '✅ Готово, тепер ти адмін. Адмін-панель — у вкладці «Адмін» у застосунку.',
    adminBad: '❌ Невірний код.',
    banned: '⛔ Доступ до бота обмежено.',
    maintenance: '🛠 Технічні роботи — скоро повернемося.',
    description: 'DragonDrop 🎁\nКейси та апгрейдер за грою «Steal a Brainrot».',
    shortDescription: 'DragonDrop — кейси та апгрейдер за грою «Steal a Brainrot» 🎁',
    cmdStart: 'Головне меню',
    shareCaption: '🎁 Залітай у DragonDrop — відкривай кейси з брейнротами зі «Steal a Brainrot»!',
    shareCaptionHalloween: '🎃 Хелловін у DragonDrop — залітай і відкривай кейси з брейнротами зі «Steal a Brainrot»! 👻',
    shareButton: '🎮 Грати',
    btnWrite: '✍️ Написати',
    btnReply: '✍️ Відповісти',
    btnOpenRequest: '📂 Відкрити заявку',
    depositCreated: (id, nick, details) =>
      `📥 Заявку на поповнення #${id} прийнято.\n\nНік у Roblox: ${nick}\nЩо поповнюєш: ${details}\n\nАдміністратор зв'яжеться з тобою в цьому чаті.`,
    withdrawCreated: (id, nick, items, total, rest) =>
      `📤 Заявку на виведення #${id} прийнято.\n\nНік у Roblox: ${nick}\nБрейнроти: ${items}\nНа суму: ${fmt(total, 'uk')} 🪙` +
      (rest ? `\nЗалишок на баланс: +${fmt(rest, 'uk')} 🪙` : '') +
      `\n\nАдміністратор зв'яжеться з тобою в цьому чаті.`,
    adminMsg: (id, text) => `💬 Адміністратор щодо заявки #${id}:\n\n${text}`,
    replyAsk: (id) => `✍️ Напиши повідомлення щодо заявки #${id}:`,
    replySent: '✅ Повідомлення надіслано адміністратору.',
    reqClosed: (id) => `⚠️ Заявку #${id} вже закрито.`,
    depositDone: (id, coins, items) =>
      `✅ Заявку на поповнення #${id} виконано.` +
      (coins ? `\nЗараховано: +${fmt(coins, 'uk')} 🪙` : '') +
      (items ? `\nВидано: ${items}` : ''),
    withdrawDone: (id) => `✅ Виведення за заявкою #${id} виконано.`,
    rejected: (id, kind) => `❌ Заявку #${id} відхилено.` + (kind === 'withdraw' ? '\nБрейнроти повернулися в інвентар.' : ''),
    starsOk: (coins, balance) => `✅ Оплату отримано: +${fmt(coins, 'uk')} 🪙\nБаланс: ${fmt(balance, 'uk')} 🪙`,
    invoiceTitle: 'Поповнення балансу',
    invoiceDesc: (coins) => `${fmt(coins, 'uk')} монет у DragonDrop`,
    invoiceLabel: (coins) => `${fmt(coins, 'uk')} монет`,
    payCheckFailed: 'Платіж не пройшов перевірку. Створи новий рахунок у застосунку.',
    aNewDeposit: (id, who, nick, details) => `🆕 Поповнення #${id}\n\n👤 ${who}\n🎮 Нік: ${nick}\n📝 ${details}`,
    aNewWithdraw: (id, who, nick, items, total) => `🆕 Виведення #${id}\n\n👤 ${who}\n🎮 Нік: ${nick}\n🧠 ${items}\n💰 ${fmt(total, 'uk')} 🪙`,
    aUserReply: (id, who, text) => `💬 Заявка #${id} — ${who}:\n\n${text}`,
  },
  en: {
    welcome:
      '😎 Welcome to DragonDrop!\n\n' +
      'Cases and upgrader for «Steal a Brainrot»:\n' +
      '» Open cases and collect brainrots\n' +
      '» Level them up in the Upgrader\n' +
      '» Free case every day 🎁\n\n' +
      '🍀 Try your luck!\n\n' +
      'The «Play on website» button logs you straight into your account — never forward it to anyone.',
    welcomeHalloween:
      '🎃 Halloween at DragonDrop! 👻\n\n' +
      'Cases and upgrader for «Steal a Brainrot»:\n' +
      '» Open cases and collect brainrots\n' +
      '» Level them up in the Upgrader\n' +
      '» Free case every day 🎁\n\n' +
      '🦇 Try your luck on the spookiest night of the year!\n\n' +
      'The «Play on website» button logs you straight into your account — never forward it to anyone.',
    btnPlayTg: '🎮 Play in Telegram',
    btnPlayWeb: '🌐 Play on website',
    btnNews: '📢 News',
    btnSupport: '💬 Support',
    btnPromo: '🎁 Enter promo code',
    menuButton: 'Play',
    promoAsk: '🎁 Send the promo code in one message:',
    promoOk: (amount, balance) => `✅ Promo code activated: +${fmt(amount, 'en')} 🪙\nBalance: ${fmt(balance, 'en')} 🪙`,
    promoErr: {
      promo_invalid: '❌ There is no such promo code.',
      promo_expired: '⌛ This promo code has expired.',
      promo_used: '⚠️ You have already used this promo code.',
      promo_limit: '⚠️ This promo code has no activations left.',
      default: '❌ Could not activate the promo code, try again later.',
    },
    adminOk: '✅ Done, you are an admin now. The admin panel is in the «Admin» tab of the app.',
    adminBad: '❌ Wrong code.',
    banned: '⛔ Access to the bot is restricted.',
    maintenance: '🛠 Maintenance — we will be back soon.',
    description: 'DragonDrop 🎁\nCases and upgrader for «Steal a Brainrot».',
    shortDescription: 'DragonDrop — cases and upgrader for «Steal a Brainrot» 🎁',
    cmdStart: 'Main menu',
    shareCaption: '🎁 Jump into DragonDrop — open cases with brainrots from «Steal a Brainrot»!',
    shareCaptionHalloween: '🎃 Halloween at DragonDrop — jump in and open cases with brainrots from «Steal a Brainrot»! 👻',
    shareButton: '🎮 Play',
    btnWrite: '✍️ Write',
    btnReply: '✍️ Reply',
    btnOpenRequest: '📂 Open request',
    depositCreated: (id, nick, details) =>
      `📥 Deposit request #${id} received.\n\nRoblox nickname: ${nick}\nWhat you deposit: ${details}\n\nAn admin will contact you in this chat.`,
    withdrawCreated: (id, nick, items, total, rest) =>
      `📤 Withdrawal request #${id} received.\n\nRoblox nickname: ${nick}\nBrainrots: ${items}\nTotal: ${fmt(total, 'en')} 🪙` +
      (rest ? `\nRemainder to balance: +${fmt(rest, 'en')} 🪙` : '') +
      `\n\nAn admin will contact you in this chat.`,
    adminMsg: (id, text) => `💬 Admin about request #${id}:\n\n${text}`,
    replyAsk: (id) => `✍️ Write your message about request #${id}:`,
    replySent: '✅ Message sent to the admin.',
    reqClosed: (id) => `⚠️ Request #${id} is already closed.`,
    depositDone: (id, coins, items) =>
      `✅ Deposit request #${id} completed.` +
      (coins ? `\nCredited: +${fmt(coins, 'en')} 🪙` : '') +
      (items ? `\nGiven: ${items}` : ''),
    withdrawDone: (id) => `✅ Withdrawal #${id} completed.`,
    rejected: (id, kind) => `❌ Request #${id} was declined.` + (kind === 'withdraw' ? '\nThe brainrots are back in your inventory.' : ''),
    starsOk: (coins, balance) => `✅ Payment received: +${fmt(coins, 'en')} 🪙\nBalance: ${fmt(balance, 'en')} 🪙`,
    invoiceTitle: 'Balance top-up',
    invoiceDesc: (coins) => `${fmt(coins, 'en')} coins in DragonDrop`,
    invoiceLabel: (coins) => `${fmt(coins, 'en')} coins`,
    payCheckFailed: 'The payment did not pass the check. Create a new invoice in the app.',
    aNewDeposit: (id, who, nick, details) => `🆕 Deposit #${id}\n\n👤 ${who}\n🎮 Nickname: ${nick}\n📝 ${details}`,
    aNewWithdraw: (id, who, nick, items, total) => `🆕 Withdrawal #${id}\n\n👤 ${who}\n🎮 Nickname: ${nick}\n🧠 ${items}\n💰 ${fmt(total, 'en')} 🪙`,
    aUserReply: (id, who, text) => `💬 Request #${id} — ${who}:\n\n${text}`,
  },
};

export function T(lang) {
  return TEXTS[lang] || TEXTS.ru;
}
