// ---------------------------------------------------------------
// Small helpers used by every screen. No framework, no build step.
// ---------------------------------------------------------------

/** document.getElementById, shorter. */
export const $ = (id) => document.getElementById(id);

/** Make an element: el("div", { class: "card" }, "text", childNode) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace everything inside a container. */
export function fill(container, ...children) {
  container.replaceChildren(...children.flat().filter(Boolean));
}

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** "just now" / "12 min ago" / "3 days ago" */
export function staleness(isoString) {
  if (!isoString) return "";
  const seconds = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " h ago";
  const days = Math.floor(seconds / 86400);
  return days === 1 ? "yesterday" : days + " days ago";
}

export function hoursSince(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / 3600000;
}

export const TRANSPORT = {
  flight: "✈️", train: "🚆", bus: "🚌",
  ferry: "⛴️", car: "🚗",
};

/** ISO country code -> flag emoji. "hk" -> flag. */
/**
 * Flag for a place code. Codes are either a two-letter country/region
 * ("th", "hk", "tw") or a UK nation ("gb-eng", "gb-sct", "gb-wls"),
 * which use Unicode's subdivision flags 🏴󠁧󠁢󠁳󠁣󠁴󠁿.
 */
export function flagEmoji(code) {
  if (!code) return "";
  const lower = code.toLowerCase();
  if (SUBDIVISION_FLAGS.has(lower)) {
    // Black flag + the letters as invisible "tag" characters + a cancel tag.
    const tags = [...lower.replace("-", "")].map((ch) => 0xe0000 + ch.charCodeAt(0));
    return String.fromCodePoint(0x1f3f4, ...tags, 0xe007f);
  }
  const country = lower.split("-")[0];
  if (country.length !== 2) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + country.toUpperCase().charCodeAt(0) - 65,
    base + country.toUpperCase().charCodeAt(1) - 65
  );
}
const SUBDIVISION_FLAGS = new Set(["gb-eng", "gb-sct", "gb-wls"]);

/** The country whose map shape a place belongs to: "gb-sct" → "GB". */
export function mapCountry(code) {
  return (code || "").split("-")[0].toUpperCase();
}

/** Display names that read better than the browser's defaults. */
export const PLACE_NAMES = {
  "HK": "Hong Kong", "MO": "Macau", "TW": "Taiwan",
  "GB-ENG": "England", "GB-SCT": "Scotland", "GB-WLS": "Wales",
};

/** "Taipei, Taiwan" -> "Taipei" */
export function cityOnly(name) {
  return String(name ?? "").split(",")[0].trim();
}

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Brief message at the bottom of the screen. */
let toastTimer = null;
export function toast(message, kind = "info") {
  const box = $("toast");
  if (!box) return;
  box.textContent = message;
  box.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = "toast"), 3200);
}

/** Wrap an async action so errors always surface instead of vanishing. */
export async function guard(action, whileWorking) {
  try {
    return await action();
  } catch (error) {
    console.error(error);
    toast(error?.message || "Something went wrong", "error");
    return null;
  } finally {
    if (whileWorking) whileWorking(false);
  }
}

export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
export const localTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// ---------------------------------------------------------------
// Icons — drawn, one stroke weight, no emoji standing in for UI.
// ---------------------------------------------------------------
const ICONS = {
  earth: '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  plans: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  circle: '<circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="10" r="2.4"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15 15c2.6-.4 4.6.9 5.2 3.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  signal: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 15l5-4 4 3 3-2 6 4"/>',
  sparkle: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  flag: '<path d="M5 21V4M5 4c4-2 7 2 11 0v9c-4 2-7-2-11 0"/>',
  story: '<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5zM12 6v13"/>',
  landscape: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  stars: '<path d="M10 3c.6 3.6 1.4 4.4 5 5-3.6.6-4.4 1.4-5 5-.6-3.6-1.4-4.4-5-5 3.6-.6 4.4-1.4 5-5zM18 13c.3 2 .8 2.5 3 3-2.2.5-2.7 1-3 3-.3-2-.8-2.5-3-3 2.2-.5 2.7-1 3-3z"/>',
};
/** <svg> for a named icon. */
export function icon(name, label = "") {
  const svg = `<svg class="icon" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${escapeHTML(label)}"` : 'aria-hidden="true"'}>${ICONS[name] || ""}</svg>`;
  const holder = document.createElement("span");
  holder.innerHTML = svg;
  return holder.firstElementChild;
}

/** A tiny hand-drawn sparkle (decoration only). */
export function sparkle(extraClass = "") {
  const holder = document.createElement("span");
  holder.innerHTML = `<svg class="sparkle ${extraClass}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.9 6.2 2.3 7.6 8.5 8.5-6.2.9-7.6 2.3-8.5 8.5-.9-6.2-2.3-7.6-8.5-8.5 6.2-.9 7.6-2.3 8.5-8.5z"/></svg>`;
  return holder.firstElementChild;
}

/** Two letters for someone without a profile picture. */
export function initials(name) {
  const letters = String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("");
  return (letters || "?").slice(0, 2).toUpperCase();
}

/** Round avatar: the picture if there is one, initials otherwise. */
export function avatarElement(name, url, size = "") {
  const box = el("span", { class: "avatar" + (size ? " " + size : ""), "aria-hidden": "true" });
  if (url) box.append(el("img", { src: url, alt: "" }));
  else box.textContent = initials(name);
  return box;
}

// ---------------------------------------------------------------
// Sheets: slide up from the bottom on a phone, a panel on the right
// on a desktop (app.css decides). Escape and the backdrop close them.
// ---------------------------------------------------------------
let sheetOnClose = null;
let sheetOpener = null;
export function openSheet(title, ...content) {
  const backdrop = $("sheet"), body = $("sheetBody");
  const close = el("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("close"));
  close.onclick = closeSheet;
  sheetOpener = document.activeElement;
  fill(body,
    el("div", { class: "sheet-grip", "aria-hidden": "true" }),
    el("div", { class: "sheet-head" }, el("h2", { id: "sheetTitle" }, title), close),
    ...content
  );
  body.setAttribute("role", "dialog");
  body.setAttribute("aria-modal", "true");
  body.setAttribute("aria-labelledby", "sheetTitle");
  backdrop.classList.remove("hidden");
  backdrop.onclick = (event) => { if (event.target === backdrop) closeSheet(); };
  body.scrollTop = 0;
  setTimeout(() => close.focus({ preventScroll: true }), 30);
  return body;
}

/** Put the open sheet aside so another can open on top of it. Returns a
 *  function that brings it back exactly as it was, or null if none was open. */
export function stashSheet() {
  const backdrop = $("sheet"), body = $("sheetBody");
  if (backdrop.classList.contains("hidden") || !body.childNodes.length) return null;
  const nodes = [...body.childNodes], scroll = body.scrollTop;
  const onClose = sheetOnClose, opener = sheetOpener;
  sheetOnClose = null;
  return () => {
    body.replaceChildren(...nodes);
    sheetOnClose = onClose; sheetOpener = opener;
    backdrop.classList.remove("hidden");
    body.scrollTop = scroll;
  };
}

/** Run something once when the current sheet closes. */
export function onSheetClose(callback) { sheetOnClose = callback; }

export function closeSheet() {
  $("sheet").classList.add("hidden");
  $("sheetBody").replaceChildren();
  const callback = sheetOnClose;
  sheetOnClose = null;
  if (callback) callback();
  sheetOpener?.focus?.({ preventScroll: true });
  sheetOpener = null;
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("sheet")?.classList.contains("hidden")) closeSheet();
});

/** Yes/no confirmation inside a sheet. Resolves to true/false. */
export function confirmSheet(title, message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    const yes = el("button", { class: "danger" }, confirmLabel);
    const no = el("button", { class: "ghost", style: "margin-top:8px" }, "Cancel");
    yes.onclick = () => { closeSheet(); resolve(true); };
    no.onclick = () => { closeSheet(); resolve(false); };
    openSheet(title, el("p", { class: "dim", style: "margin-bottom:14px" }, message), yes, no);
  });
}
