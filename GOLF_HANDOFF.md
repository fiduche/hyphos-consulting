# Golf tournament build — handoff

Springs Men's Golf Classic, D'Arcy Ranch, **Friday 18 September 2026**.
Registration 11:00, shotgun 1:00, dinner and prizes 6:00. Hyphos is a **Diamond
sponsor ($1,500)**: four tickets, a sponsored hole, and a verbal recognition
slot at dinner.

Strategy, run-of-show, scripts and the countdown live in the playbook artifact:
<https://claude.ai/code/artifact/4552cb24-9911-46c6-906d-14425a145bcc>
Technical detail is in `INFRASTRUCTURE.md` under "Golf tournament entry form".

## What exists, all live

| URL | What |
|---|---|
| `/golf` | Entry form, reached by QR at the hole |
| `/ai` | The "10 ways" piece the form promises **(draft, unreviewed)** |
| `/golf/enter` | Sign in once; mints a 14h HttpOnly cookie |
| `/golf/board` | Hole screen, all day, hotspot, auto-refresh |
| `/golf/live` | Dinner screen, keyboard-driven draw |
| `/api/golf/summary` | Text readout: groups, both draws, verbatims, "THE LINE" |
| `/api/golf/entries` | CSV export |

Add `?demo=1` to either screen to rehearse with sample data and no API call.

## Credentials

- **Password:** `3376cae4ea934379afdcad91a045fd46b84a73ef` (Cloudflare secret
  `GOLF_EXPORT_KEY`). Rotate with `npx wrangler secret put GOLF_EXPORT_KEY`.
- **`ANTHROPIC_API_KEY` expires 2026-09-30 23:00**, twelve days after the
  event. Nothing alerts on it; the probe fails open, so the symptom is silence.

## Decisions worth not relitigating

- **Two prizes, two mechanisms, both stated on the form.** Tidal rangefinder is
  a random draw; Hyphos Pro V1s goes to the best answer, judged. Picking a
  winner on merit after calling it a draw was rejected: these are people he sees
  at church on Sundays.
- **Draw order is a `draw_key` written when each person enters.** It cannot be
  rerolled by reloading, and the dinner screen's reel reveals an already-settled
  result. Within one page load the winner never changes; that is deliberate.
- **Groupings are derived by the model from the real answers**, not a fixed
  taxonomy. A hand-written vocabulary mislabelled the very first real entry.
- **Every answer is printed verbatim** under the groups. Categories are a
  convenience; the raw text is the record.
- **No `?key=` anywhere.** The dinner screen runs on a projector, where a
  querystring secret is readable by anyone with a phone.

## Gotchas that already cost time

- **Cloudflare edge-caches `/golf/*`.** A cached page pins the HTML to an old JS
  bundle, so a deployed fix can look like it never happened. `public/_headers`
  now sets `no-store`; if behaviour looks stale, check `cf-cache-status` before
  debugging the code.
- **Astro scopes styles at build time.** Nodes injected at runtime never get the
  scope attribute, so their CSS silently does nothing. The screens use
  `<style is:global>` for that reason.
- **Deploys take ~15s to reach the edge.** Curling immediately gives stale
  results and has twice looked like a bug.
- Re-running `schema.sql` **drops `golf_entries`**. Use `ALTER TABLE` for
  additive changes; there is a real entry in there.

## Open, all needing Daniel

1. **Send the organizer email** (drafted in the playbook): hole plan, data
   collection, and the 2–3 minute dinner slot placed **early** in the 30–40
   prize run.
2. **Confirm outside food and beverage** with D'Arcy Ranch directly.
3. **Book two people** to staff the hole. Most likely item to fail late.
4. **Write the "10 ways" piece** or approve the `/ai` draft; four open questions
   on it (naming the funeral group, the "Okotoks & Calgary" line, the 45-minute
   offer wording, and the CTA target).
5. **Headshot** for the hole sign, currently a placeholder.
6. **Confirm the Hyphos prize** is the Pro V1s.
7. Ask Laird for the rangefinder and tell him plainly that the ten-second credit
   from the mic is worth more than any logo he could buy.

## After the event

Unset `GOLF_EXPORT_KEY`, remove the public `POST /api/golf/entry` route, and log
two numbers for next year: entries collected, and how many were owners.
