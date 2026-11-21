// ---------------------------------------------------------------
// Place search, reverse geocoding and the browser's own location.
//
// This replaces MKLocalSearchCompleter from the iPhone app. Apple gave
// us that for free; on the web we have to pick a provider. Everything
// provider-specific is inside this file, so switching later means
// editing GEOCODER in config.js and (if needed) one function here.
// ---------------------------------------------------------------
import { GEOCODER } from "./config.js";

/** The shape every provider is normalised into. */
// { label, name, city, country, countryCode, lat, lon }

const PROVIDERS = {
  photon: {
    // komoot's Photon: no API key, CORS-friendly, built for autocomplete.
    // Fair-use service — if this app ever gets real traffic, self-host it
    // (https://github.com/komoot/photon) and change the URL below.
    async search(query, signal) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`;
      const response = await fetch(url, { signal });
      const json = await response.json();
      return (json.features || []).map(fromPhoton);
    },
    async reverse(lat, lon, signal) {
      const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`;
      const response = await fetch(url, { signal });
      const json = await response.json();
      const first = (json.features || [])[0];
      return first ? fromPhoton(first) : null;
    },
  },
  nominatim: {
    // OpenStreetMap's own geocoder. Stricter usage policy (1 request/sec,
    // no heavy use) — fine for testing, not for a busy app.
    async search(query, signal) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { signal });
      return (await response.json()).map(fromNominatim);
    },
    async reverse(lat, lon, signal) {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`;
      const response = await fetch(url, { signal });
      const json = await response.json();
      return json && json.lat ? fromNominatim(json) : null;
    },
  },
};

/**
 * Use a place's own regional code instead of the sovereign country's.
 * The geocoder files Hong Kong under "cn" ("Hong Kong, China") — but HK,
 * Macau and Taiwan have their own flags, and so do England/Scotland/Wales.
 *
 * Only the region-level fields are checked (state/city/county), never the
 * street or venue name, so "Hong Kong Road, Qingdao" stays Chinese.
 */
export function regionalCode(countryCode, { state, city, county, name, type } = {}) {
  const cc = (countryCode || "").toLowerCase() || null;
  const areas = [state, city, county];
  // A search for the region itself ("Hong Kong", type state/city) counts too.
  if (["country", "state", "city", "region"].includes(type)) areas.push(name);
  const area = areas.filter(Boolean).join(" | ").toLowerCase();

  if (!cc || ["cn", "hk", "mo", "tw"].includes(cc)) {
    if (/hong kong|香港/.test(area)) return "hk";
    if (/maca[uo]|澳門|澳门/.test(area)) return "mo";
    if (/taiwan|臺灣|台灣|台湾/.test(area)) return "tw";
  }
  if (cc === "gb") {
    if (/\bscotland\b/.test(area)) return "gb-sct";
    if (/\bwales\b/.test(area)) return "gb-wls";
    if (/\bengland\b/.test(area)) return "gb-eng";
    // Northern Ireland has no flag of its own in Unicode — keep 🇬🇧.
  }
  return cc;
}

// Regions shown as themselves, not "…, China".
const REGION_DISPLAY = { hk: "Hong Kong", mo: "Macau", tw: "Taiwan" };

/** Join label parts, dropping empties and immediate repeats ("Hong Kong, Hong Kong"). */
function joinLabel(parts) {
  const out = [];
  for (const part of parts) {
    if (part && part.toLowerCase() !== (out[out.length - 1] || "").toLowerCase()) out.push(part);
  }
  return out.join(", ");
}

function fromPhoton(feature) {
  const p = feature.properties || {};
  const [lon, lat] = feature.geometry.coordinates;
  const name = p.name || p.street || p.city || p.state || p.country || "Unknown";
  const area = p.city && p.city !== name ? p.city : p.state && p.state !== name ? p.state : "";
  const countryCode = regionalCode(p.countrycode,
    { state: p.state, city: p.city, county: p.county, name: p.name, type: p.type });
  const country = REGION_DISPLAY[countryCode] || p.country || "";
  return {
    name,
    city: p.city || (p.type === "city" ? p.name : "") || name,
    country,
    countryCode,
    label: joinLabel([name, area, country]),
    lat, lon,
  };
}

function fromNominatim(item) {
  const a = item.address || {};
  const name = item.name || (item.display_name || "").split(",")[0];
  const city = a.city || a.town || a.village || a.county || name;
  const countryCode = regionalCode(a.country_code,
    { state: a.state, city: a.city || a.town, county: a.county, name, type: item.addresstype });
  const region = REGION_DISPLAY[countryCode];
  // Nominatim's long label ends in the country; for HK/MO/TW drop the trailing ", China".
  const label = region
    ? joinLabel([...(item.display_name || name).split(", ").filter((part) => part !== a.country), region])
    : (item.display_name || name);
  return {
    name,
    city,
    country: region || a.country || "",
    countryCode,
    label,
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
  };
}

const provider = () => PROVIDERS[GEOCODER] || PROVIDERS.photon;

export async function searchPlaces(query, signal) {
  if (!query || query.trim().length < 2) return [];
  return provider().search(query.trim(), signal);
}

export async function reverseGeocode(lat, lon, signal) {
  try {
    return await provider().reverse(lat, lon, signal);
  } catch {
    return null;
  }
}

/** The browser's own GPS. Needs https:// (or http://localhost). */
export function currentPosition({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share your location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      (error) => reject(new Error(
        error.code === 1
          ? "Location permission was denied. Allow it in your browser settings, or type the place instead."
          : "Couldn't get your location. Type the place instead."
      )),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

// ---------------------------------------------------------------
// The autocomplete field (the web version of LocationSearchField.swift).
//
//   const field = placeField({ placeholder: "Where are you?",
//                              onResolve: (place) => { ... } });
//   container.append(field.element);
//
// `place` is null while the box is empty or unresolved.
// ---------------------------------------------------------------
export function placeField({ placeholder = "Search for a place", value = "", onResolve = () => {}, allowCurrent = true, onLocateError = null } = {}) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "place-input";
  input.placeholder = placeholder;
  input.value = value;
  input.autocomplete = "off";

  const list = document.createElement("div");
  list.className = "place-results hidden";

  const wrap = document.createElement("div");
  wrap.className = "place-field";
  wrap.append(input, list);

  const LOCATE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  let locateButton = null;

  /** Use the GPS fix. Resolves to the place, or null if it failed. */
  async function locate() {
    if (locateButton) { locateButton.disabled = true; locateButton.setAttribute("aria-busy", "true"); }
    try {
      const position = await currentPosition();
      // GPS works with no signal; naming the place doesn't. If the lookup
      // fails we keep the coordinates and mark the name as "to look up later".
      const place = (await reverseGeocode(position.lat, position.lon).catch(() => null)) || {
        name: "Current location", city: "Current location", country: "",
        countryCode: null, label: `${position.lat.toFixed(3)}, ${position.lon.toFixed(3)}`,
        lat: position.lat, lon: position.lon, needsName: true,
      };
      // Keep the GPS fix; the geocoder's coordinates are the nearest label.
      place.lat = position.lat;
      place.lon = position.lon;
      choose(place);
      return place;
    } catch (error) {
      if (onLocateError) onLocateError(error); else alert(error.message);
      return null;
    } finally {
      if (locateButton) { locateButton.disabled = false; locateButton.removeAttribute("aria-busy"); }
    }
  }

  if (allowCurrent) {
    locateButton = document.createElement("button");
    locateButton.type = "button";
    locateButton.className = "locate";
    locateButton.title = "Use my current location";
    locateButton.setAttribute("aria-label", "Use my current location");
    locateButton.innerHTML = LOCATE_ICON;
    locateButton.addEventListener("click", locate);
    wrap.append(locateButton);
  }

  let resolved = null;
  let debounceTimer = null;
  let inFlight = null;

  function choose(place) {
    resolved = place;
    input.value = place.label;
    list.classList.add("hidden");
    onResolve(place);
  }

  function render(places) {
    list.replaceChildren();
    if (!places.length) { list.classList.add("hidden"); return; }
    for (const place of places) {
      const row = document.createElement("div");
      row.className = "place-result";
      row.textContent = place.label;
      // mousedown fires before the input's blur, so the click isn't lost.
      row.addEventListener("mousedown", (event) => { event.preventDefault(); choose(place); });
      list.append(row);
    }
    list.classList.remove("hidden");
  }

  input.addEventListener("input", () => {
    resolved = null;
    onResolve(null);
    clearTimeout(debounceTimer);
    if (inFlight) inFlight.abort();
    const query = input.value;
    if (query.trim().length < 2) { list.classList.add("hidden"); return; }
    debounceTimer = setTimeout(async () => {
      inFlight = new AbortController();
      try {
        render(await searchPlaces(query, inFlight.signal));
      } catch (error) {
        if (error.name !== "AbortError") console.warn("place search failed", error);
      }
    }, 280);
  });

  input.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 150));
  input.addEventListener("focus", () => { if (list.childElementCount) list.classList.remove("hidden"); });

  return {
    element: wrap,
    get place() { return resolved; },
    get text() { return input.value; },
    clear() { input.value = ""; resolved = null; list.classList.add("hidden"); },
    focus() { input.focus(); },
    locate,
  };
}
