// ---------------------------------------------------------------
// Outbox — check-ins made with no signal wait here and send
// themselves when the connection comes back.
//
// Why IndexedDB and not localStorage: a check-in can carry a photo,
// and only IndexedDB can store a Blob.
//
// Honesty rules (spec §2):
//   * created_at is the moment you pressed "Check in", not the moment
//     it finally reached the server — your circle sees the real time.
//   * each check-in gets its id on the phone, so a retry after a lost
//     response can never create a duplicate (insert is an upsert on id).
//   * only the NEWEST waiting check-in keeps its photo: there is one
//     photo slot per user, so older waiting photos would just be
//     overwritten and their rows would point at the wrong picture.
// ---------------------------------------------------------------
import * as data from "./db.js";
import { reverseGeocode } from "./geo.js";

const DB_NAME = "imhere-outbox";
const STORE = "checkins";
const listeners = new Set();
let flushing = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(mode, run) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    Promise.resolve(run(store)).then((value) => { result = value; });
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

const promisify = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Everything still waiting, oldest first. */
export async function pending() {
  const items = await tx("readonly", (store) => promisify(store.getAll()));
  return (items || []).sort((a, b) => a.fields.created_at.localeCompare(b.fields.created_at));
}

/** Waiting check-ins that belong to `userId` (for the sign-out warning). */
export async function pendingFor(userId) {
  return (await pending().catch(() => [])).filter((item) => item.owner === userId || !item.owner);
}

/** Sign-out: remove every waiting check-in from this device. */
export function wipe() {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

/** Subscribe to changes in the waiting list (for banners). Returns unsubscribe. */
export function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

async function notify() {
  const items = await pending().catch(() => []);
  listeners.forEach((callback) => { try { callback(items); } catch {} });
}

/**
 * Put a check-in in the outbox. Always succeeds offline.
 * fields: same shape as data.addCheckIn(); photoBlob optional.
 * needsName: true when the place label is only coordinates (made
 * offline with GPS) — the real name is looked up when it sends.
 */
export async function enqueue(fields, photoBlob = null, { needsName = false, groupId = null } = {}) {
  const owner = (await data.currentUser())?.id ?? null;
  const item = {
    owner,
    groupId,
    id: crypto.randomUUID(),
    fields: { ...fields, created_at: new Date().toISOString() },
    photoBlob,
    needsName,
    tries: 0,
    lastError: null,
  };
  item.fields.id = item.id;
  await tx("readwrite", (store) => store.put(item));
  await notify();
  return item;
}

export async function discard(id) {
  await tx("readwrite", (store) => store.delete(id));
  await notify();
}

/** Network trouble (retry later) vs a real refusal (show the user). */
export function isNetworkError(error) {
  if (!navigator.onLine) return true;
  const text = String(error?.message || error || "");
  return /Failed to fetch|NetworkError|Load failed|network|timeout|ERR_INTERNET|fetch/i.test(text);
}

/**
 * Try to send everything. Safe to call as often as you like — only one
 * flush runs at a time. Returns { sent, left }.
 */
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    try {
      if (!navigator.onLine) return { sent, left: (await pending()).length };
      // Only ever send the signed-in person's own check-ins. (Items from
      // another account on a shared device are left alone, never sent.)
      const me = (await data.currentUser())?.id;
      const items = (await pending()).filter((item) => item.owner === me || !item.owner);   // no owner = saved before this check existed
      if (!items.length) return { sent, left: 0 };

      // Only the newest waiting item that has a photo gets to upload it.
      const newestWithPhoto = [...items].reverse().find((item) => item.photoBlob)?.id;

      for (const item of items) {
        try {
          if (item.needsName) {
            const place = await reverseGeocode(item.fields.latitude, item.fields.longitude);
            if (place) {
              item.fields.place_name = place.label;
              item.fields.country_code = place.countryCode ?? item.fields.country_code ?? null;
            }
          }
          let photoPath = null;
          if (item.photoBlob && item.id === newestWithPhoto) {
            photoPath = await data.uploadPhoto(item.photoBlob);
          }
          await data.addCheckIn({ ...item.fields, photo_path: photoPath });
          // "Check in for the group": copy it to the members who allow it.
          // Safe to retry (the server makes at most one copy per person).
          if (item.groupId) {
            try { await data.shareCheckinWithGroup(item.id, item.groupId); }
            catch (error) { if (isNetworkError(error)) throw error; /* group ended or left: just your own */ }
          }
          await tx("readwrite", (store) => store.delete(item.id));
          sent++;
        } catch (error) {
          item.tries += 1;
          item.lastError = isNetworkError(error) ? null : (error?.message || "Server refused it");
          await tx("readwrite", (store) => store.put(item));
          if (isNetworkError(error)) break;   // signal dropped again — stop, retry later
        }
      }
      return { sent, left: (await pending()).length };
    } finally {
      flushing = null;
      await notify();
    }
  })();
  return flushing;
}

/** Call once at startup: retries on reconnect, on return to the app, and every minute. */
export function startAutoFlush(onSent = () => {}) {
  const attempt = async () => {
    const { sent } = await flush().catch(() => ({ sent: 0 }));
    if (sent) onSent(sent);
  };
  window.addEventListener("online", attempt);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") attempt();
  });
  setInterval(attempt, 60_000);
  attempt();
}
