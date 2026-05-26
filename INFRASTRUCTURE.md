# Infrastructure — hyphosconsulting.com

Operational reference for the `hyphosconsulting.com` marketing site. Captures what's set up, how it deploys, where the gotchas are, and what to do when something looks broken.

---

## Domains

| Domain | Purpose | Registrar | Nameservers |
|---|---|---|---|
| `hyphosconsulting.com` | Marketing site (this repo) | (your registrar) | Cloudflare (`kyle.ns.cloudflare.com`, `nena.ns.cloudflare.com`) |
| `www.hyphosconsulting.com` | Same site, www alias | — | Same as above |

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

`CLOUDFLARE_API_TOKEN` — account-scoped, "Edit Cloudflare Workers" template. Same token as `fiduche/hyphos`.

---

## Email — Google Workspace (Workspace #1)

Email for this domain runs on **Google Workspace**, not Cloudflare Email Routing. This Workspace is separate from the one tied to `hyphos.io`.

### Workspace #1 setup

- **Primary domain:** `hyphosconsulting.com`
- **Admin account:** `daniel.m.newton@gmail.com` (consumer Google account used as Workspace admin)
- **Primary user:** `dnewton@hyphosconsulting.com`
- **DNS:** Google Workspace MX records pointing to `aspmx.l.google.com` and `alt1–4.aspmx.l.google.com`

### Do NOT delete the Google MX records

The Cloudflare Email Routing flow will offer to "clean up incompatible records" — it wants to replace Google's MX with `route1/2/3.mx.cloudflare.net`. Doing this **breaks `dnewton@hyphosconsulting.com`** and any other Workspace email on this domain. Cancel out of that flow if you ever land on it.

### Adding aliases

If you want `hello@hyphosconsulting.com`, `sales@hyphosconsulting.com`, etc. — add as aliases on the existing user, not as new users:

1. admin.google.com → **Directory → Users**
2. Click `dnewton@hyphosconsulting.com`
3. **User information → Email aliases → Add an alias**
4. Save

Aliases on the same domain are free and unlimited.

### Adding the consulting site's contact form

Currently the site's `/contact` page uses a Formspree placeholder. To wire it to your Workspace inbox, either:

- Replace the Formspree placeholder with your real Formspree URL (free tier: 50 submissions/month)
- Or build a Cloudflare Worker endpoint that emails via Resend/Postmark/SendGrid to `dnewton@hyphosconsulting.com`

---

## Common gotchas

### "The site is down for me"

Same diagnostic flow as hyphos.io — almost always WiFi router DNS cache or browser handshake cache. Restart the router, hard-refresh the browser, or test from cellular.

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

- **`fiduche/hyphos`** — sibling repo for the `hyphos.io` product marketing site. Same deploy pattern, same Cloudflare account, same API token. **Different Workspace account** (Workspace #2 with primary `hyphos.io`, only user is the notetaker bot `meeting@hyphos.io`).
- **Foundation** — the integrated business OS product. The `/products` page on this site documents it; the platform itself lives in a separate codebase (Cornerstone SQL — `/Users/daniel/Desktop/Cornerstone SQL/`).
- **Hyphos product site** — <https://hyphos.io>. Cross-linked from this site's home, products, and footer.
