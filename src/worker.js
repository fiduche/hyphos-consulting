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

const PROBE_SYSTEM = `You are helping a consultant collect better answers at a golf tournament.

Someone has written what task at work they wish would do itself. Their answer is
usually two or three words, which is not enough to act on. Write ONE short
follow-up question that gets them to say something specific.

Aim at whichever of these is missing: how often it happens, how long it takes,
who does it, or what makes it annoying.

Rules:
- One question. Under 15 words.
- Plainly worded, the way a person would ask it in conversation.
- Ask about their situation, never pitch or suggest a solution.
- No preamble, no quotes, no sign-off. Output only the question.

Example. They wrote "invoicing" -> "How many invoices is that a month, and who chases them?"`;

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
         (created_at, first_name, last_name, company, role, email, cell, wish, wish_detail,
          ${CONSENT.join(', ')})
       VALUES (${Array.from({ length: 9 + CONSENT.length }, (_, i) => `?${i + 1}`).join(', ')})
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
         ${CONSENT.map((c) => `${c} = MAX(golf_entries.${c}, excluded.${c})`).join(',\n         ')}`
    )
      .bind(
        new Date().toISOString(),
        entry.first_name, entry.last_name, entry.company, entry.role,
        entry.email, entry.cell, entry.wish, entry.wish_detail,
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
        max_tokens: 100,
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
      .slice(0, 200);

    // A model that ignored the one-question instruction is worse than silence.
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
    `SELECT created_at, first_name, last_name, company, role, email, cell, wish, wish_detail,
            ${CONSENT.join(', ')}, starred
       FROM golf_entries
      ORDER BY created_at`
  ).all();

  const columns = [
    'created_at', 'first_name', 'last_name', 'company', 'role', 'email', 'cell',
    'wish', 'wish_detail', ...CONSENT, 'starred',
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

    if (pathname === '/api/golf/entries') {
      return request.method === 'GET'
        ? handleExport(request, env)
        : json({ error: 'Method not allowed.' }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
