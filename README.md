# Imhere — web app

The whole app in a browser: check in, keep a trip, share plans, run your circle.

## First run (once)

```sh
cd web
sh fetch-vendor.sh          # downloads globe.gl + supabase-js into vendor/
python3 -m http.server 8000 # any static server will do
```

Then open <http://localhost:8000>.

Two things must be true or half the app silently fails:

* **Open it over `http://localhost` or `https://`, never by double-clicking the
  file.** ES modules, the service worker and the browser's location permission
  all refuse to run from `file://`.
* **`vendor/` must contain `globe.gl.min.js` and `supabase.js`.** The app tells
  you if supabase-js is missing; the globe says so if globe.gl is.

## Files

| File | What it does |
|---|---|
| `index.html` | The shell: sidebar (desktop), top bar, screen container, bottom bar (phone) |
| `app.css` | The only stylesheet |
| `js/config.js` | Server URL, key, geocoder choice — change things here first |
| `js/globe.js` | The watercolour globe on My Earth and the friend view (globe.gl) |
| `js/postcard.js` | Draws the keepsake postcard (9:16 story, 3:2 landscape) |
| `data/countries-50m.json` | Country shapes (Natural Earth 1:50m, public domain) for the globe and postcard |
| `fonts/` | Fredoka (headings) + Nunito (text), SIL Open Font License |
| `icons/globe-logo.svg`, `icons/sprig.svg` | Hand-made watercolour logo and leaf sprig |
| `js/db.js` | Every call to Supabase. Swap this file if the backend moves |
| `js/geo.js` | Place search, reverse geocoding, the autocomplete field |
| `js/ui.js` | Element helpers, toasts, sheets, formatting |
| `js/app.js` | Boot, the router, the account sheet (name, profile photo, sign out) |
| `js/screens/*.js` | One file per tab |
| `sw.js` | Offline caching. **Bump `CACHE_VERSION` after every change** |

## Deploying to hhanley.site

It's static files — copy the `web` folder to the server and point the domain at
it. HTTPS is not optional: without it the browser refuses to give the page a
location, and the app can't be installed to a home screen.

## Poster styles

`data/styles/` holds one folder-worth of styles: a picture, a prompt and a
line in `styles.json` each. The app shows them as a picker; you copy a
prompt, run it in whatever AI app you use, and upload the result. Adding a
style needs no code — see `data/styles/README.md`.

A style either makes the whole poster (`"composite": false`) or just the
illustration, with the app drawing the paper and the caption
(`"composite": true`). Both are shipped as worked examples.

## Not built yet

* Postcard export (the Canvas port of `Postcard.swift` / `CountryMap.swift`)
* Offline check-in queue (writes currently need a connection)
* Passkey lock (the web equivalent of the Face ID gate)

## Field-notes posters (optional, costs money)

An image model turns a check-in photo into a hand-carved rubber stamp; the
app draws the poster around it. Off by default — nothing happens until you
deploy the function and set a key.

**The split.** The model draws only the stamp. The 9:16 sheet, the empty
upper 60%, the stamp's position and the caption are drawn in `js/poster.js`
from the check-in record. Composition and small text are what image models
get wrong; both are free and exact in code, and the place name comes from
your own data instead of the model guessing at the photo.

### Setup

1. Run `server/slice-d1.sql` in Studio → SQL Editor (posters table, daily cap).
2. Studio → Storage → create a **private** bucket named `posters`, then run
   the two policies quoted at the bottom of `slice-d1.sql`.
3. Deploy the function and set the key:

```sh
supabase functions deploy generate-stamp        # from server/functions/
supabase secrets set IMAGE_PROVIDER=gemini GEMINI_API_KEY=...
# or: IMAGE_PROVIDER=openai OPENAI_API_KEY=...
supabase secrets set DAILY_IMAGE_CAP=10
```

**Never put the key in `js/config.js`.** Anything in the page is readable by
anyone who opens the site, and they can spend it.

### Cost (checked 2026-09-02 — verify before you commit)

| Model | Per image |
|---|---|
| Gemini 3.1 Flash Image | $0.067 (1K) |
| Gemini 3.1 Flash Lite Image | $0.034 (1K) |
| Gemini 3 Pro Image | $0.134 (1K/2K) |
| OpenAI `gpt-image-2` | priced per token, not per image |

Model names are env vars (`GEMINI_IMAGE_MODEL`, `OPENAI_IMAGE_MODEL`) because
they change often. `DAILY_IMAGE_CAP` is enforced in the database by
`claim_generation()` before the model is called, so a loop or a shared link
can't run up a bill.

### Two things to know

* **The photo leaves your circle.** It goes to Google or OpenAI under their
  retention policy. That contradicts the "no third-party platforms"
  decision — decide it deliberately.
* **Only the newest check-in with a photo can make a poster.** Photos are
  ephemeral (one per user at `<user-id>.jpg`, overwritten each upload), so an
  older check-in's `photo_path` now points at today's picture. The button is
  disabled for anything else. Fixing that means photos stop being ephemeral.
