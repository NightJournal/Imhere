// ---------------------------------------------------------------
// Service worker: makes the app open instantly and survive a weak
// signal. Bump CACHE_VERSION whenever you change any file below,
// otherwise browsers keep serving the old copy.
// ---------------------------------------------------------------
const CACHE_VERSION = "imhere-v54";

const SHELL = [
  "./assets/postcard-world-original.png", "./assets/watercolor-world.png", "./assets/watercolor-paper.png", "./assets/watercolor-stand-logo.png", "./assets/peach-blossoms.png",
  "./", "./index.html", "./app.css", "./manifest.webmanifest",
  "./vendor/supabase.js", "./vendor/globe.gl.min.js",
  "./js/app.js", "./js/live.js", "./js/passcode.js", "./js/privacy.js", "./js/cropper.js", "./js/screens/groups.js", "./js/welcome-tour.js", "./js/config.js", "./js/db.js", "./js/geo.js", "./js/ui.js", "./js/outbox.js",
  "./js/world-art.js", "./js/globe.js", "./js/postcard.js",
  "./js/screens/auth.js", "./js/screens/earth.js", "./js/screens/checkin.js",
  "./js/screens/plans.js", "./js/screens/circle.js", "./js/screens/posters.js",
  "./data/countries-50m.json",
  "./data/styles/styles.json",
  "./data/styles/field-notes.txt", "./data/styles/field-notes-reference.png",
  "./data/styles/editorial.txt", "./data/styles/editorial-reference.png",
  "./data/styles/watercolor.txt", "./data/styles/watercolor-reference.png",
  "./fonts/fonts.css", "./fonts/caveat-variable.ttf", "./fonts/cormorant-garamond-italic.ttf",
  "./fonts/fredoka-latin-500-normal.woff2",
  "./fonts/fredoka-latin-ext-500-normal.woff2",
  "./fonts/nunito-latin-400-normal.woff2",
  "./fonts/nunito-latin-600-normal.woff2",
  "./fonts/nunito-latin-700-normal.woff2",
  "./fonts/nunito-latin-ext-400-normal.woff2",
  "./fonts/nunito-latin-ext-600-normal.woff2",
  "./fonts/nunito-latin-ext-700-normal.woff2",
  "./fonts/nunito-vietnamese-400-normal.woff2",
  "./fonts/nunito-vietnamese-600-normal.woff2",
  "./fonts/nunito-vietnamese-700-normal.woff2",
  "./icons/globe-logo.svg", "./icons/sprig.svg",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll fails the whole install if one file 404s, so add them one by one.
      // cache: "reload" skips Chrome's own HTTP cache — otherwise a new version
      // could be filled with stale copies of the old files.
      .then((cache) => Promise.all(SHELL.map((url) =>
        fetch(url, { cache: "reload" })
          .then((response) => response.ok ? cache.put(url, response) : null)
          .catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      // Also clears the old map-tile cache ("sr-tiles-v1"): the globe uses
      // vector data now, so no tiles are needed.
      keys.filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never cache the database or the geocoder — stale answers are worse
  // than no answer for "where is this person right now".
  if (url.hostname.includes("supabase") || url.hostname.includes("photon") ||
      url.hostname.includes("nominatim")) return;

  // Our own files: NETWORK first, so a new version shows up on the next
  // reload; the saved copy is only the fallback for no/very weak signal.
  // (Cache-first used to pin people to an old version indefinitely.)
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000));
        const response = await Promise.race([fetch(request, { cache: "no-cache" }), timeout]);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        const hit = await caches.match(request);
        return hit || Response.error();
      }
    })());
  }
});
