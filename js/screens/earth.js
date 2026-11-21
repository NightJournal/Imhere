// ---------------------------------------------------------------
// My Earth — the globe, my current trip, keepsakes, my check-in history.
//
// Phone: globe on the top ~58% of the screen, everything else scrolls
// below it. Desktop: the globe is a fixed pane on the left and this
// column scrolls on the right (app.css).
// ---------------------------------------------------------------
import { el, fill, staleness, cityOnly, flagEmoji, TRANSPORT, icon, sparkle, mapCountry,
         haversineKm, toast, openSheet, closeSheet, confirmSheet } from "../ui.js";
import * as data from "../db.js";
import { placeField, reverseGeocode } from "../geo.js";
import { app, setSubtitle, refreshProfile, go } from "../app.js";
import { loadCountries, ensureFonts, makePostcard, canvasToBlob, defaultTitle } from "../postcard.js";
import { openPosterSheet, postersCard } from "./posters.js";
import { mountGlobe } from "../globe.js";
import { isNetworkError } from "../outbox.js";

// The last thing My Earth showed, kept on the device so the globe still
// works with no signal (on a plane, after a reload).
const CACHE_KEY = "imhere.earth";
async function loadEarth() {
  try {
    const [checkIns, origins] = await Promise.all([data.myCheckIns(), data.myTripOrigins()]);
    await refreshProfile();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ checkIns, origins, at: Date.now() })); } catch { /* full or private */ }
    return { checkIns, origins, offline: false };
  } catch (error) {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && (!navigator.onLine || isNetworkError(error))) {
      return { checkIns: cached.checkIns, origins: cached.origins, offline: true, at: cached.at };
    }
    throw error;
  }
}

// The globe is kept between visits to My Earth, so it doesn't reload and
// new pins can "bloom" in.
let globe = null;
let globePane = null;

/** "Start a trip" — asks where you're setting off from. */
function startTripSheet(onDone) {
  let chosen = null;
  const field = placeField({
    placeholder: "Where are you setting off from?",
    onResolve: (place) => { chosen = place; begin.disabled = !place; },
  });
  const departure = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  const begin = el("button", { class: "primary", disabled: "disabled" }, "Start trip");

  begin.onclick = async () => {
    if (!chosen) return;
    begin.disabled = true;
    try {
      await data.startTrip({
        name: chosen.label,
        latitude: chosen.lat, longitude: chosen.lon,
        country_code: chosen.countryCode,
        departure_at: new Date(departure.value + "T00:00:00").toISOString(),
      });
      await refreshProfile();
      closeSheet();
      toast("Trip started. Check in whenever you move.", "ok");
      onDone();
    } catch (error) { toast(error.message, "error"); begin.disabled = false; }
  };

  openSheet("Start a trip",
    el("p", { class: "lede", style: "margin-bottom:var(--s4)" },
      "Everything you check into from now on belongs to this trip. Your circle always sees the current trip; older trips need your permission."),
    el("div", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Starting point"), field.element),
      el("label", { class: "field" }, el("span", { class: "label" }, "Departure date"), departure),
      begin));
}

/** Group check-ins into trips (newest first) for the postcard picker. */
function tripsFrom(checkIns, origins, currentID) {
  const trips = new Map();
  for (const checkIn of checkIns) {                 // newest first
    const key = checkIn.trip_id || "none";
    if (!trips.has(key)) trips.set(key, { id: checkIn.trip_id || null, checkIns: [] });
    trips.get(key).checkIns.push(checkIn);
  }
  const format = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return [...trips.values()].map((trip) => {
    const origin = origins.find((o) => o.trip_id === trip.id) || null;
    const oldest = trip.checkIns[trip.checkIns.length - 1];
    const label = trip.id === null
      ? "Check-ins outside a trip"
      : `${trip.id === currentID ? "Current trip" : "Trip"} from ${cityOnly(origin?.name || oldest.place_name)}, ${format(origin?.departure_at || oldest.created_at)}`;
    return { ...trip, origin, label };
  });
}

function tripCard(profile, origins, checkIns, reload) {
  const currentID = profile?.current_trip_id;
  if (!currentID) {
    const start = el("button", { class: "primary" }, "Start a trip");
    start.onclick = () => startTripSheet(reload);
    const postcard = checkIns.length ? el("button", { class: "secondary postcard-button-wide" }, icon("card"), "Make a postcard") : null;
    if (postcard) postcard.onclick = () => postcardSheet(checkIns, origins, checkIns[0]?.trip_id ?? null);
    return el("section", { class: "card" },
      el("h3", {}, "No trip in progress"),
      el("p", { class: "dim" },
        "Check-ins outside a trip are still saved, but a trip is what your circle follows."),
      el("div", { class: "stack", style: "margin-top:var(--s4)" }, start, postcard));
  }

  const origin = origins.find((o) => o.trip_id === currentID);
  const stops = checkIns.filter((c) => c.trip_id === currentID);
  const points = [];
  if (origin) points.push({ lat: origin.latitude, lon: origin.longitude });
  [...stops].reverse().forEach((c) => points.push({ lat: c.latitude, lon: c.longitude }));
  let travelled = 0;
  for (let i = 1; i < points.length; i++) travelled += haversineKm(points[i - 1], points[i]);
  travelled = Math.round(travelled);

  const postcard = el("button", { class: "primary postcard-button-wide" }, icon("card"), "Postcard");
  postcard.onclick = () => postcardSheet(checkIns, origins, currentID);
  const end = el("button", { class: "ghost" }, "End trip");
  end.onclick = async () => {
    const sure = await confirmSheet("End this trip?",
      "It moves into your past trips. People in your circle keep seeing it only if their Past trips switch is on and they joined before this trip started.", "End trip");
    if (!sure) return;
    try {
      await data.endCurrentTrip();
      await refreshProfile();
      toast("Trip ended", "ok");
      reload();
    } catch (error) { toast(error.message, "error"); }
  };
  const show = el("button", { class: "ghost", type: "button" }, "Show on globe");
  show.onclick = () => globe?.flyToTrip(points);

  return el("section", { class: "card" },
    el("div", { class: "rowline" },
      el("h3", { style: "margin:0" }, "Trip in progress"),
      el("span", { class: "pill live" }, `${stops.length} stop${stops.length === 1 ? "" : "s"}`)),
    el("p", { style: "margin-top:var(--s2)" },
      el("span", { class: "place" }, origin ? `From ${cityOnly(origin.name)}` : "Trip")),
    el("p", { class: "dim" },
      travelled > 0 ? `${travelled.toLocaleString("en-GB")} km travelled` : "No distance yet"),
    el("div", { class: "button-row", style: "margin-top:var(--s4)" }, postcard, end),
    points.length > 1 ? show : null);
}

// ---------------------------------------------------------------
// Postcard: pick the trip and the format, see it, save it.
// ---------------------------------------------------------------
function toggleRow(label, initial, onChange) {
  const knob = el("button", { class: "switch" + (initial ? " on" : ""), type: "button",
                              role: "switch", "aria-checked": String(initial), "aria-label": label });
  knob.onclick = () => {
    const next = !knob.classList.contains("on");
    knob.classList.toggle("on", next);
    knob.setAttribute("aria-checked", String(next));
    onChange(next);
  };
  return el("div", { class: "toggle-row" }, el("span", {}, label), knob);
}

/** On phones, hand the image to the share sheet ("Save Image" → Photos).
 *  Everywhere else, download the file. Returns how it was saved. */
async function savePostcardFile(blob, filename) {
  const file = new File([blob], filename, { type: "image/png" });
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Imhere postcard" });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // Share failed for another reason — fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

/** The keepsake editor: trip, format, preview, title, places, save, toggles.
 *  Used inline on wide screens and inside a sheet on phones. */
function keepsakeEditor(checkIns, origins, tripID) {
  const trips = tripsFrom(checkIns, origins, app.profile?.current_trip_id);
  let trip = trips.find((t) => t.id === tripID) || trips[0];
  const options = { photo: true, distance: true, dates: true, stops: true };
  let format = "keepsake";
  const preview = el("img", { class: "postcard-preview", alt: "Postcard preview" });
  const stage = el("div", { class: "postcard-stage" }, preview);
  const status = el("p", { class: "dim", role: "status", style: "text-align:center" }, "Drawing…");
  const save = el("button", { class: "primary" }, icon("share"), "Save postcard");

  // ---- which trip ----
  const picker = el("select", { "aria-label": "Trip" });
  trips.forEach((t, i) => picker.append(el("option", { value: String(i) }, t.label)));
  picker.value = String(Math.max(0, trips.indexOf(trip)));

  // ---- editable words, remembered per trip on this device ----
  const titleInput = el("input", { type: "text", maxlength: "60", "aria-label": "Postcard title" });
  const placesInput = el("input", { type: "text", maxlength: "140", "aria-label": "Places on the postcard" });
  const storeKey = () => `imhere.keepsake.${trip?.id || "none"}`;
  const stops = () => [...(trip?.checkIns || [])].reverse();
  const defaults = () => {
    const list = stops();
    const homeCity = trip?.origin ? cityOnly(trip.origin.name).toLowerCase() : null;
    const cities = [...new Set(list.map((c) => cityOnly(c.place_name)).filter((c) => c.toLowerCase() !== homeCity))];
    const codes = [...new Set(list.map((c) => (c.country_code || "").toUpperCase()).filter(Boolean))];
    return { title: defaultTitle(cities.length ? cities : [cityOnly(list[0]?.place_name || "")], codes),
             places: cities.join(" · ") };
  };
  function loadWords() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storeKey()) || "{}"); } catch { saved = {}; }
    const d = defaults();
    titleInput.placeholder = d.title;
    placesInput.placeholder = d.places;
    titleInput.value = saved.title || "";
    placesInput.value = saved.places || "";
  }
  function saveWords() {
    try { localStorage.setItem(storeKey(), JSON.stringify({ title: titleInput.value, places: placesInput.value })); } catch { /* full */ }
  }
  let typingTimer = null;
  const onType = () => { saveWords(); clearTimeout(typingTimer); typingTimer = setTimeout(draw, 350); };
  titleInput.addEventListener("input", onType);
  placesInput.addEventListener("input", onType);
  picker.onchange = () => { trip = trips[Number(picker.value)]; loadWords(); draw(); };

  // ---- which format ----
  const formats = [["keepsake", "Postcard", "landscape"], ["story", "Story", "story"], ["landscape", "Landscape", "landscape"]];
  const segmented = el("div", { class: "segmented", role: "group", "aria-label": "Format" });
  for (const [value, label, iconName] of formats) {
    const button = el("button", { type: "button", "aria-pressed": String(value === format) }, icon(iconName), label);
    button.onclick = () => {
      format = value;
      for (const other of segmented.children) other.setAttribute("aria-pressed", String(other === button));
      stage.classList.toggle("tall", format === "story");
      draw();
    };
    segmented.append(button);
  }

  let customPhoto = null;
  const photoInput = el("input", { type: "file", accept: "image/*", "aria-label": "Choose postcard photo" });
  photoInput.onchange = () => {
    const file = photoInput.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => { customPhoto = image; URL.revokeObjectURL(url); draw(); };
    image.onerror = () => { URL.revokeObjectURL(url); toast("Couldn't open that photo", "error"); };
    image.src = url;
  };
  let lastCanvas = null;
  let photoCache = { key: null, image: null };
  async function loadPhoto(list) {
    // Photos are one per person and replaced each time, so only the newest
    // check-in that had a photo still points at a real picture of its own.
    const newestWithPhoto = checkIns.find((c) => c.photo_path);
    const inTrip = newestWithPhoto && list.some((c) => c.id === newestWithPhoto.id);
    if (!inTrip) return null;
    if (photoCache.key === newestWithPhoto.id) return photoCache.image;
    const url = await data.photoURL(newestWithPhoto.photo_path);
    const image = url ? await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }) : null;
    photoCache = { key: newestWithPhoto.id, image };
    return image;
  }

  let drawing = 0;
  async function draw() {
    if (!trip) return;
    const ticket = ++drawing;
    status.textContent = "Drawing…";
    status.classList.remove("hidden");
    save.disabled = true;
    try {
      const list = stops();
      const photo = options.photo ? (customPhoto || await loadPhoto(list).catch(() => null)) : null;
      if (ticket !== drawing) return;
      lastCanvas = makePostcard({ checkIns: list, origin: trip.origin, photo, options, format,
                                  title: titleInput.value, places: placesInput.value });
      preview.src = lastCanvas.toDataURL("image/png");
      status.classList.add("hidden");
      save.disabled = false;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  save.onclick = async () => {
    if (!lastCanvas) return;
    save.disabled = true;
    const blob = await canvasToBlob(lastCanvas);
    if (!blob) { toast("Couldn't make the image file", "error"); save.disabled = false; return; }
    const name = `imhere-${format === "keepsake" ? "keepsake" : format === "story" ? "9x16" : "3x2"}-${new Date().toISOString().slice(0, 10)}.png`;
    const how = await savePostcardFile(blob, name);
    if (how === "shared") toast("Postcard ready. Choose Save Image to put it in Photos.", "ok");
    else if (how === "downloaded") toast("Postcard downloaded", "ok");
    save.disabled = false;
  };

  const element = el("div", { class: "stack keepsake" },
    el("label", { class: "field" }, el("span", { class: "label" }, "Trip"), picker),
    segmented,
    stage, status,
    el("details", { class: "keepsake-customize" },
      el("summary", {}, "Personalize your postcard"),
      el("div", { class: "keepsake-text" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Title"), titleInput),
      el("label", { class: "field" }, el("span", { class: "label" }, "Places"), placesInput),
      el("label", { class: "field" }, el("span", { class: "label" }, "Postcard photo"), photoInput))),
    save,
    el("div", {},
      toggleRow("Photo", true, (on) => { options.photo = on; draw(); }),
      toggleRow("Distance travelled", true, (on) => { options.distance = on; draw(); }),
      toggleRow("Dates", true, (on) => { options.dates = on; draw(); }),
      toggleRow("Places and flags", true, (on) => { options.stops = on; draw(); })));

  async function start() {
    if (!trip) { status.textContent = "Check in somewhere first — a postcard is drawn from your check-ins."; return; }
    try {
      await loadCountries();
      await ensureFonts();
    } catch (error) { status.textContent = error.message; return; }
    loadWords();
    await draw();
  }
  return { element, start };
}

const keepsakeHeading = () => el("span", { class: "keepsake-head" },
  "Make a little keepsake", sparkle());

async function postcardSheet(checkIns, origins, tripID) {
  if (!checkIns.length) { toast("Check in somewhere first — a postcard is drawn from your check-ins."); return; }
  const editor = keepsakeEditor(checkIns, origins, tripID);
  const body = openSheet("Make a little keepsake", editor.element);
  body.querySelector("#sheetTitle")?.append(sparkle());
  await editor.start();
}

function keepsakesCard(checkIns) {
  const poster = el("button", { class: "secondary" }, icon("sparkle"), "Make a poster");
  poster.disabled = !checkIns.length;
  poster.onclick = () => openPosterSheet(checkIns, () => go("earth"));
  return el("section", { class: "card" },
    el("h3", {}, "Posters"),
    el("p", { class: "dim" },
      "Turn a check-in photo into a poster: pick a style, copy its prompt into the AI app you already use, then upload the result."),
    el("div", { style: "margin-top:var(--s4)" }, poster));
}

function historyList(checkIns, currentTripID, reload) {
  const rows = checkIns.map((checkIn) => {
    const remove = el("button", { class: "icon-button", "aria-label": `Delete check-in at ${cityOnly(checkIn.place_name)}` }, icon("trash"));
    remove.onclick = async () => {
      const sure = await confirmSheet("Delete this check-in?", checkIn.place_name);
      if (!sure) return;
      try {
        await data.deleteCheckIn(checkIn.id);
        toast("Deleted", "ok");
        reload();
      } catch (error) { toast(error.message, "error"); }
    };
    const title = el("button", { class: "list-title", type: "button",
      style: "background:none;border:0;padding:0;cursor:pointer;text-align:left" },
      `${flagEmoji(checkIn.country_code)} ${cityOnly(checkIn.place_name)}`.trim());
    title.onclick = () => { globe?.flyTo(checkIn.latitude, checkIn.longitude); if (window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" }); };
    return el("div", { class: "list-row" },
      el("div", { class: "rowline" },
        el("div", { style: "min-width:0" },
          title,
          el("div", { class: "dim" },
            [staleness(checkIn.created_at),
             checkIn.transport_mode ? TRANSPORT[checkIn.transport_mode] : null,
             checkIn.trip_id === currentTripID ? "current trip" : null,
             checkIn.checked_in_by ? "group check-in" : null]
              .filter(Boolean).join(", ")),
          checkIn.message ? el("div", { style: "margin-top:4px" }, checkIn.message) : null),
        remove));
  });

  return el("section", { class: "card" },
    el("h3", {}, `All check-ins (${checkIns.length})`),
    rows.length ? rows : el("p", { class: "dim" }, "Nothing yet."));
}

/** The small card that opens when a pin is tapped. */
function pinDetails(pane, item) {
  pane.querySelector(".pin-card")?.remove();
  const close = el("button", { class: "icon-button", "aria-label": "Close" }, icon("close"));
  let body;
  if (item.kind === "friend") {
    const f = item.friend;
    const place = el("div", { class: "place" }, f.place ? `${flagEmoji(f.country)} ${cityOnly(f.place)}`.trim() : "Locating place…");
    if (!f.place) reverseGeocode(f.lat, f.lon).then((found) => {
      place.textContent = found ? `${flagEmoji(found.countryCode)} ${cityOnly(found.label)}`.trim() : "Shared location";
    }).catch(() => { place.textContent = "Shared location"; });
    const open = el("button", { class: "secondary", type: "button", style: "margin-top:8px;min-height:40px" }, "Open their page");
    open.onclick = () => go("circle", { openPerson: { id: f.id, display_name: f.name, avatar_path: f.avatar_path } });
    body = el("div", { style: "min-width:0" },
      el("div", { style: "font-weight:700" }, f.name),
      place,
      el("div", { class: "dim" }, `${staleness(f.at)} · ${f.source === "live" ? "sharing live" : f.source === "lastSeen" ? "last seen (automatic)" : "check-in"}`),
      open);
  } else if (item.kind === "origin") {
    body = el("div", {}, el("div", { class: "place" }, cityOnly(item.origin.name)),
      el("div", { class: "dim" }, "Where this trip started"));
  } else {
    const c = item.checkIn;
    body = el("div", { style: "min-width:0" },
      el("div", { class: "place" }, `${flagEmoji(c.country_code)} ${cityOnly(c.place_name)}`.trim()),
      el("div", { class: "dim" }, [staleness(c.created_at),
        c.transport_mode ? `${TRANSPORT[c.transport_mode]} ${c.transport_number || ""}`.trim() : null]
        .filter(Boolean).join(", ")),
      c.message ? el("p", { style: "margin-top:6px" }, c.message) : null);
  }
  const card = el("div", { class: "pin-card", role: "dialog", "aria-label": "Check-in details" },
    el("div", { class: "rowline" }, body, close));
  close.onclick = () => card.remove();
  pane.append(card);
}

function clusterList(pane, members) {
  pane.querySelector(".pin-card")?.remove();
  const close = el("button", { class: "icon-button", "aria-label": "Close" }, icon("close"));
  const card = el("div", { class: "pin-card", role: "dialog", "aria-label": "Check-ins here" },
    el("div", { class: "rowline" }, el("strong", {}, `${members.length} here`), close),
    members.filter((m) => m.checkIn || m.friend).map((m) => el("div", { class: "list-row" },
      el("div", { style: "font-weight:700" }, m.friend ? m.friend.name : cityOnly(m.checkIn.place_name)),
      el("div", { class: "dim" }, staleness(m.friend ? m.friend.at : m.checkIn.created_at)))));
  close.onclick = () => card.remove();
  pane.append(card);
}

async function ensureGlobe() {
  if (globe && globePane) return;
  globePane = el("div", { class: "globe-pane", role: "img",
    "aria-label": "Globe of your check-ins. Drag to spin, pinch or scroll to zoom." });
  globe = await mountGlobe(globePane, {
    onPinTap: (item) => { pinDetails(globePane, item); globe.flyTo(item.lat, item.lon, Math.max(0.3, globe.altitude() * 0.8)); },
    onClusterList: (members) => clusterList(globePane, members),
  });
}

/** Places, countries and trips, from the real check-ins. */
function statsRow(checkIns) {
  const places = new Set(checkIns.map((c) => cityOnly(c.place_name).toLowerCase())).size;
  const countries = new Set(checkIns.map((c) => mapCountry(c.country_code)).filter(Boolean)).size;
  const trips = new Set(checkIns.map((c) => c.trip_id).filter(Boolean)).size;
  const stat = (iconName, tone, count, one, many) => el("span", { class: "stat" },
    Object.assign(icon(iconName), {}), el("span", {}, el("strong", {}, String(count)), ` ${count === 1 ? one : many}`));
  const row = el("div", { class: "stats", role: "list", "aria-label": "Your travels so far" },
    stat("pin", "peach", places, "place", "places"),
    stat("flag", "mint", countries, "country", "countries"),
    stat("stars", "lav", trips, "lovely adventure", "lovely adventures"));
  const tones = ["peach", "mint", "lav"];
  row.querySelectorAll(".stat .icon").forEach((svg, i) => svg.classList.add(tones[i]));
  row.querySelectorAll(".stat").forEach((node) => node.setAttribute("role", "listitem"));
  return row;
}

/** Up to two recent places as small floating cards, linked to their pins. */
function memoryCards(checkIns, wrap) {
  const seen = new Set();
  const picks = [];
  for (const c of checkIns) {                       // newest first
    const key = cityOnly(c.place_name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(c);
    if (picks.length === 2) break;
  }
  const newestWithPhoto = checkIns.find((c) => c.photo_path);
  const make = (checkIn) => {
    const photo = el("span", { class: "memory-photo memory-stamp", "aria-hidden": "true" }, icon("pin"));
    if (newestWithPhoto && checkIn.id === newestWithPhoto.id) {
      data.photoURL(checkIn.photo_path).then((url) => {
        if (url) {
          const image = el("img", { class: "memory-photo", alt: "", src: url });
          image.onerror = () => image.replaceWith(photo);
          photo.replaceWith(image);
        }
      }).catch(() => {});
    } else photo.removeAttribute("src");
    const card = el("button", { class: "memory", type: "button",
      "aria-label": `${cityOnly(checkIn.place_name)}, ${staleness(checkIn.created_at)}. Show on the globe` },
      photo, el("span", { class: "memory-copy" }, el("span", { class: "memory-name" }, cityOnly(checkIn.place_name)), el("small", {}, "A little memory")));
    card.onclick = () => {
      globe?.flyTo(checkIn.latitude, checkIn.longitude, 0.6);
      pinDetails(globePane, { kind: "pin", checkIn });
      if (window.innerWidth < 720) window.scrollTo({ top: 0, behavior: "smooth" });
    };
    return card;
  };

  // Floating on the globe (tablet and up)…
  const overlay = el("div", { class: "memories" });
  const svgNS = "http://www.w3.org/2000/svg";
  const lines = document.createElementNS(svgNS, "svg");
  lines.setAttribute("class", "memory-lines");
  lines.setAttribute("aria-hidden", "true");
  overlay.append(lines);
  const placed = picks.map((checkIn, i) => {
    const card = make(checkIn);
    card.style.right = "1%";
    card.style.top = i === 0 ? "22%" : "52%";
    const path = document.createElementNS(svgNS, "path");
    lines.append(path);
    overlay.append(card);
    return { checkIn, card, path };
  });
  const update = () => {
    if (!globe || !overlay.isConnected) return;
    const box = overlay.getBoundingClientRect();
    for (const { checkIn, card, path } of placed) {
      const pin = globe.screenOf(checkIn.latitude, checkIn.longitude);
      const r = card.getBoundingClientRect();
      const x1 = r.left - box.left, y1 = r.top - box.top + r.height / 2;
      if (!pin.visible || !Number.isFinite(pin.x)) { path.setAttribute("d", ""); continue; }
      const x0 = pin.x, y0 = pin.y - 18;            // the tip of the pin, roughly its head
      const mx = (x0 + x1) / 2;
      path.setAttribute("d", `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`);
    }
  };
  // …and as a scrolling row on phones.
  const row = el("div", { class: "memory-row", "aria-label": "Recent places" }, picks.map(make));
  return { overlay, row, update };
}

// ---- what the globe shows: this trip, or every place once ----
const VIEW_KEY = "imhere.globeView";
// Friends on the globe: fetched when that view is picked, kept for a minute.
let friendsCache = { at: 0, list: [] };
async function loadFriendsForGlobe() {
  if (Date.now() - friendsCache.at < 60_000) return friendsCache.list;
  const list = await data.friendsOnEarth().catch(() => []);
  await Promise.all(list.map(async (f) => { f.avatarURL = await data.avatarURL(f.avatar_path).catch(() => null); }));
  friendsCache = { at: Date.now(), list };
  return list;
}

async function showOnGlobe(checkIns, origins, profile, view) {
  const friends = view === "friends" && navigator.onLine ? await loadFriendsForGlobe() : [];
  globe?.show({ checkIns, origins, tripID: profile?.current_trip_id, view, friends,
                person: { name: profile?.display_name, avatarURL: app.avatarURL } });
  if (view === "friends" && !friends.length && globePane) {
    pinNote(globePane, navigator.onLine
      ? "No friends to show yet. People whose circle you're in, and people in your groups, appear here."
      : "Friends need signal to load.");
  }
}

function pinNote(pane, text) {
  pane.querySelector(".pin-card")?.remove();
  const close = el("button", { class: "icon-button", "aria-label": "Close" }, icon("close"));
  const card = el("div", { class: "pin-card", role: "status" }, el("div", { class: "rowline" }, el("p", { class: "dim" }, text), close));
  close.onclick = () => card.remove();
  pane.append(card);
}

function globeViewSwitch(checkIns, origins, profile) {
  const hasTrip = Boolean(profile?.current_trip_id || checkIns.some((c) => c.trip_id));
  const tripLabel = profile?.current_trip_id ? "This trip" : "Latest trip";
  let value = localStorage.getItem(VIEW_KEY) || (profile?.current_trip_id ? "trip" : "places");
  if (value === "trip" && !hasTrip) value = "places";
  const options = [["trip", tripLabel], ["places", "All places"], ["friends", "Friends"]];
  const buttons = options.map(([id, label]) => {
    const button = el("button", { type: "button", class: "seg" + (id === value ? " on" : ""),
      "aria-pressed": String(id === value) }, label);
    if (id === "trip" && !hasTrip) { button.disabled = true; button.title = "Start a trip to see its route"; }
    button.onclick = () => {
      if (value === id) return;
      value = id;
      try { localStorage.setItem(VIEW_KEY, id); } catch {}
      buttons.forEach((b, i) => { const on = options[i][0] === id; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      globePane?.querySelector(".pin-card")?.remove();
      showOnGlobe(checkIns, origins, profile, id);
    };
    return button;
  });
  const element = el("div", { class: "globe-view", role: "group", "aria-label": "What the globe shows" }, buttons);
  return { element, value: () => value };
}

async function render(container) {
  const { checkIns, origins, offline, at } = await loadEarth();
  const profile = app.profile;
  const latest = checkIns[0];
  const subtitle = latest ? `Last seen in ${cityOnly(latest.place_name)}, ${staleness(latest.created_at)}`
                          : "No check-ins yet";
  setSubtitle(subtitle);
  const reload = () => go("earth");

  // No check-ins yet: still show the globe (and Friends). Nothing starts
  // until you press Check in or Start a trip.

  const head = el("header", { class: "earth-head" },
    el("h1", {}, "Your little world"),
    el("p", {}, "Every journey leaves a lovely memory."),
    sparkle("a"), sparkle("b"), sparkle("c"));

  const slot = el("div", { class: "globe-pane", "aria-label": "Your interactive travel globe" });
  const memories = memoryCards(checkIns, null);
  const viewSwitch = globeViewSwitch(checkIns, origins, profile);
  const globeWrap = el("div", { class: "globe-wrap" }, globePane || slot, memories.overlay, viewSwitch.element);

  const wide = window.matchMedia("(min-width: 1100px)").matches;
  const editor = wide && checkIns.length
    ? keepsakeEditor(checkIns, origins, profile?.current_trip_id ?? checkIns[0]?.trip_id ?? null) : null;
  const panel = editor
    ? el("aside", { class: "editor-panel", "aria-label": "Make a little keepsake" },
        el("div", { class: "rowline", style: "margin-bottom:var(--s3)" },
          el("h2", { class: "keepsake-head", style: "font-size:26px" }, "Make a little keepsake", sparkle())),
        editor.element)
    : null;

  fill(container,
    el("div", { class: "earth" + (panel ? " with-editor" : "") },
      el("div", { class: "earth-main" },
        head,
        offline ? el("div", { class: "here", style: "background:var(--peach-soft);min-height:0;margin:var(--s3) 0" },
          icon("signal"), el("div", {}, el("div", { style: "font-weight:700" }, "No signal"),
            el("div", { class: "dim" }, `Showing your world as it was ${staleness(new Date(at).toISOString())}. Check-ins still work.`))) : null,
        globeWrap,
        memories.row,
        statsRow(checkIns),
        el("div", { class: "earth-lower" },
          tripCard(profile, origins, checkIns, reload),
          keepsakesCard(checkIns),
          historyList(checkIns, profile?.current_trip_id, reload),
          el("div", { class: "posters-slot" }))),
      panel));

  postersCard(reload).then((card) => {
    if (card) container.querySelector(".posters-slot")?.replaceWith(card);
  }).catch(() => {});

  if (editor) editor.start();

  // Re-lay out if the window crosses the three-column width.
  const query = window.matchMedia("(min-width: 1100px)");
  query.onchange = () => { if (app.tab === "earth") go("earth"); };

  try {
    await ensureGlobe();
    if (!globePane.isConnected) globeWrap.firstElementChild.replaceWith(globePane);
    globePane.querySelector(".pin-card")?.remove();
    await showOnGlobe(checkIns, origins, profile, viewSwitch.value());
    if (!memoryListening) { globe.onMove(() => currentMemoryUpdate?.()); memoryListening = true; }
    currentMemoryUpdate = memories.update;
    requestAnimationFrame(memories.update);
    setTimeout(memories.update, 400);
  } catch (error) {
    console.error(error);
    slot.replaceChildren(el("div", { class: "empty" }, el("p", { class: "dim" }, error.message)));
  }
}
let memoryListening = false;
let currentMemoryUpdate = null;

export default { render };
