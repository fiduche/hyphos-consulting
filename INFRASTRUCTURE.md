# Infrastructure, hyphosconsulting.com

Operational reference for the `hyphosconsulting.com` marketing site. Captures what's set up, how it deploys, where the gotchas are, and what to do when something looks broken.

---

## Domains

| Domain | Purpose | Registrar | Nameservers |
|---|---|---|---|
| `hyphosconsulting.com` | Marketing site (this repo) | (your registrar) | Cloudflare (`kyle.ns.cloudflare.com`, `nena.ns.cloudflare.com`) |
| `www.hyphosconsulting.com` | Same site, www alias | | Same as above |

Both apex and www are mapped as Custom Domains on the Cloudflare Worker.

---

## Hosting

- **Platform:** Cloudflare Workers (static-assets pattern via the ASSETS binding)
- **Worker name:** `hyphos-consulting-website`
- **Account:** `daniel.m.newton@gmail.com`'s Cloudflare account
- **Workers.dev URL:** `https://hyphos-consulting-website.daniel-m-newton.workers.dev` (always live, useful for diagnostics)
- **Dashboard path:** Workers & Pages → `hyphos-consulting-website` → Settings

The Worker is a 5-line passthrough (`src/worker.js`) that delegates every request to the `ASSETS` binding serving the static `dist/` directory. Astro builds to `dist/` at build time. No SSR runtime.

---

## Deploy

**Push to `main` auto-deploys.** GitHub Actions workflow at `.github/workflows/deploy-cloudflare.yml`:

1. Checks out repo
2. `npm ci && npm run build` (Node 22)
3. `npx wrangler deploy` using `CLOUDFLARE_API_TOKEN` repo secret

End-to-end: ~30 seconds from push to live.

### Manual deploy from a local machine

```bash
npm install
npm run build
npx wrangler login    # one-time per machine
npx wrangler deploy
```

### Roll back

```bash
git revert <bad-sha>
git push
```

Or Cloudflare dashboard → Workers & Pages → hyphos-consulting-website → Deployments → click a prior version → **Rollback to this version**.

### Required GitHub secret

`CLOUDFLARE_API_TOKEN`, account-scoped, "Edit Cloudflare Workers" template. Same token as `fiduche/hyphos`.

---

## Email, Google Workspace (Workspace #1)

Email for this domain runs on **Google Workspace**, not Cloudflare Email Routing. This Workspace is separate from the one tied to `hyphos.io`.

### Workspace #1 setup

- **Primary domain:** `hyphosconsulting.com`
- **Admin account:** `daniel.m.newton@gmail.com` (consumer Google account used as Workspace admin)
- **Primary user:** `dnewton@hyphosconsulting.com`
- **DNS:** Google Workspace MX records pointing to `aspmx.l.google.com` and `alt1–4.aspmx.l.google.com`

### Do NOT delete the Google MX records

The Cloudflare Email Routing flow will offer to "clean up incompatible records", it wants to replace Google's MX with `route1/2/3.mx.cloudflare.net`. Doing this **breaks `dnewton@hyphosconsulting.com`** and any other Workspace email on this domain. Cancel out of that flow if you ever land on it.

### Public contact address

This site's contact links all point to **`info@hyphos.io`**, a real Google Workspace mailbox in the *other* Workspace (the `hyphos.io` one). One unified contact email across both marketing sites. See the `hyphos.io` repo's INFRASTRUCTURE.md for the email setup.

### Adding aliases on this Workspace if you want them

If you want `sales@hyphosconsulting.com`, `legal@hyphosconsulting.com`, etc. as additional addresses on `dnewton@hyphosconsulting.com`:

1. admin.google.com → **Directory → Users**
2. Click `dnewton@hyphosconsulting.com`
3. **User information → Email aliases → Add an alias**
4. Save

Aliases on the same domain are free and unlimited. Note: the public marketing site uses `info@hyphos.io` as the contact, so don't add a `hello@` or `info@` alias here unless you want a separate inbox for consulting-specific mail.

### Adding the consulting site's contact form

Currently the site's `/contact` page uses a Formspree placeholder. To wire it to your Workspace inbox, either:

- Replace the Formspree placeholder with your real Formspree URL (free tier: 50 submissions/month)
- Or build a Cloudflare Worker endpoint that emails via Resend/Postmark/SendGrid to `dnewton@hyphosconsulting.com`

---

## Golf tournament entry form (`/golf`)

Entry capture for the Springs Men's Golf Classic, D'Arcy Ranch, **Sept 18 2026**. Reached by QR code at the sponsored hole, so it is filled in on a phone, outdoors, possibly on one bar of signal.

The site stays fully static. The worker gained two routes; everything else still falls through to `ASSETS`.

| Route | Access | Purpose |
|---|---|---|
| `POST /api/golf/entry` | Public | Writes one row to D1. Honeypot + length caps + email sanity check. |
| `GET /api/golf/entries` | Secret-gated | CSV export of all entries. |

### One-time setup

```bash
npx wrangler d1 create hyphos-golf          # paste the database_id into wrangler.toml
npx wrangler d1 execute hyphos-golf --remote --file=./schema.sql
npx wrangler secret put GOLF_EXPORT_KEY     # any long random string
```

Then push to `main` as usual. `wrangler.toml` ships with `database_id = "PASTE_DATABASE_ID_HERE"`. **The deploy will fail until that's replaced.**

### Getting the entries out

```bash
npx wrangler d1 execute hyphos-golf --remote --command "SELECT * FROM golf_entries ORDER BY created_at"
```

Or, in a browser, `https://hyphosconsulting.com/api/golf/entries?key=<GOLF_EXPORT_KEY>` for a CSV download. The key travels in the query string, so treat it as event-scoped, rotate or unset it after Sept 18.

### Notes

- **Duplicate submits collapse.** A unique index on `lower(email)` plus an upsert means a double-tapped button on flaky signal updates the row rather than creating a second one. Checkbox opt-ins only ever ratchet up, so a retry can't silently un-tick something.
- **Offline entries are queued, not lost.** If the POST fails, the page stores the entry in `localStorage` and retries on next load and on the browser's `online` event. The golfer sees a success state either way, there is nothing for them to redo.
- **`starred`** is set by hand after the event, for whoever named a specific problem out loud at the hole. Those get the personal follow-up rather than the bulk email.
- **Paper cards remain the real backup.** The queue handles bad signal; it does not handle a dead phone battery or someone who won't scan a QR.
- **After the event**, unset `GOLF_EXPORT_KEY` and consider removing the POST route. An open write endpoint has no reason to stay live once the tournament is over.

---

## Common gotchas

### "The site is down for me"

Same diagnostic flow as hyphos.io, almost always WiFi router DNS cache or browser handshake cache. Restart the router, hard-refresh the browser, or test from cellular.

Global state checks (ignore your own browser):
- `dig +short A hyphosconsulting.com @1.1.1.1`
- <https://dnschecker.org/#A/hyphosconsulting.com>
- <https://www.isitdownrightnow.com/hyphosconsulting.com.html>

### Cert just provisioned, www doesn't load yet

Cloudflare provisions one SSL cert per custom domain. Apex and www provision separately. Wait 5–15 minutes after adding the custom domain.

### Recent deploy didn't show up

Check the GitHub Actions run: <https://github.com/fiduche/hyphos-consulting/actions>. Workers takes ~10 sec to roll new versions to the edge. Browser caching is usually the culprit; hard refresh.

---

## Related infrastructure

- **`fiduche/hyphos`**, sibling repo for the `hyphos.io` product marketing site. Same deploy pattern, same Cloudflare account, same API token. **Different Workspace account** (Workspace #2 with primary `hyphos.io`, only user is the notetaker bot `meeting@hyphos.io`).
- **Foundation**, the integrated business OS product. The `/products` page on this site documents it; the platform itself lives in a separate codebase (Cornerstone SQL, `/Users/daniel/Desktop/Cornerstone SQL/`).
- **Hyphos product site**, <https://hyphos.io>. Cross-linked from this site's home, products, and footer.
