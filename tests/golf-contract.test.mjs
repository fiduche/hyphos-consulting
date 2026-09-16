import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { clean, looksLikeEmail, normaliseCell } from '../src/worker.js';
import { CONTESTS, CONTEST_BY_CODE, formatInches } from '../src/data/contests.js';

const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../migrations/2026-09-16-scan-log.sql', import.meta.url), 'utf8');

test('public text fields are trimmed and capped', () => {
  assert.equal(clean('  useful answer  ', 600), 'useful answer');
  assert.equal(clean('x'.repeat(900), 600).length, 600);
  assert.match(workerSource, /wish_detail:\s*600/);
  assert.match(workerSource, /probe_question:\s*300/);
});

test('email and phone validation accepts expected event input', () => {
  assert.equal(looksLikeEmail('owner@example.ca'), true);
  assert.equal(looksLikeEmail('owner@example'), false);
  assert.equal(normaliseCell('+1 403 555 0100'), '(403) 555-0100');
  assert.equal(normaliseCell('403-555-010'), '');
});

test('fresh schema matches the current export contract', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const columns = db.prepare('PRAGMA table_info(golf_entries)').all().map((column) => column.name);

  for (const expected of [
    'created_at', 'first_name', 'last_name', 'company', 'role', 'email', 'cell',
    'wish', 'wish_detail', 'probe_question', 'starred',
  ]) {
    assert.ok(columns.includes(expected), `missing ${expected}`);
  }
  assert.equal(columns.includes('category'), false);
  assert.doesNotMatch(workerSource, /probe_question, category/);
});

test('judged winner selection is explicit and same-device', async () => {
  const judge = await readFile(new URL('../src/pages/golf/judge.astro', import.meta.url), 'utf8');
  const live = await readFile(new URL('../src/pages/golf/live.astro', import.meta.url), 'utf8');

  assert.match(judge, /hyphos-golf-best-pick/);
  assert.match(live, /hyphos-golf-best-pick/);
  assert.match(live, /location\.href = '\/golf\/judge'/);
});

test('QR scan tracking: /go/<tag> is routed and the schema can store it', () => {
  assert.match(workerSource, /pathname\.match\(GO_PATH\)/);
  assert.match(workerSource, /INSERT INTO scan_log \(created_at, tag, user_agent, country\)/);
  assert.match(workerSource, /'\/api\/golf\/scans'/);

  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const columns = db.prepare('PRAGMA table_info(scan_log)').all().map((column) => column.name);
  for (const expected of ['created_at', 'tag', 'user_agent', 'country']) {
    assert.ok(columns.includes(expected), `scan_log is missing ${expected}`);
  }

  const migration = new DatabaseSync(':memory:');
  migration.exec(schema);
  // The migration must be safe to run on a database that already has the table.
  migration.exec(readFileSyncMigration());
});

function readFileSyncMigration() {
  return migrationSource;
}

test('on-course contests: config, routes and one row per person per contest', () => {
  const ids = new Set(); const codes = new Set();
  for (const c of CONTESTS) {
    assert.ok(['low', 'high', 'latest', 'list'].includes(c.mode), `${c.id} has an unknown mode`);
    assert.match(c.code, /^[A-Z0-9]{1,8}$/, `${c.id} code must be short and uppercase for a compact QR`);
    assert.ok(!ids.has(c.id) && !codes.has(c.code), 'contest ids and codes must be unique');
    ids.add(c.id); codes.add(c.code);
    assert.equal(CONTEST_BY_CODE[c.code.toLowerCase()], c);
  }
  assert.equal(formatInches(150), '12\u2032 6\u2033');
  assert.match(workerSource, /'\/api\/course\/entry'/);
  assert.match(workerSource, /'\/api\/course\/board'/);
  assert.match(workerSource, /ON CONFLICT\(contest, lower\(player\)\)/);

  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const insert = db.prepare("INSERT INTO course_entries (created_at, contest, player) VALUES ('t', 'ctp', ?)");
  insert.run('Brad Beckett');
  assert.throws(() => insert.run('brad beckett'), 'same person, different case, must collide');
});

// A minimal D1 stand-in over node:sqlite, enough to drive the real worker
// routes end to end: prepare(sql).bind(...).run() / .all(), numbered params.
function d1(db) {
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql) };
}

test('course entry: the roster stays on the server and names resolve to it', async () => {
  const { default: worker } = await import('../src/worker.js');
  const roster = JSON.parse(await readFile(new URL('../src/data/roster.json', import.meta.url), 'utf8'));
  const known = roster.find((r) => r.team && r.name.length > 6);

  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const env = { DB: d1(db) };
  const post = (body) => worker.fetch(new Request('https://x.test/api/course/entry', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, {});

  // Typed in lower case with extra spaces: stored under the roster spelling and team.
  const typed = known.name.toLowerCase().replace(' ', '  ');
  const res = await post({ contest: 'ctp', player: typed, team: 'Spoofed Team', website: '' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).player, known.name);
  const row = db.prepare('SELECT player, team FROM course_entries').get();
  assert.equal(row.player, known.name);
  assert.equal(row.team, known.team, 'team comes from the roster, never from the client');

  // Not on the roster still posts, with no team.
  assert.equal((await post({ contest: 'ctp', player: 'Visiting Guest', website: '' })).status, 200);
  assert.equal(db.prepare("SELECT team FROM course_entries WHERE player = 'Visiting Guest'").get().team, '');

  // Honeypot is silently accepted and stores nothing.
  const before = db.prepare('SELECT COUNT(*) AS n FROM course_entries').get().n;
  assert.equal((await post({ contest: 'ctp', player: 'Bot Name', website: 'http://spam' })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_entries').get().n, before);

  // Delete needs a session.
  const del = await worker.fetch(new Request('https://x.test/api/course/entry?id=1', { method: 'DELETE' }), { ...env, GOLF_EXPORT_KEY: 'k' }, {});
  assert.equal(del.status, 401);

  // And the public entry page does not carry the roster.
  const page = await readFile(new URL('../src/pages/course/enter.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /roster\.json/);
});

test('judging: every answer is eligible and rehearsal never touches the real pick', async () => {
  const judge = await readFile(new URL('../src/pages/golf/judge.astro', import.meta.url), 'utf8');
  assert.match(judge, /DEMO_MODE \? 'hyphos-golf-best-pick-demo' : 'hyphos-golf-best-pick'/);
  assert.doesNotMatch(workerSource, /wish_detail \|\| ''\)\.trim\(\)\.length > 12/);
  assert.match(workerSource, /best: candidates\.map/);
});
