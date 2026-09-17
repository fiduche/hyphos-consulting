// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

/**
 * hyphosconsulting.com — static marketing site.
 * Prerendered to HTML, served by a tiny Cloudflare Worker via the ASSETS
 * binding (see wrangler.toml + src/worker.js). Same pattern as wander-website.
 */
export default defineConfig({
  site: 'https://hyphosconsulting.com',
  output: 'static',
  // Every page left on this domain is a noindex tournament screen, so there is
  // nothing to put in a sitemap. The marketing site's sitemap lives on hyphos.io.
  integrations: [],
  vite: {
    plugins: [tailwindcss()],
  },
});
