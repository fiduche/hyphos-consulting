-- Adds the QR scan log without touching golf_entries.
-- Apply remotely:  npx wrangler d1 execute hyphos-golf --remote --file=./migrations/2026-09-16-scan-log.sql
-- Apply locally:   npx wrangler d1 execute hyphos-golf --local  --file=./migrations/2026-09-16-scan-log.sql

CREATE TABLE IF NOT EXISTS scan_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  tag         TEXT NOT NULL,
  user_agent  TEXT,
  country     TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_log_tag ON scan_log(tag, created_at);
