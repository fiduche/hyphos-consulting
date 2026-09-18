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

test('one dinner screen awards the contest prizes from the judged pick and the entries', async () => {
  const judge = await readFile(new URL('../src/pages/golf/judge.astro', import.meta.url), 'utf8');
  const prizes = await readFile(new URL('../src/pages/golf/prizes.astro', import.meta.url), 'utf8');
  const live = await readFile(new URL('../src/pages/golf/live.astro', import.meta.url), 'utf8');

  assert.match(judge, /hyphos-golf-best-pick/);
  assert.match(prizes, /hyphos-golf-best-pick/);
  assert.match(judge, /href="\/golf\/prizes"/);
  for (const tag of ['best answer', 'entry draw', 'square']) assert.match(prizes, new RegExp(`'${tag}'`));
  assert.match(prizes, /\/api\/golf\/summary\?format=json/);
  assert.match(prizes, /\/api\/course\/board/);
  // Rehearsal never shares storage with the real draw.
  assert.match(prizes, /DEMO \? 'hyphos-golf-prizes-demo-v3' : 'hyphos-golf-prizes-v3'/);
  // No prize list up front: regular prizes run until you end it, and each
  // Hyphos prize can be switched to at any point.
  assert.match(prizes, /function insertSpecial\(i\)/);
  assert.match(prizes, /function insertRegular\(\)/);
  // Two windows: the projector runs the draw, the laptop controls it.
  assert.match(prizes, /new BroadcastChannel\(/);
  assert.match(prizes, /\?screen=1/);
  assert.match(prizes, /entry draw/);
  assert.match(prizes, /\/api\/golf\/roster/);
  // The retired deck only forwards.
  assert.match(live, /location\.replace/);
  assert.doesNotMatch(live, /\/api\/golf/);
  // The judged prize is not decided by length: the draw full order is sent.
  assert.match(workerSource, /draw: fullDrawOrder\.map/);
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
  const env = { DB: d1(db), GOLF_EXPORT_KEY: 'k' };
  const post = (body, auth = 'Bearer k') => worker.fetch(new Request('https://x.test/api/course/entry', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body),
  }), env, {});

  // No contest signs this year: posting needs the screen sign-in.
  assert.equal((await post({ contest: 'ctp', player: 'Anyone', website: '' }, '')).status, 401);

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
  const del = await worker.fetch(new Request('https://x.test/api/course/entry?id=1', { method: 'DELETE' }), env, {});
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

test('hyphos.io serves the tournament; hyphosconsulting.com only redirects there', async () => {
  const { default: worker } = await import('../src/worker.js');
  const notFound = { fetch: async () => new Response('not found', { status: 404 }) };
  const asset = { fetch: async () => new Response('<html>golf</html>', { status: 200 }) };
  const on = (host) => (path, env = { ASSETS: notFound }, method = 'GET') =>
    worker.fetch(new Request(`https://${host}${path}`, { method }), env, {});
  const old = on('hyphosconsulting.com');
  const main = on('hyphos.io');

  // Old marketing pages go to their hyphos.io equivalents.
  for (const [from, to] of [
    ['/', 'https://hyphos.io/'],
    ['/work/', 'https://hyphos.io/work'],
    ['/work/cornerstone/', 'https://hyphos.io/work/cornerstone/'],
    ['/ai?utm_source=email', 'https://hyphos.io/field-notes/ten-ways-small-businesses-use-ai/?utm_source=email'],
    ['/products', 'https://hyphos.io/'],
    ['/something-old', 'https://hyphos.io/'],
  ]) {
    const res = await old(from);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), to, from);
  }

  // Tournament pages on the old domain move to the same path on hyphos.io,
  // even though they are real assets there.
  for (const [from, to] of [
    ['/golf/', 'https://hyphos.io/golf/'],
    ['/golf/board/', 'https://hyphos.io/golf/board/'],
    ['/course/enter/?c=ctp', 'https://hyphos.io/course/enter/?c=ctp'],
    ['/golf/qr-screen.png', 'https://hyphos.io/golf/qr-screen.png'],
  ]) {
    const res = await old(from, { ASSETS: asset });
    assert.equal(res.status, 302, from);
    assert.equal(res.headers.get('location'), to, from);
  }

  // Reached through the hyphos.io service binding, the same pages are served.
  // Only the draw entry form, the sign-in and plain files are public.
  for (const path of ['/golf/', '/golf', '/golf/enter/', '/golf/knot.png']) {
    assert.equal((await main(path, { ASSETS: asset })).status, 200, path);
  }
  // Every other tournament page, rehearsals included, sends you to sign in first.
  for (const path of ['/course/', '/course/?demo=1', '/course/enter/?c=ctp', '/golf/board/', '/golf/guide/', '/golf/prizes?demo=1', '/golf/judge/', '/golf/scans/']) {
    const res = await main(path, { ASSETS: asset, GOLF_EXPORT_KEY: 'k' });
    assert.equal(res.status, 302, path);
    const to = new URL(res.headers.get('location'));
    assert.equal(to.pathname, '/golf/enter/', path);
    assert.equal(to.searchParams.get('next'), path, path);
  }
  // And the live contest board's data is private too.
  assert.equal((await main('/api/course/board', { ASSETS: asset, GOLF_EXPORT_KEY: 'k', DB: {} })).status, 401);

  // Printed codes on either domain are counted, then land on hyphos.io.
  for (const client of [old, main]) {
    const scan = await client('/GO/BAG');
    assert.equal(scan.status, 302);
    assert.match(scan.headers.get('location'), /^https:\/\/hyphos\.io\/\?utm_source=qr&utm_medium=print&utm_campaign=springs-golf-2026&utm_content=bag$/);
    const sign = await client('/C/CTP');
    assert.equal(sign.status, 302);
    assert.equal(sign.headers.get('location'), 'https://hyphos.io/golf/');
  }

  // Writes are never redirected: an old open page still posts.
  const post = await old('/api/course/entry', { ASSETS: notFound, DB: null }, 'POST');
  assert.notEqual(post.status, 301);
  assert.notEqual(post.status, 302);
});

test('a signed-in browser stays signed in, and the sign-in page can tell', async () => {
  const { default: worker } = await import('../src/worker.js');
  const env = { GOLF_EXPORT_KEY: 'test-key', ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  const call = (path, init = {}) => worker.fetch(new Request(`https://hyphos.io${path}`, init), env, {});

  const before = await (await call('/api/golf/session')).json();
  assert.equal(before.signedIn, false);

  const auth = await call('/api/golf/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-key' }) });
  assert.equal(auth.status, 200);
  const setCookie = auth.headers.get('set-cookie');
  assert.match(setCookie, /Max-Age=2592000/, 'thirty days');
  const cookie = setCookie.split(';')[0];

  const after = await (await call('/api/golf/session', { headers: { cookie } })).json();
  assert.equal(after.signedIn, true);
  assert.ok(new Date(after.expiresAt) > new Date(Date.now() + 29 * 86400e3));

  const out = await call('/api/golf/logout', { method: 'POST' });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('the prize draw roster is served only to a signed-in screen', async () => {
  const { default: worker } = await import('../src/worker.js');
  const get = (auth) => worker.fetch(new Request('https://hyphos.io/api/golf/roster', { headers: auth ? { authorization: auth } : {} }), { GOLF_EXPORT_KEY: 'k' }, {});
  assert.equal((await get()).status, 401);
  assert.equal((await get('Bearer wrong')).status, 401);
  const res = await get('Bearer k');
  assert.equal(res.status, 200);
  const { attendees } = await res.json();
  const roster = JSON.parse(await readFile(new URL('../src/data/roster.json', import.meta.url), 'utf8'));
  assert.equal(attendees.length, roster.length);
  assert.ok(attendees.every((a) => a.team), 'every golfer has a team or group to strike by');
  // Unknown players are open slots, never a company name standing in for a person.
  assert.ok(attendees.every((a) => a.name.toLowerCase() !== a.team.toLowerCase() && !a.team.toLowerCase().startsWith(`${a.name.toLowerCase()} `)), 'no team name used as a player');
  const named = attendees.filter((a) => a.name).map((a) => `${a.name}|${a.team}`.toLowerCase());
  assert.equal(new Set(named).size, named.length, 'no player listed twice on the same team');
});
