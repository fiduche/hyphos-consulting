-- D1 schema for the golf tournament entry form (/golf).
--
-- Apply locally:   npx wrangler d1 execute hyphos-golf --local  --file=./schema.sql
-- Apply remotely:  npx wrangler d1 execute hyphos-golf --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS golf_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  company_role  TEXT    NOT NULL,
  email         TEXT    NOT NULL,
  cell          TEXT,
  -- "What's the one task at work you wish just did itself?" — the bonus-entry
  -- answer. This is the qualifying signal and the raw material for the dinner
  -- slide, so it matters more than any other field here.
  wish          TEXT,
  want_list     INTEGER NOT NULL DEFAULT 0,  -- send me the 10 ways
  want_talk     INTEGER NOT NULL DEFAULT 0,  -- talk about my company
  knows_someone INTEGER NOT NULL DEFAULT 0,  -- knows someone who should hear
  want_tidal    INTEGER NOT NULL DEFAULT 0,  -- Tidal Insurance coverage review
  -- Set by staff after the event, or by hand: whoever named a specific problem
  -- out loud at the hole. Starred entries get the personal follow-up.
  starred       INTEGER NOT NULL DEFAULT 0
);

-- Dedupe guard: a double-tapped submit button on flaky course signal should
-- not create two rows. Same email twice is almost certainly a retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_golf_entries_email ON golf_entries(lower(email));

CREATE INDEX IF NOT EXISTS idx_golf_entries_created ON golf_entries(created_at);
