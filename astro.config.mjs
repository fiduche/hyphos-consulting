// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/**
 * hyphosconsulting.com — static marketing site.
 * Prerendered to HTML, served by a tiny Cloudflare Worker via the ASSETS
 * binding (see wrangler.toml + src/worker.js). Same pattern as wander-website.
 */
export default defineConfig({
  site: 'https://hyphosconsulting.com',
  output: 'static',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
