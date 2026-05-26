# hyphosconsulting.com

Marketing site for Hyphos Consulting — the services arm behind two integrated products: **Foundation** (the operating system for the business) and **Hyphos** (the enterprise knowledge and apprenticeship layer above it).

**Live at:** [hyphosconsulting.com](https://hyphosconsulting.com)

## Stack

- **Astro 5** (static output)
- **Tailwind CSS 4**
- **Cloudflare Workers** (via the ASSETS binding — Astro builds to `dist/`, a 5-line worker delegates every request to the static assets)
- **CI deploys** from `main` via GitHub Actions (`.github/workflows/deploy-cloudflare.yml`)

## Local development

```bash
npm install
npm run dev      # localhost:4321
npm run build    # outputs to dist/
```

## Deploys

Push to `main` triggers an automatic Cloudflare deploy via GitHub Actions. The workflow:

1. Checks out the repo
2. `npm ci && npm run build`
3. `npx wrangler deploy` using the `CLOUDFLARE_API_TOKEN` repo secret

Manual deploy from a local machine (rarely needed):

```bash
npm run build
npx wrangler login    # one-time per machine
npx wrangler deploy
```

## Configuration

- `wrangler.toml` — Cloudflare Workers config (name `hyphos-consulting-website`, ASSETS binding)
- `src/worker.js` — 5-line passthrough worker
- `astro.config.mjs` — static output + sitemap
- Custom domain (`hyphosconsulting.com`, `www.hyphosconsulting.com`) is configured in the Cloudflare dashboard

## Related repos

- **[fiduche/hyphos](https://github.com/fiduche/hyphos)** — `hyphos.io`, the Hyphos product marketing site
