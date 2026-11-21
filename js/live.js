// ---------------------------------------------------------------
// Live location — two OPTIONAL ways to keep your circle up to date
// without a check-in. Neither is a check-in: they only say where the
// phone was, they're labelled "automatic", and no passcode is asked.
//
//  A. Share when I open Imhere — each time the app comes to the front
//     (at most every 10 min) it sends one "last seen" point. The new
//     point replaces the old one on the server: no history is kept.
//  B. Live sharing — for a chosen time (max 24 h) the app sends a point
//     every couple of minutes while it's OPEN ON SCREEN. Your circle
//     sees the trail. Stop it and the trail is deleted.
//
// Honest limit: a website can't read GPS while it's closed or the
// screen is locked. Live sharing pauses then; the circle sees the time
// of the last point. Points made with no signal wait on the device and
// go when the signal is back (while the app is open).
// ---------------------------------------------------------------
import * as data from "./db.js";
import { el, toast } from "./ui.js";
import { isNetworkError } from "./outbox.js";

const OPEN_EVERY_MS = 10 * 60_000;
const LIVE_EVERY_MS = 2 * 60_000;
const LIVE_MOVE_M = 150;
const QUEUE_CAP = 600;

let userId = null;
let watchId = null;
let wakeLock = null;
let lastLive = null;          // { at, lat, lon }
let endTimer = null;
const listeners = new Set();

const K = {
  open:  () => `imhere.liveOpen.${userId}`,
  lastOpen: () => `imhere.liveOpenAt.${userId}`,
  session: () => `imhere.liveSession.${userId}`,
  queue: () => `imhere.liveQueue.${userId}`,
  screen: () => `imhere.liveScreen.${userId}`,
};
const read = (key, fallback = null) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export function onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); }
const notify = () => listeners.forEach((callback) => { try { callback(status()); } catch {} });

// ============================================================ settings

export function shareOnOpenEnabled() { return Boolean(userId && read(K.open(), false)); }
export function keepScreenOn() { return read(K.screen(), true); }
export function setKeepScreenOn(on) { write(K.screen(), Boolean(on)); if (session()) on ? lockScreen() : releaseScreen(); }

export async function setShareOnOpen(on) {
  write(K.open(), Boolean(on));
  if (on) { localStorage.removeItem(K.lastOpen()); await shareNow(); }
  else {
    // Turning it off also removes the last-seen point the circle can see.
    write(K.queue(), queue().filter((item) => item.kind !== "open"));
    try { await data.deleteLastSeen(); }
    catch { toast("Turned off. Your last-seen point will be removed when you're back online."); write(`imhere.liveClearOpen.${userId}`, true); }
  }
  notify();
}

// ============================================================ queue (offline-safe)

const queue = () => read(K.queue(), []);
function push(item) {
  let items = queue();
  if (item.kind === "open") items = items.filter((i) => i.kind !== "open");   // only the newest matters
  items.push(item);
  if (items.length > QUEUE_CAP) items = items.slice(-QUEUE_CAP);
  write(K.queue(), items);
}

let flushing = null;
let flushAgain = false;     // something was queued while a flush was running
export function flush() {
  if (flushing) { flushAgain = true; return flushing; }
  if (!userId || !navigator.onLine) return flushing;
  // Note: reset `flushing` in .finally() (runs after this assignment),
  // not inside the async body, which can finish synchronously.
  flushing = (async () => {
    try {
      if (read(`imhere.liveClearOpen.${userId}`, false)) {
        await data.deleteLastSeen();
        localStorage.removeItem(`imhere.liveClearOpen.${userId}`);
      }
      const items = queue();
      if (!items.length) return;
      const sessions = items.filter((i) => i.kind === "session");
      for (const { kind, ...s } of sessions) await data.startLiveSession(s);
      const stops = items.filter((i) => i.kind === "stop");
      for (const s of stops) await data.stopLiveSession(s.id);
      const stopped = new Set(stops.map((s) => s.id));
      const points = items.filter((i) => i.kind === "open" || i.kind === "live")
        .filter((p) => !p.session_id || !stopped.has(p.session_id))
        .map(({ kind, ...p }) => ({ ...p, source: kind }));
      if (points.length) {
        try { await data.addLivePoints(points); }
        catch (error) {
          // A session that already ended is refused by the server: drop
          // those points rather than retrying forever. Network trouble: retry later.
          if (isNetworkError(error)) throw error;
          const keep = points.filter((p) => !p.session_id);
          if (keep.length) await data.addLivePoints(keep);
        }
      }
      write(K.queue(), queue().filter((i) => !items.some((done) => done.id === i.id)));
    } catch (error) {
      console.warn("Live location will retry:", error?.message || error);
    }
  })().finally(() => {
    flushing = null;
    notify();
    if (flushAgain) { flushAgain = false; flush(); }
  });
  return flushing;
}

// ============================================================ A. share when opened

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This browser can't share location.")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

export async function shareNow() {
  if (!shareOnOpenEnabled()) return;
  const last = read(K.lastOpen(), 0);
  if (Date.now() - last < OPEN_EVERY_MS) return;
  try {
    const position = await getPosition();
    write(K.lastOpen(), Date.now());
    push({ kind: "open", id: crypto.randomUUID(), latitude: position.coords.latitude,
           longitude: position.coords.longitude, accuracy_m: Math.round(position.coords.accuracy),
           recorded_at: new Date(position.timestamp || Date.now()).toISOString() });
    await flush();
  } catch (error) {
    if (error?.code === 1) toast("Imhere can't see your location. Allow it in your browser settings, or turn off sharing in You.");
  }
}

// ============================================================ B. live sharing

export function session() {
  const s = userId ? read(K.session()) : null;
  if (s && new Date(s.ends_at).getTime() <= Date.now()) { endLocal(); return null; }
  return s;
}

export function status() {
  return { shareOnOpen: shareOnOpenEnabled(), session: session(), waiting: userId ? queue().length : 0,
           lastPointAt: lastLive?.at || null };
}

const metres = (a, b) => {
  const rad = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function onPosition(position) {
  const s = session();
  if (!s) { stopWatching(); return; }
  const here = { lat: position.coords.latitude, lon: position.coords.longitude, at: Date.now() };
  const due = !lastLive || here.at - lastLive.at >= LIVE_EVERY_MS || metres(lastLive, here) >= LIVE_MOVE_M;
  if (!due) return;
  lastLive = here;
  push({ kind: "live", id: crypto.randomUUID(), session_id: s.id, latitude: here.lat, longitude: here.lon,
         accuracy_m: Math.round(position.coords.accuracy), recorded_at: new Date(position.timestamp || here.at).toISOString() });
  flush();
  notify();
}

function startWatching() {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(onPosition, (error) => {
    if (error.code === 1) { toast("Live sharing needs location permission. Allow it in your browser settings.", "error"); }
  }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 });
  if (keepScreenOn()) lockScreen();
}
function stopWatching() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  releaseScreen();
}

async function lockScreen() {
  try { if ("wakeLock" in navigator && document.visibilityState === "visible" && !wakeLock) {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } } catch { /* not supported or refused: fine */ }
}
function releaseScreen() { try { wakeLock?.release(); } catch {} wakeLock = null; }

function scheduleEnd(s) {
  clearTimeout(endTimer);
  endTimer = setTimeout(() => { endLocal(); toast("Live sharing ended"); notify(); },
    Math.max(0, new Date(s.ends_at).getTime() - Date.now()));
}

function endLocal() {
  localStorage.removeItem(K.session());
  clearTimeout(endTimer);
  stopWatching();
  lastLive = null;
}

/** Start live sharing for `hours` (1–24). Works offline: it starts when the signal is back. */
export async function startLive(hours) {
  const now = new Date();
  const s = { id: crypto.randomUUID(), started_at: now.toISOString(),
              ends_at: new Date(now.getTime() + Math.min(24, Math.max(1, hours)) * 3600_000 - 1000).toISOString() };
  write(K.session(), s);
  push({ kind: "session", ...s });
  lastLive = null;
  startWatching();
  scheduleEnd(s);
  notify();
  await flush();
}

/** Stop now. The trail is deleted from the server (or as soon as there's signal). */
export async function stopLive() {
  const s = read(K.session());
  endLocal();
  if (s) {
    write(K.queue(), queue().filter((i) => i.session_id !== s.id && !(i.kind === "session" && i.id === s.id)));
    push({ kind: "stop", id: s.id });
    await flush();
  }
  notify();
}

// ============================================================ banner

function banner() {
  let bar = document.getElementById("liveBanner");
  if (!bar) {
    bar = el("div", { id: "liveBanner", class: "live-banner hidden", role: "status" });
    document.body.append(bar);
  }
  const s = session();
  if (!s) { bar.classList.add("hidden"); return; }
  const until = new Date(s.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const stop = el("button", { type: "button", class: "live-stop" }, "Stop");
  stop.onclick = async () => { await stopLive(); toast("Live sharing stopped. Your trail was removed.", "ok"); };
  bar.replaceChildren(el("span", { class: "live-dot", "aria-hidden": "true" }),
    el("span", {}, `Live until ${until}`), stop);
  bar.classList.remove("hidden");
}

// ============================================================ lifecycle

/** Call after sign-in. */
export function start(id) {
  userId = id;
  onChange(banner);
  const s = session();
  if (s) { startWatching(); scheduleEnd(s); }
  banner();
  flush();
  shareNow();
  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    flush();
    shareNow();
    if (session()) { if (keepScreenOn()) lockScreen(); }
  });
  setInterval(() => flush(), 60_000);
}

/** Call before sign-out: stop sharing and remove what the circle can see. */
export async function signOutCleanup() {
  try {
    const s = read(K.session());
    endLocal();
    if (navigator.onLine) {
      if (s) await data.stopLiveSession(s.id).catch(() => {});
      await data.deleteLastSeen().catch(() => {});
    }
  } finally {
    for (const key of Object.keys(localStorage)) if (key.startsWith("imhere.live")) localStorage.removeItem(key);
    userId = null;
  }
}

export default { start, flush };
