// Cloudflare Worker entry.
//
// Adds one AI route on top of the entry form: POST /api/golf/probe takes the
// golfer's one-line answer and returns a single sharper follow-up question, so
// the answer that reaches the dinner slide is "chasing 40 invoices a month,
// each one a phone call" rather than "invoicing".
//
// The site is still fully static. Astro prerenders everything to ./dist and
// the ASSETS binding serves it. The only dynamic surface is the golf
// tournament entry form at /golf, which needs somewhere to put entries:
//
//   POST /api/golf/entry     public, writes one row to D1
//   GET  /api/golf/entries   secret-gated, exports CSV
//
// Everything else falls straight through to ASSETS exactly as before.

import Anthropic from '@anthropic-ai/sdk';

// Haiku for the follow-up: it is one short question on a phone with one bar of
// signal, so time-to-answer matters far more than depth.
const PROBE_MODEL = 'claude-haiku-4-5';
const PROBE_TIMEOUT_MS = 4500;
const PROBE_HOURLY_CAP = 250;
const PROBE_MIN_CHARS = 4;


const PROBE_SYSTEM = `You are writing one short follow-up line for a contest form at a charity golf
tournament. It should read like a friendly person leaning over to ask, not like a
form field.

Someone has written what task at work they wish would do itself. Their answer is
usually two or three words, which isn't enough to act on. React to what they
wrote in a few words, then ask ONE question that gets a specific answer: how
often it happens, how long it takes, who does it, or what makes it maddening.

Tone: warm and a bit funny, like a friendly jab between two people who just met
on a golf course. Commiserate with them rather than tease them. Never sarcastic,
never at their expense, and keep it clean, this is a church event.

Rules:
- A short reaction, then one question. Under 25 words total.
- Talk like a person. Contractions are good.
- Never pitch, never suggest a fix, never mention software or AI.
- At most one exclamation mark. If nothing funny comes to mind, just be warm.
- Never use an em dash. Use a comma or a full stop instead.
- Vary how you open. Don't lean on "Oh man" or "that's a beast"; several people
  will be filling this in near each other and comparing.
- No preamble, no quotes, no sign-off. Output only the line.

Examples:
"everything" -> "Everything? Oh no. Okay, what's the one that bugs you most?"
"invoicing" -> "Invoicing, the eternal enemy. How many a month are we talking?"
"scheduling" -> "Oof. Is that scheduling people, or scheduling jobs?"
"paperwork" -> "Nobody has ever said paperwork with joy. How many hours a week?"`;

const MAX = {
  first_name: 80, last_name: 80, company: 140, role: 120,
  email: 200, cell: 40, wish: 600,
};

// Every consent flag. Nothing is pre-ticked on the form, and none of these
// gate entry into the draw: the winner is reachable by email either way.
const CONSENT = [
  'want_list',
  'hyphos_company', 'hyphos_workplace', 'hyphos_referral',
  'tidal_company', 'tidal_workplace', 'tidal_personal',
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Trim, cap length, and coerce missing values to ''. */
const clean = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Requires text, an @, more text, a dot, and a real suffix. Mirrors the form. */
const looksLikeEmail = (value) => /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[A-Za-z]{2,}$/.test(value);

/** Store phones in one shape regardless of how they were typed. */
const normaliseCell = (value) => {
  let d = String(value || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
};

async function handleEntry(request, env) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Could not read that submission.' }, 400);
  }

  // Honeypot. Real people never fill a field they cannot see; bots fill
  // everything. Return 200 so the bot believes it succeeded and moves on.
  if (clean(body.website, 200)) return json({ ok: true });

  const entry = {
    first_name: clean(body.first_name, MAX.first_name),
    last_name: clean(body.last_name, MAX.last_name),
    company: clean(body.company, MAX.company),
    role: clean(body.role, MAX.role),
    email: clean(body.email, MAX.email),
    cell: normaliseCell(body.cell),
    wish: clean(body.wish, MAX.wish),
    wish_detail: clean(body.wish_detail, MAX.wish_detail),
    probe_question: clean(body.probe_question, MAX.probe_question),
  };
  for (const flag of CONSENT) entry[flag] = body[flag] ? 1 : 0;

  if (!entry.first_name) return json({ error: 'First name is required.' }, 400);
  if (!entry.last_name) return json({ error: 'Last name is required.' }, 400);
  if (!entry.company) return json({ error: 'Company is required.' }, 400);
  if (!entry.role) return json({ error: 'Role is required.' }, 400);
  if (!looksLikeEmail(entry.email)) return json({ error: 'That email address looks off.' }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO golf_entries
         (created_at, first_name, last_name, company, role, email, cell, wish, wish_detail, probe_question,
          ${CONSENT.join(', ')})
       VALUES (${Array.from({ length: 10 + CONSENT.length }, (_, i) => `?${i + 1}`).join(', ')})
       -- A resubmit should only ever add information, never remove it. Required
       -- fields overwrite; optional ones keep the existing value when the new
       -- submission left them blank, so a hurried second entry can't wipe a
       -- phone number or an answer given the first time round. Consent flags
       -- only ratchet up, so a retry can never silently withdraw a tick.
       ON CONFLICT(lower(email)) DO UPDATE SET
         first_name = excluded.first_name,
         last_name  = excluded.last_name,
         company    = excluded.company,
         role       = excluded.role,
         cell = CASE WHEN excluded.cell <> '' THEN excluded.cell ELSE golf_entries.cell END,
         wish = CASE WHEN excluded.wish <> '' THEN excluded.wish ELSE golf_entries.wish END,
         wish_detail = CASE WHEN excluded.wish_detail <> '' THEN excluded.wish_detail ELSE golf_entries.wish_detail END,
         probe_question = CASE WHEN excluded.probe_question <> '' THEN excluded.probe_question ELSE golf_entries.probe_question END,
         ${CONSENT.map((c) => `${c} = MAX(golf_entries.${c}, excluded.${c})`).join(',\n         ')}`
    )
      .bind(
        new Date().toISOString(),
        entry.first_name, entry.last_name, entry.company, entry.role,
        entry.email, entry.cell, entry.wish, entry.wish_detail,
        entry.probe_question,
        ...CONSENT.map((flag) => entry[flag])
      )
      .run();
  } catch (error) {
    // The client queues failed submissions and retries, so a 500 here is
    // recoverable rather than lost.
    return json({ error: 'Could not save that. It will retry automatically.' }, 500);
  }

  return json({ ok: true });
}

/**
 * One adaptive follow-up question for the bonus-entry answer.
 *
 * Deliberately fail-open: any error, timeout, or cap breach returns
 * {question: null} with a 200 so the form treats it as "no follow-up" and the
 * golfer's entry is never blocked by an LLM call on course wifi.
 */
async function handleProbe(request, env) {
  const quiet = () => json({ question: null });

  if (!env.ANTHROPIC_API_KEY || !env.DB) return quiet();

  let body;
  try {
    body = await request.json();
  } catch {
    return quiet();
  }

  const wish = clean(body.wish, MAX.wish);
  if (wish.length < PROBE_MIN_CHARS) return quiet();

  try {
    // Trailing-hour spend guard. A public endpoint that calls a paid API needs
    // a ceiling that does not depend on nobody noticing it exists.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { results } = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM probe_log WHERE created_at > ?1'
    ).bind(since).all();
    if ((results?.[0]?.n ?? 0) >= PROBE_HOURLY_CAP) return quiet();

    await env.DB.prepare('INSERT INTO probe_log (created_at) VALUES (?1)')
      .bind(new Date().toISOString())
      .run();
  } catch {
    return quiet();
  }

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const message = await client.messages.create(
      {
        model: PROBE_MODEL,
        max_tokens: 200,
        system: PROBE_SYSTEM,
        messages: [{ role: 'user', content: wish }],
      },
      { timeout: PROBE_TIMEOUT_MS, maxRetries: 1 }
    );

    if (message.stop_reason === 'refusal') return quiet();

    const question = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim()
      .replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, '')
      .slice(0, 300);

    // A reply that ignored the one-question instruction is worse than silence.
    if (!question || !question.includes('?')) return quiet();

    return json({ question });
  } catch {
    return quiet();
  }
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function handleExport(request, env) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);

  // Set with: npx wrangler secret put GOLF_EXPORT_KEY
  const expected = env.GOLF_EXPORT_KEY;
  if (!expected) return json({ error: 'Export is not configured.' }, 503);

  const url = new URL(request.url);
  const supplied =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('key') ??
    '';

  if (supplied !== expected) return json({ error: 'Not authorized.' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT created_at, first_name, last_name, company, role, email, cell, wish, wish_detail, probe_question, category,
            ${CONSENT.join(', ')}, starred
       FROM golf_entries
      ORDER BY created_at`
  ).all();

  const columns = [
    'created_at', 'first_name', 'last_name', 'company', 'role', 'email', 'cell',
    'wish', 'wish_detail', 'probe_question', 'category', ...CONSENT, 'starred',
  ];

  const csv = [
    columns.join(','),
    ...(results ?? []).map((row) => columns.map((c) => csvCell(row[c])).join(',')),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="golf-entries.csv"',
      'cache-control': 'no-store',
    },
  });
}

/**
 * The dinner readout. Hit this on a phone at 5:45pm and it prints what to say:
 * how many answered, the room's top time-wasters ranked, and a few verbatim
 * lines worth reading out. Plain text on purpose, so it is legible at a table.
 */
async function handleSummary(request, env) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);

  const expected = env.GOLF_EXPORT_KEY;
  if (!expected) return json({ error: 'Export is not configured.' }, 503);

  const url = new URL(request.url);
  const supplied =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('key') ??
    '';
  if (supplied !== expected) return json({ error: 'Not authorized.' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT first_name, last_name, company, wish, wish_detail, category
       FROM golf_entries ORDER BY created_at`
  ).all();
  const rows = results ?? [];

  const answered = rows.filter((r) => (r.wish || '').trim());

  const lines = [];
  lines.push(`ENTRIES: ${rows.length}`);
  lines.push(`ANSWERED THE BONUS QUESTION: ${answered.length}`);

  // Grouping is derived from what the room actually wrote, not from a fixed
  // list. A vocabulary invented in advance mislabels anything it didn't
  // anticipate, and the label is what gets read out loud.
  let groups = null;
  if (answered.length && env.ANTHROPIC_API_KEY) {
    try {
      const numbered = answered
        .map((r, i) => `${i + 1}. ${r.wish}${(r.wish_detail || '').trim() ? ` (${r.wish_detail})` : ''}`)
        .join('\n');

      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const res = await client.messages.create(
        {
          model: 'claude-opus-5',
          max_tokens: 4000,
          system: `Below are answers from business people at a golf tournament, each asked what task at work they wish would do itself.

Group them by what the underlying problem actually is. Derive the groups from these answers; do not force them into standard business categories. If several people describe the same underlying problem in different words, that is one group. If someone's answer is genuinely its own thing, let it be its own group.

Label each group in plain words that can be read out loud to a room, six words at most, no jargon. "chasing invoices" not "accounts receivable management".

Every answer belongs to exactly one group. Use each number once.`,
          messages: [{ role: 'user', content: numbered }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  groups: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        members: { type: 'array', items: { type: 'integer' } },
                      },
                      required: ['label', 'members'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['groups'],
                additionalProperties: false,
              },
            },
          },
        },
        { timeout: 60000, maxRetries: 1 }
      );

      const parsed = JSON.parse(
        res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      );

      // Counts come from validated membership, never from a number the model
      // asserted. Each answer counts once, for the first group claiming it.
      const claimed = new Set();
      groups = (parsed.groups || [])
        .map((g) => ({
          label: String(g.label || '').trim(),
          members: (g.members || [])
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= answered.length)
            .filter((n) => (claimed.has(n) ? false : (claimed.add(n), true))),
        }))
        .filter((g) => g.label && g.members.length)
        .sort((a, b) => b.members.length - a.members.length);

      const missed = answered.length - claimed.size;
      if (missed > 0) groups.push({ label: 'everything else', members: [], missed });
    } catch {
      groups = null;
    }
  }

  lines.push('');
  if (groups && groups.length) {
    lines.push('WHAT THE ROOM SAID');
    for (const g of groups) {
      const n = g.members.length || g.missed || 0;
      if (!n) continue;
      lines.push(`  ${String(n).padStart(3)}  ${g.label}`);
    }
  } else if (answered.length) {
    lines.push('WHAT THE ROOM SAID');
    lines.push('  (grouping unavailable, read the verbatim list below)');
  }

  // ── The draw ────────────────────────────────────────────────────────────
  // Deterministic shuffle seeded from the entry set, so refreshing the page
  // returns the same order. A raffle you can silently reroll until you like the
  // winner is not a raffle. Absences are handled by going down the list, not by
  // drawing again.
  let drawOrder = [];
  if (rows.length) {
    let seed = 0;
    for (const row of rows) {
      const s = `${row.first_name}${row.last_name}${row.company}`;
      for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
    }
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = [...rows];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    drawOrder = order.slice(0, 5);
    lines.push('');
    lines.push('RANDOM DRAW  (Tidal rangefinder)');
    lines.push('  Call name 1. Not in the room, call name 2, and so on down.');
    drawOrder.forEach((row, i) => {
      lines.push(`  ${i + 1}. ${row.first_name} ${row.last_name}, ${row.company}`);
    });
  }

  // ── Best answer ─────────────────────────────────────────────────────────
  // Judged, not computed. The endpoint shortlists; the choice is the owner's.
  const shortlist = answered
    .filter((r) => (r.wish_detail || '').trim().length > 12)
    .sort((a, b) => (b.wish_detail || '').length - (a.wish_detail || '').length)
    .slice(0, 5);

  if (shortlist.length) {
    lines.push('');
    lines.push('BEST ANSWER  (Hyphos Pro V1s)');
    lines.push('  Your pick, ranked by how much they wrote. Go down if not present.');
    shortlist.forEach((row, i) => {
      lines.push(`  ${i + 1}. ${row.first_name} ${row.last_name}, ${row.company}`);
      lines.push(`     "${row.wish}" -> ${row.wish_detail}`);
    });

    // Same person can legitimately top both lists. Announcing one name twice in
    // front of the room is avoidable, so say so before it happens.
    const key = (r) => `${r.first_name} ${r.last_name}, ${r.company}`;
    const drawKeys = new Set(drawOrder.map(key));
    const clashes = shortlist.filter((r) => drawKeys.has(key(r))).map(key);
    if (clashes.length) {
      lines.push('');
      lines.push('  HEADS UP: also in the draw list above:');
      clashes.forEach((name) => lines.push(`    ${name}`));
      lines.push('  Award the best answer first, then skip them in the draw.');
    }
  }

  // Verbatims: the specific ones are the ones worth reading out. Longest
  // follow-up answers first, since those are the people who actually elaborated.
  const substance = (r) => `${r.wish || ''} ${r.wish_detail || ''}`.trim().length;
  const verbatims = [...answered].sort((a, b) => substance(b) - substance(a)).slice(0, 8);

  if (verbatims.length) {
    lines.push('');
    lines.push('WORTH READING OUT');
    for (const row of verbatims) {
      lines.push(`  "${row.wish}"`);
      if ((row.wish_detail || '').trim()) lines.push(`     -> ${row.wish_detail}`);
      lines.push(`     (${row.first_name} ${row.last_name}, ${row.company})`);
    }
  }

  const top = (groups || []).filter((g) => g.members.length).slice(0, 3);
  if (top.length) {
    lines.push('');
    lines.push('THE LINE');
    lines.push(
      `  "I asked what you'd hand off if you could. ` +
        top.map((g) => `${g.members.length} of you said ${g.label}`).join(', ') +
        `."`
    );
  }

  if (answered.length) {
    lines.push('');
    lines.push(`EVERY ANSWER, VERBATIM  (${answered.length})`);
    lines.push('  The categories above are a convenience. This is the record.');
    for (const row of answered) {
      lines.push(`  ${row.first_name} ${row.last_name}, ${row.company}`);
      lines.push(`     "${row.wish}"`);
      if ((row.wish_detail || '').trim()) lines.push(`     -> ${row.wish_detail}`);
    }
  }

  return new Response(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/golf/entry') {
      return request.method === 'POST'
        ? handleEntry(request, env)
        : json({ error: 'Method not allowed.' }, 405);
    }

    if (pathname === '/api/golf/probe') {
      return request.method === 'POST'
        ? handleProbe(request, env)
        : json({ error: 'Method not allowed.' }, 405);
    }

    if (pathname === '/api/golf/summary') {
      return request.method === 'GET'
        ? handleSummary(request, env)
        : json({ error: 'Method not allowed.' }, 405);
    }

    if (pathname === '/api/golf/entries') {
      return request.method === 'GET'
        ? handleExport(request, env)
        : json({ error: 'Method not allowed.' }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
