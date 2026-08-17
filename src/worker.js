// Cloudflare Worker entry.
//
// The site is still fully static — Astro prerenders everything to ./dist and
// the ASSETS binding serves it. The only dynamic surface is the golf
// tournament entry form at /golf, which needs somewhere to put entries:
//
//   POST /api/golf/entry     public, writes one row to D1
//   GET  /api/golf/entries   secret-gated, exports CSV
//
// Everything else falls straight through to ASSETS exactly as before.

const MAX = { name: 120, company_role: 160, email: 200, cell: 40, wish: 600 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Trim, cap length, and coerce missing values to ''. */
const clean = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Loose on purpose — a rejected real address costs more than a junk row. */
const looksLikeEmail = (value) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);

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
    name: clean(body.name, MAX.name),
    company_role: clean(body.company_role, MAX.company_role),
    email: clean(body.email, MAX.email),
    cell: clean(body.cell, MAX.cell),
    wish: clean(body.wish, MAX.wish),
    want_list: body.want_list ? 1 : 0,
    want_talk: body.want_talk ? 1 : 0,
    knows_someone: body.knows_someone ? 1 : 0,
    want_tidal: body.want_tidal ? 1 : 0,
  };

  if (!entry.name) return json({ error: 'Name is required.' }, 400);
  if (!entry.company_role) return json({ error: 'Company and role are required.' }, 400);
  if (!looksLikeEmail(entry.email)) return json({ error: 'That email address looks off.' }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO golf_entries
         (created_at, name, company_role, email, cell, wish,
          want_list, want_talk, knows_someone, want_tidal)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       -- A resubmit should only ever add information, never remove it. Required
       -- fields overwrite; optional ones keep the existing value when the new
       -- submission left them blank, so a hurried second entry can't wipe a
       -- phone number or an answer given the first time round.
       ON CONFLICT(lower(email)) DO UPDATE SET
         name          = excluded.name,
         company_role  = excluded.company_role,
         cell          = CASE WHEN excluded.cell <> '' THEN excluded.cell ELSE golf_entries.cell END,
         wish          = CASE WHEN excluded.wish <> '' THEN excluded.wish ELSE golf_entries.wish END,
         want_list     = MAX(golf_entries.want_list,     excluded.want_list),
         want_talk     = MAX(golf_entries.want_talk,     excluded.want_talk),
         knows_someone = MAX(golf_entries.knows_someone, excluded.knows_someone),
         want_tidal    = MAX(golf_entries.want_tidal,    excluded.want_tidal)`
    )
      .bind(
        new Date().toISOString(),
        entry.name,
        entry.company_role,
        entry.email,
        entry.cell,
        entry.wish,
        entry.want_list,
        entry.want_talk,
        entry.knows_someone,
        entry.want_tidal
      )
      .run();
  } catch (error) {
    // The client queues failed submissions and retries, so a 500 here is
    // recoverable rather than lost.
    return json({ error: 'Could not save that. It will retry automatically.' }, 500);
  }

  return json({ ok: true });
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
    `SELECT created_at, name, company_role, email, cell, wish,
            want_list, want_talk, knows_someone, want_tidal, starred
       FROM golf_entries
      ORDER BY created_at`
  ).all();

  const columns = [
    'created_at', 'name', 'company_role', 'email', 'cell', 'wish',
    'want_list', 'want_talk', 'knows_someone', 'want_tidal', 'starred',
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

    if (pathname === '/api/golf/entries') {
      return request.method === 'GET'
        ? handleExport(request, env)
        : json({ error: 'Method not allowed.' }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
