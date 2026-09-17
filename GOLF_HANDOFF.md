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
| `/ai` | Moved. The "10 ways" piece the form promises is now `hyphos.io/field-notes/ten-ways-small-businesses-use-ai/`; `/ai` redirects there. Link that URL in the follow-up email. |
| Everything else | **This domain now only serves the tournament.** Marketing pages 301 to hyphos.io; `/go/<tag>` lands on the hyphos.io homepage after logging the scan. |
| `/golf/enter` | Sign in once; mints a 14h HttpOnly cookie |
| `/golf/board` | Hole screen, all day, hotspot, auto-refresh |
| `/golf/judge` | Choose the judged Pro V1s winner, on the dinner laptop |
| `/golf/live` | Retired. Forwards to `/golf/prizes` |
| `/api/golf/summary` | Text readout: groups, both draws, verbatims, "THE LINE" |
| `/api/golf/entries` | CSV export |
| `/golf/prizes` | **The one dinner screen.** Paste the attendee list and prize table, strike the score winners, draw every prize. Tag the contest prizes on their lines: `Dozen Pro V1s \| Hyphos Inc. \| best answer` (judged pick, answer read out first), `Rangefinder \| Tidal Insurance \| entry draw` (people who entered at `/golf`, order fixed at entry), `$500 gift card \| Hyphos Inc. \| square` (people who posted in the square). Press **Load contest entries** once, signed in, close to dinner; after that it runs offline. Winners export as CSV. `?demo=1` rehearses under separate storage. |
| `/course` | **Live on-course contest board.** Replaces the pinned sheets. Phone and clubhouse TV. `?demo=1` sample data, `?admin=1` adds remove buttons (needs the screen sign-in). |
| `/c/<CODE>` | QR on each contest sign (`/C/CTP`, `/C/LD`, `/C/LP`, `/C/SQ`). Logs the scan, opens the entry form. Contests and hole numbers live in `src/data/contests.js`. Needs `migrations/2026-09-16-course-entries.sql` applied remotely once. |
| `/go/<tag>` | QR tracking redirect. Printed codes carry `/GO/BAG`, `/GO/HAND`, `/GO/HOLE`, `/GO/TABLE`, `/GO/SCREEN`; each hit is logged then sent to the homepage. Counts at `/api/golf/scans` (same gate as the screens). Needs `migrations/2026-09-16-scan-log.sql` applied remotely once. |

Add `?demo=1` to either screen to rehearse with sample data and no API call.

## Credentials

- The screen password is the Cloudflare secret `GOLF_EXPORT_KEY`. It must never
  be written in this repository. Store it in a password manager and rotate it
  with `npx wrangler secret put GOLF_EXPORT_KEY` from the `website` directory.
- **`ANTHROPIC_API_KEY` expires 2026-09-30 23:00**, twelve days after the
  event. Nothing alerts on it; the probe fails open, so the symptom is silence.

## Decisions worth not relitigating

- **Two prizes, two mechanisms, both stated on the form.** Tidal rangefinder is
  a random draw; Hyphos Pro V1s goes to the best answer, judged. Picking a
  winner on merit after calling it a draw was rejected: these are people he sees
  at church on Sundays.
- **The judged winner is chosen at `/golf/judge` on the presentation device.**
  The choice is stored only on that device and the live deck sends you back to
  the judge page if this step was skipped. Answer length never silently chooses
  the winner. **Judge on the laptop that will run the projector**, not a phone.
  Every answer is eligible, not only ones with a follow-up: the follow-up is
  optional and fails open, so requiring it excluded people who never saw one.
  `/golf/judge?demo=1` saves to a separate key, so rehearsing never replaces the
  real pick.
- **The course roster never ships to the browser.** `src/data/roster.json` is
  the church's full team sheet. Only the worker imports it: players type their
  name and the worker matches it to the roster spelling and team. Any page that
  imports it publishes the whole list to anyone with the link.
- **Prize draw: R marks the winner absent for the rest of the night** and moves
  straight to the next person for that prize. Nobody wins twice across any
  prize, contest prizes included, matched by name. Reset from setup clears it.
- **Dinner run order:** sign in at `/golf/enter` on the dinner laptop, judge at
  `/golf/judge` on that same laptop, open `/golf/prizes`, paste both lists, tick
  score winners, **Load contest entries**, Start. Put the contest prizes early in
  the list so their winners are still in the room. Loading closes the contests:
  anything posted after the load is not in the draw.
- **The pitch lives in the footer only**, small, matching the hole signage. The
  big header line and the "What Hyphos does" slide were removed.
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
4. **Write the "10 ways" piece** or approve the draft, now at `hyphos.io/field-notes/ten-ways-small-businesses-use-ai/`; four open questions
   on it (naming the funeral group, the "Okotoks & Calgary" line, the 45-minute
   offer wording, and the CTA target).
5. **Headshot** for the hole sign, currently a placeholder.
6. **Confirm the Hyphos prize** is the Pro V1s.
7. Ask Laird for the rangefinder and tell him plainly that the ten-second credit
   from the mic is worth more than any logo he could buy.

## After the event

Unset `GOLF_EXPORT_KEY`, remove the public `POST /api/golf/entry` route, and log
two numbers for next year: entries collected, and how many were owners.
