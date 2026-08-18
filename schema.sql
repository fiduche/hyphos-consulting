-- D1 schema for the golf tournament entry form (/golf).
--
-- Apply locally:   npx wrangler d1 execute hyphos-golf --local  --file=./schema.sql
-- Apply remotely:  npx wrangler d1 execute hyphos-golf --remote --file=./schema.sql

DROP TABLE IF EXISTS golf_entries;
DROP TABLE IF EXISTS probe_log;

CREATE TABLE golf_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,

  first_name    TEXT    NOT NULL,
  last_name     TEXT    NOT NULL,
  company       TEXT    NOT NULL,
  role          TEXT    NOT NULL,
  email         TEXT    NOT NULL,
  cell          TEXT,

  -- "What's the one task at work you wish just did itself?" is the bonus-entry
  -- answer. This is the qualifying signal and the raw material for the dinner
  -- slide, so it matters more than any other field here.
  wish          TEXT,
  -- Answer to the AI-generated follow-up question. "Invoicing" is useless;
  -- "chasing 40 invoices a month, each one a phone call" is a conversation.
  wish_detail   TEXT,
  -- The exact follow-up that was asked. Without it, wish_detail is an answer to
  -- a question nobody recorded.
  probe_question TEXT,
  -- Random sort key assigned once at insert. The draw reads this, so the order
  -- is fixed the moment someone enters: it cannot drift as more people enter,
  -- and it cannot be rerolled by reloading the summary.
  draw_key      REAL,

  -- Consent is per purpose and per company. Nothing here is pre-ticked, and
  -- entering the draw on its own is NOT consent to be contacted about anything
  -- else: the winner is reachable via email regardless of every flag below.
  want_list         INTEGER NOT NULL DEFAULT 0,  -- send the "10 ways" piece

  hyphos_company    INTEGER NOT NULL DEFAULT 0,  -- follow up re: their company
  hyphos_workplace  INTEGER NOT NULL DEFAULT 0,  -- follow up re: where they work
  hyphos_referral   INTEGER NOT NULL DEFAULT 0,  -- follow up re: someone they know

  tidal_company     INTEGER NOT NULL DEFAULT 0,  -- insurance for their company
  tidal_workplace   INTEGER NOT NULL DEFAULT 0,  -- insurance where they work
  tidal_personal    INTEGER NOT NULL DEFAULT 0,  -- personal insurance

  -- Set by hand after the event: whoever named a specific problem out loud at
  -- the hole. Starred entries get the personal follow-up, not the bulk email.
  starred       INTEGER NOT NULL DEFAULT 0
);

-- Dedupe guard: a double-tapped submit button on flaky course signal should
-- not create two rows. Same email twice is almost certainly a retry.
CREATE UNIQUE INDEX idx_golf_entries_email ON golf_entries(lower(email));
CREATE INDEX idx_golf_entries_created ON golf_entries(created_at);

-- Spend guard for the AI follow-up endpoint. The probe route is public, so an
-- unbounded one would let anyone burn API credit; every call writes a row here
-- and the route refuses once the trailing hour exceeds PROBE_HOURLY_CAP.
CREATE TABLE probe_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_probe_log_created ON probe_log(created_at);

-- Cached grouping for the live screens. Without this, every poll from a display
-- would re-run the clustering model: at one refresh a minute for five hours
-- that is 300 calls to redraw a board that changes when someone enters, not
-- when the clock ticks.
CREATE TABLE grouping_cache (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  computed_at  TEXT NOT NULL,
  entry_count  INTEGER NOT NULL,
  payload      TEXT NOT NULL
);
