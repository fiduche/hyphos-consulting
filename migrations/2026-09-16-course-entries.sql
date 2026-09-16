-- Adds the on-course contest table without touching anything else.
-- Apply remotely:  npx wrangler d1 execute hyphos-golf --remote --file=./migrations/2026-09-16-course-entries.sql

-- On-course contests (closest to the pin, longest drive, longest putt, the
-- square). Replaces the pinned paper sheets. value is total inches for
-- measured contests and NULL otherwise. One row per person per contest.
CREATE TABLE IF NOT EXISTS course_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  contest     TEXT NOT NULL,
  player      TEXT NOT NULL,
  team        TEXT,
  value       INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_entries_person ON course_entries(contest, lower(player));
