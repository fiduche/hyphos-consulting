import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { clean, looksLikeEmail, normaliseCell } from '../src/worker.js';

const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');

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
