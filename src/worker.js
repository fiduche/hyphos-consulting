// Cloudflare Worker entry — delegates every request to the static assets
// served from ./dist via the ASSETS binding (wrangler.toml). Astro builds
// everything to HTML at build time, so there's no SSR runtime here.
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
