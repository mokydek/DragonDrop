-- DragonDrop schema. The tables live in a schema of their own ("dragondrop", env DB_SCHEMA) and are
-- prefixed with bs_, so the bot can share a database (e.g. an existing Supabase project) with other apps.

CREATE TABLE IF NOT EXISTS bs_users (
  id              BIGINT PRIMARY KEY,
  username        TEXT,
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT,
  photo_url       TEXT,
  lang            TEXT NOT NULL DEFAULT 'ru',
  theme           TEXT NOT NULL DEFAULT 'sunset',
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  cases_opened    INTEGER NOT NULL DEFAULT 0,
  total_spent     BIGINT NOT NULL DEFAULT 0,
  total_won       BIGINT NOT NULL DEFAULT 0,
  best_item_id    INTEGER,
  best_value      BIGINT NOT NULL DEFAULT 0,
  upgrades_total  INTEGER NOT NULL DEFAULT 0,
  upgrades_won    INTEGER NOT NULL DEFAULT 0,
  sold_value      BIGINT NOT NULL DEFAULT 0,
  free_last_at    TIMESTAMPTZ,
  shared_at       TIMESTAMPTZ,
  awaiting        TEXT,
  web_ver         INTEGER NOT NULL DEFAULT 1,
  started_bot     BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_bot     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_users_username_idx ON bs_users (lower(username));
CREATE INDEX IF NOT EXISTS bs_users_created_idx ON bs_users (created_at);

CREATE TABLE IF NOT EXISTS bs_items (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  value       INTEGER NOT NULL CHECK (value >= 0),
  emoji       TEXT NOT NULL DEFAULT '🎁',
  rarity      TEXT,
  image_url   TEXT,
  image_data  TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- brainrots that can be withdrawn (others are exchanged for one of them); NULL = not set yet
ALTER TABLE bs_items ADD COLUMN IF NOT EXISTS withdrawable BOOLEAN;
-- can be picked in a deposit by brainrots (admins switch it off for the ones they don't take)
ALTER TABLE bs_items ADD COLUMN IF NOT EXISTS depositable BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS bs_cases (
  id       SERIAL PRIMARY KEY,
  slug     TEXT UNIQUE NOT NULL,
  name_ru  TEXT NOT NULL,
  name_uk  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  price    INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_free  BOOLEAN NOT NULL DEFAULT FALSE,
  emoji    TEXT NOT NULL DEFAULT '📦',
  color    TEXT NOT NULL DEFAULT '#f59e0b',
  sort     INTEGER NOT NULL DEFAULT 0,
  enabled  BOOLEAN NOT NULL DEFAULT TRUE
);
-- case picture uploaded in the admin panel (data URL); without it the app draws a chest
ALTER TABLE bs_cases ADD COLUMN IF NOT EXISTS image_data TEXT;

-- Case categories made by admins (a heading on the cases screen)
CREATE TABLE IF NOT EXISTS bs_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bs_cases ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES bs_categories(id) ON DELETE SET NULL;
-- the nick case: free, opens only for players with the bot's name (setting nick_tag) in their Telegram name
ALTER TABLE bs_cases ADD COLUMN IF NOT EXISTS is_nick BOOLEAN NOT NULL DEFAULT FALSE;
-- the share case: free, opens after the player shared the bot share_case_count times (setting)
ALTER TABLE bs_cases ADD COLUMN IF NOT EXISTS is_share BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS bs_case_items (
  case_id  INTEGER NOT NULL REFERENCES bs_cases(id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL REFERENCES bs_items(id) ON DELETE CASCADE,
  chance   NUMERIC(10,4) NOT NULL CHECK (chance > 0),
  PRIMARY KEY (case_id, item_id)
);

CREATE TABLE IF NOT EXISTS bs_inventory (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES bs_items(id),
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_inventory_user_idx ON bs_inventory (user_id);
-- where the brainrot came from (shown in the admin player card):
-- the case for case/free drops; ref_id = upgrade id (upgrade), request id (deposit, refund) or admin id (admin)
ALTER TABLE bs_inventory ADD COLUMN IF NOT EXISTS case_id INTEGER REFERENCES bs_cases(id) ON DELETE SET NULL;
ALTER TABLE bs_inventory ADD COLUMN IF NOT EXISTS ref_id BIGINT;

CREATE TABLE IF NOT EXISTS bs_drops (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES bs_items(id),
  value       INTEGER NOT NULL,
  case_id     INTEGER REFERENCES bs_cases(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_drops_created_idx ON bs_drops (created_at DESC);
CREATE INDEX IF NOT EXISTS bs_drops_user_idx ON bs_drops (user_id);
-- what a paid case opening cost (the bets of a referral code's players); NULL on older rows
ALTER TABLE bs_drops ADD COLUMN IF NOT EXISTS price INTEGER;

CREATE TABLE IF NOT EXISTS bs_upgrades (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  bet_value       INTEGER NOT NULL,
  target_item_id  INTEGER NOT NULL REFERENCES bs_items(id),
  chance          NUMERIC(7,3) NOT NULL,
  roll            NUMERIC(7,3) NOT NULL,
  won             BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_upgrades_user_idx ON bs_upgrades (user_id);

CREATE TABLE IF NOT EXISTS bs_promo_codes (
  code        TEXT PRIMARY KEY,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bs_promo_uses (
  code     TEXT NOT NULL REFERENCES bs_promo_codes(code) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS bs_settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS bs_balance_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  delta       BIGINT NOT NULL,
  reason      TEXT NOT NULL,
  admin_id    BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_balance_log_user_idx ON bs_balance_log (user_id);

-- last Roblox nickname the player entered (pre-fills the deposit / withdrawal forms)
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS roblox_nick TEXT;
-- this account's upgrader bad luck, on top of the global one (set by the main admin; 1 = as everyone)
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS upgrade_luck NUMERIC(6,3) NOT NULL DEFAULT 1;
-- when the player last opened the nick case (its own cooldown, apart from the FREE case)
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS nick_last_at TIMESTAMPTZ;
-- the share case: confirmed shares of the bot since the player last opened it, and when that was
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS share_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS share_last_at TIMESTAMPTZ;

-- Referral codes made by admins (streamers, partners); a player types one in when topping up
CREATE TABLE IF NOT EXISTS bs_ref_codes (
  code        TEXT PRIMARY KEY,
  note        TEXT NOT NULL DEFAULT '',
  bonus_pct   NUMERIC(6,2) NOT NULL DEFAULT 0,  -- player gets this % extra coins on a deposit
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bs_ref_codes ADD COLUMN IF NOT EXISTS bonus_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS ref_code TEXT REFERENCES bs_ref_codes(code) ON DELETE SET NULL;
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS ref_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bs_users_ref_idx ON bs_users (ref_code);
-- referral levels: a code's bonus % comes from the levels (setting ref_levels: by how many of its
-- players topped up) unless the main admin gave the code its own % (bonus_pct; NULL = by level)
ALTER TABLE bs_ref_codes ALTER COLUMN bonus_pct DROP NOT NULL;
ALTER TABLE bs_ref_codes ALTER COLUMN bonus_pct DROP DEFAULT;
-- the partner the code belongs to: sees its players, stats and level in the app
ALTER TABLE bs_ref_codes ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES bs_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bs_ref_codes_owner_idx ON bs_ref_codes (owner_id);

-- Rocket (crash) rounds; a player has at most one rocket in the air
CREATE TABLE IF NOT EXISTS bs_crash (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  bet         BIGINT NOT NULL CHECK (bet > 0),
  crash_point NUMERIC(10,2) NOT NULL,  -- where the rocket explodes (drawn at the start)
  started_ms  BIGINT NOT NULL,         -- server clock, ms
  status      TEXT NOT NULL DEFAULT 'flying' CHECK (status IN ('flying', 'cashed', 'crashed')),
  cash_mult   NUMERIC(10,2),
  win         BIGINT NOT NULL DEFAULT 0,
  bet_kind    TEXT NOT NULL DEFAULT 'coins' CHECK (bet_kind IN ('coins', 'brainrots')),
  bet_items   JSONB,  -- brainrots staked, when bet_kind = 'brainrots'
  win_item    JSONB,  -- brainrot handed out on a cash-out (the rest goes as coins)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bs_crash ADD COLUMN IF NOT EXISTS bet_kind TEXT NOT NULL DEFAULT 'coins';
ALTER TABLE bs_crash ADD COLUMN IF NOT EXISTS bet_items JSONB;
ALTER TABLE bs_crash ADD COLUMN IF NOT EXISTS win_item JSONB;
CREATE INDEX IF NOT EXISTS bs_crash_user_idx ON bs_crash (user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS bs_crash_flying_idx ON bs_crash (user_id) WHERE status = 'flying';

-- Colour dice: one throw of three dice for a colour (each die shows one of six colours)
CREATE TABLE IF NOT EXISTS bs_dice (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  color       TEXT NOT NULL,              -- the colour the player bet on
  bet         BIGINT NOT NULL CHECK (bet > 0),
  bet_kind    TEXT NOT NULL DEFAULT 'coins' CHECK (bet_kind IN ('coins', 'brainrots')),
  bet_items   JSONB,                      -- brainrots staked, when bet_kind = 'brainrots'
  dice        TEXT[] NOT NULL,            -- the three colours thrown
  matches     SMALLINT NOT NULL,          -- how many dice showed the colour
  mult        SMALLINT NOT NULL,          -- what the stake was multiplied by (0 = lost)
  win         BIGINT NOT NULL DEFAULT 0,  -- the value won
  win_item    JSONB,                      -- brainrot handed out (brainrot stakes; the rest goes as coins)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_dice_user_idx ON bs_dice (user_id, id DESC);

-- Deposits (brainrots by request or Telegram Stars) and withdrawals of brainrots.
CREATE TABLE IF NOT EXISTS bs_requests (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw')),
  method      TEXT NOT NULL DEFAULT 'brainrot' CHECK (method IN ('brainrot', 'stars')),
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'active', 'done', 'rejected')),
  nick        TEXT,
  details     TEXT,
  items       JSONB NOT NULL DEFAULT '[]', -- withdraw: held items; deposit: items given by admins
  total       BIGINT NOT NULL DEFAULT 0,   -- withdraw: value of the held items
  coins       BIGINT NOT NULL DEFAULT 0,   -- deposit: coins credited
  stars       INTEGER,
  charge_id   TEXT UNIQUE,                 -- Telegram Stars payment id (idempotency)
  invoice     TEXT,                        -- Stars: id of our invoice, the app polls it
  admin_id    BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- withdrawal: brainrots that couldn't be withdrawn, exchanged for one that can; remainder in coins
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS exchange JSONB;
-- deposit: brainrots the player picked to give [{itemId, name, value, emoji, count}]
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS offer JSONB;
CREATE INDEX IF NOT EXISTS bs_requests_kind_idx ON bs_requests (kind, status, id DESC);
CREATE INDEX IF NOT EXISTS bs_requests_user_idx ON bs_requests (user_id);
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS invoice TEXT;
-- referral bonus coins paid on top of a deposit (not part of what the player deposited)
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS bonus BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS bs_requests_invoice_idx ON bs_requests (invoice) WHERE invoice IS NOT NULL;

-- Auto promo codes: every few hours the server makes up a new one with a bonus % to a top-up
CREATE TABLE IF NOT EXISTS bs_auto_promos (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  pct         SMALLINT NOT NULL CHECK (pct BETWEEN 1 AND 100),
  starts_at   TIMESTAMPTZ NOT NULL UNIQUE,
  ends_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_auto_promos_end_idx ON bs_auto_promos (ends_at DESC);
-- who got the bonus of an auto code: once per player
CREATE TABLE IF NOT EXISTS bs_auto_promo_uses (
  promo_id    BIGINT NOT NULL REFERENCES bs_auto_promos(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  request_id  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (promo_id, user_id)
);
-- deposit: the auto promo code typed in with it and the bonus coins it paid (apart from the referral bonus)
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS promo_id BIGINT;
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS promo_pct SMALLINT;
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS promo_bonus BIGINT NOT NULL DEFAULT 0;
-- the queue of brainrot deposits: an admin accepts the next one, the player then has 5 minutes to send
-- the trade to the admin's Roblox nick (kept with the request); the player may cancel their own request
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS accepted_by BIGINT;
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS trade_nick TEXT;
ALTER TABLE bs_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bs_requests_queue_idx ON bs_requests (id) WHERE kind = 'deposit' AND method = 'brainrot' AND status = 'new';
-- admins: their Roblox nick, the one players send the deposit trade to
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS trade_nick TEXT;

-- Conversation between admins and the player about a request (delivered through the bot).
CREATE TABLE IF NOT EXISTS bs_request_msgs (
  id          BIGSERIAL PRIMARY KEY,
  request_id  BIGINT NOT NULL REFERENCES bs_requests(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('user', 'admin', 'system')),
  author_id   BIGINT,
  text        TEXT NOT NULL,
  tg_msg_id   BIGINT, -- bot message in the player's chat, so a Telegram reply finds the request
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_request_msgs_req_idx ON bs_request_msgs (request_id, id);
CREATE INDEX IF NOT EXISTS bs_request_msgs_tg_idx ON bs_request_msgs (tg_msg_id) WHERE tg_msg_id IS NOT NULL;

-- Invite friends: every player has a link of their own (invite_code). A new player who came by it is
-- that player's friend (inviter_id); the inviter gets invite_pct % of the friend's top-ups, kept apart
-- (invite_balance) until moved to the balance; invite_earned is all they ever got this way.
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS inviter_id BIGINT REFERENCES bs_users(id) ON DELETE SET NULL;
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS invite_balance BIGINT NOT NULL DEFAULT 0 CHECK (invite_balance >= 0);
ALTER TABLE bs_users ADD COLUMN IF NOT EXISTS invite_earned BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS bs_users_invite_code_idx ON bs_users (invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS bs_users_inviter_idx ON bs_users (inviter_id) WHERE inviter_id IS NOT NULL;

-- what each top-up of a friend brought the inviter
CREATE TABLE IF NOT EXISTS bs_invite_rewards (
  id          BIGSERIAL PRIMARY KEY,
  inviter_id  BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  request_id  BIGINT,
  coins       BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_invite_rewards_inviter_idx ON bs_invite_rewards (inviter_id, user_id);
-- the referral page: a week's income is pending until Saturday (by created_at); invite_balance is no
-- longer used (what was moved to the balance is in bs_balance_log, reason 'invites')
CREATE INDEX IF NOT EXISTS bs_invite_rewards_time_idx ON bs_invite_rewards (inviter_id, created_at);
-- the codes are typed in now (a partner promo code): capitals, like the new ones; an older code is made
-- capital unless another code would then read the same
UPDATE bs_users u SET invite_code = upper(u.invite_code)
 WHERE u.invite_code IS NOT NULL AND u.invite_code <> upper(u.invite_code)
   AND upper(u.invite_code) IN (SELECT upper(invite_code) FROM bs_users WHERE invite_code IS NOT NULL GROUP BY 1 HAVING count(*) = 1);

-- Giveaways (like on Case Battle): every day / every week a brainrot is raffled among the players who
-- joined; to join, a player tops up at least min_topup coins while it runs. What the main admin set for
-- each kind:
CREATE TABLE IF NOT EXISTS bs_giveaway_plans (
  kind        TEXT PRIMARY KEY CHECK (kind IN ('day', 'week')),
  active      BOOLEAN NOT NULL DEFAULT FALSE,
  item_id     INTEGER REFERENCES bs_items(id),
  min_topup   BIGINT NOT NULL DEFAULT 0 CHECK (min_topup >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- each giveaway: open while it runs (one per kind), done when drawn (winner_id NULL: nobody joined)
CREATE TABLE IF NOT EXISTS bs_giveaways (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('day', 'week')),
  item_id     INTEGER NOT NULL REFERENCES bs_items(id),
  min_topup   BIGINT NOT NULL DEFAULT 0 CHECK (min_topup >= 0),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  winner_id   BIGINT REFERENCES bs_users(id) ON DELETE SET NULL,
  inv_id      BIGINT,
  entries     INTEGER NOT NULL DEFAULT 0,
  drawn_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS bs_giveaways_open_idx ON bs_giveaways (kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS bs_giveaways_kind_idx ON bs_giveaways (kind, id DESC);
CREATE TABLE IF NOT EXISTS bs_giveaway_entries (
  giveaway_id BIGINT NOT NULL REFERENCES bs_giveaways(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (giveaway_id, user_id)
);
-- every top-up and what it brought in coins (Stars, coins credited, brainrots given), when it came:
-- the giveaways count the ones made while they run
CREATE TABLE IF NOT EXISTS bs_topups (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  request_id  BIGINT,
  value       BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_topups_user_idx ON bs_topups (user_id, created_at);

-- Row level security with no policies: the app connects as the table owner
-- (unaffected), while public APIs such as Supabase's Data API get no access.
ALTER TABLE bs_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_case_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_inventory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_drops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_upgrades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_promo_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_promo_uses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_balance_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_request_msgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_crash        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_dice         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_auto_promos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_auto_promo_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_ref_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_invite_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_giveaway_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_giveaways    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_giveaway_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_topups       ENABLE ROW LEVEL SECURITY;
