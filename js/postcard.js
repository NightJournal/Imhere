// ---------------------------------------------------------------
// Postcard — the exportable image of a trip.
//
// Ported from Postcard.swift + CountryMap.swift; the crop maths, the pin
// rules and the label-placement rules are the same as the iPhone version.
// November 2026 redesign:
//
//   * pastel watercolour on paper (was a dusk gradient)
//   * two formats, each with its own layout — never cropped from each other:
//       "story"     9:16  1080 × 1920  map on top, text below
//       "landscape" 3:2   1800 × 1200  square map left, text column right
//   * Natural Earth 1:50m country shapes (Hong Kong, Macau and Singapore
//     exist now, so their names follow the country rules)
//   * dark ink labels with paper-coloured halos; outside labels dodge
//     each other instead of overlapping
//   * Quicksand title, Nunito Sans text
//
// The map is drawn in a "logical" frame about the size the old card had
// and scaled up, so every placement constant below still means what it
// meant on the iPhone.
// ---------------------------------------------------------------
import { haversineKm, cityOnly, flagEmoji, mapCountry, PLACE_NAMES } from "./ui.js";

export const LAYOUTS = {
  keepsake: { width: 1080, height: 1160, map: { x: 78, y: 104, width: 712, height: 674 }, scale: 1 },
  // map: where the watercolour map sits on the paper (physical px)
  story:     { width: 1080, height: 1920, map: { x: 84, y: 96, width: 912, height: 1180 }, scale: 1.25 },
  landscape: { width: 1800, height: 1200, map: { x: 84, y: 84, width: 1032, height: 1032 }, scale: 1.3 },
};
let CARD = LAYOUTS.story;
// MAP is the logical frame the label rules work in (physical size / scale).
let MAP = { x: 0, y: 0, width: 912 / 1.25, height: 1180 / 1.25 };

// ---- colours (the app's palette) ----
const PAPER = "#FFF3DF", SEA = "#B1DFEC", LAND = "#FFF0CD", VISITED = "#FFB9A5",
      CORAL = "#EE9372", INK = "#4A2C44", INK2 = "#73596C", RULE = "#E8DACB",
      ROUTE = "#6B4A63", LAVENDER = "#D9CCF3", MINT = "#CDEBDC";

// ============================================================ country data

let COUNTRIES = null;   // { names: {CC: "Name"}, rings: [{c, p:[lon,lat,...]}] }

export async function loadCountries() {
  if (COUNTRIES) return COUNTRIES;
  const response = await fetch("data/countries-50m.json");
  if (!response.ok) throw new Error("Couldn't load the country outlines.");
  COUNTRIES = await response.json();
  return COUNTRIES;
}

// Regional codes ("GB-SCT") use their country's shape ("GB"); places with no
// shape at this scale (Hong Kong, Macau) simply have none.
const ringsFor = (code) => COUNTRIES.rings.filter((ring) => ring.c === mapCountry(code));

/** "TH" -> "Thailand". Falls back to the browser's own country list (HK, SG, MO…). */
function englishName(code) {
  if (PLACE_NAMES[code]) return PLACE_NAMES[code];   // "Hong Kong", not "Hong Kong SAR China"
  const baked = COUNTRIES.names[code];
  if (baked) return baked;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch { return code; }
}

/** Lon/lat bounding box, or null when we have no polygon at this scale. */
function bboxOf(code) {
  const owned = ringsFor(code);
  if (!owned.length) return null;
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const ring of owned) {
    for (let i = 0; i < ring.p.length; i += 2) {
      minLon = Math.min(minLon, ring.p[i]);   maxLon = Math.max(maxLon, ring.p[i]);
      minLat = Math.min(minLat, ring.p[i+1]); maxLat = Math.max(maxLat, ring.p[i+1]);
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Ray-casting point-in-polygon over a flat [lon,lat,…] array. */
function ringContains(p, lon, lat) {
  let inside = false;
  const count = p.length / 2;
  let j = count - 1;
  for (let i = 0; i < count; i++) {
    const aLon = p[i*2], aLat = p[i*2+1], bLon = p[j*2], bLat = p[j*2+1];
    if ((aLat > lat) !== (bLat > lat) &&
        lon < ((bLon - aLon) * (lat - aLat)) / (bLat - aLat) + aLon) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

/**
 * A point inside the country's largest ring, plus how many degrees of
 * longitude the country spans AT THAT LATITUDE. The bounding box lies for
 * S-shaped countries — Vietnam is 7° wide overall but 0.89° where its
 * label sits — so the label size is decided from this span, not the box.
 */
function labelSpot(code) {
  const owned = ringsFor(code);
  if (!owned.length) return null;
  const p = owned.reduce((big, ring) => (ring.p.length > big.p.length ? ring : big)).p;
  const count = p.length / 2;
  if (count < 3) return null;

  // Shoelace centroid.
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < count; i++) {
    const k = (i + 1) % count;
    const aLon = p[i*2], aLat = p[i*2+1], bLon = p[k*2], bLat = p[k*2+1];
    const cross = aLon * bLat - bLon * aLat;
    area += cross;
    cx += (aLon + bLon) * cross;
    cy += (aLat + bLat) * cross;
  }
  if (Math.abs(area) < 1e-6) return { lat: p[1], lon: p[0], lonSpan: 0 };
  area /= 2; cx /= 6 * area; cy /= 6 * area;

  // Scanline across the centroid's latitude, west to east.
  const crossings = [];
  for (let i = 0; i < count; i++) {
    const k = (i + 1) % count;
    const aLon = p[i*2], aLat = p[i*2+1], bLon = p[k*2], bLat = p[k*2+1];
    if ((aLat > cy) !== (bLat > cy)) {
      const t = (cy - aLat) / (bLat - aLat);
      crossings.push(aLon + t * (bLon - aLon));
    }
  }
  crossings.sort((a, b) => a - b);

  if (ringContains(p, cx, cy)) {
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      if (cx >= crossings[i] && cx <= crossings[i+1]) {
        return { lat: cy, lon: cx, lonSpan: crossings[i+1] - crossings[i] };
      }
    }
    return { lat: cy, lon: cx, lonSpan: 0 };
  }
  // Centroid fell outside (S-shape) — use the widest span's midpoint.
  let bestWidth = 0, bestMid = cx;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i+1] - crossings[i];
    if (width > bestWidth) { bestWidth = width; bestMid = (crossings[i] + crossings[i+1]) / 2; }
  }
  return { lat: cy, lon: bestMid, lonSpan: bestWidth };
}

// ============================================================ projection

/**
 * Longitudes wrap at ±180, so Hong Kong (114) to San Francisco (-122) looks
 * like a 236° journey westward across Europe instead of a 124° hop over the
 * Pacific. Walk the route and, at each step, pick whichever of lon, lon+360
 * or lon-360 is nearest the previous point. The result can run past ±180 —
 * that is deliberate, and shiftLon() below brings the country outlines into
 * the same frame.
 */
function unwrapRoute(coords) {
  if (!coords.length) return coords;
  const out = [{ ...coords[0] }];
  for (let i = 1; i < coords.length; i++) {
    const previous = out[i - 1].lon;
    let lon = coords[i].lon;
    lon += 360 * Math.round((previous - lon) / 360);
    out.push({ lat: coords[i].lat, lon });
  }
  return out;
}

/** Bring a longitude into the crop's frame (which may run past ±180). */
function shiftLon(lon, crop) {
  const middle = (crop.minLon + crop.maxLon) / 2;
  return lon + 360 * Math.round((middle - lon) / 360);
}

/** Route-tight crop, padded 15%, widened to the map's aspect (cos-latitude). */
function cropBox(coords, aspect) {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const c of coords) {
    minLon = Math.min(minLon, c.lon); maxLon = Math.max(maxLon, c.lon);
    minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
  }
  if (minLon > maxLon) return { minLon: -180, minLat: -60, maxLon: 180, maxLat: 85 };

  const padLon = Math.max((maxLon - minLon) * 0.28, 3.2);
  const padLat = Math.max((maxLat - minLat) * 0.28, 3.2);
  minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat;

  const midLat = ((minLat + maxLat) / 2) * Math.PI / 180;
  let lonSpan = maxLon - minLon, latSpan = maxLat - minLat;
  const current = (lonSpan * Math.cos(midLat)) / latSpan;
  if (current < aspect) {
    const needed = (aspect * latSpan) / Math.cos(midLat);
    const d = (needed - lonSpan) / 2; minLon -= d; maxLon += d;
  } else {
    const needed = (lonSpan * Math.cos(midLat)) / aspect;
    const d = (needed - latSpan) / 2; minLat -= d; maxLat += d;
  }
  return { minLon, minLat, maxLon, maxLat: Math.min(maxLat, 85) };
}

const project = (lon, lat, crop) => ({
  x: MAP.x + ((shiftLon(lon, crop) - crop.minLon) / (crop.maxLon - crop.minLon)) * MAP.width,
  y: MAP.y + ((crop.maxLat - lat) / (crop.maxLat - crop.minLat)) * MAP.height,
});

function ringTouchesCrop(ring, crop) {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (let i = 0; i < ring.p.length; i += 2) {
    minLon = Math.min(minLon, ring.p[i]);   maxLon = Math.max(maxLon, ring.p[i]);
    minLat = Math.min(minLat, ring.p[i+1]); maxLat = Math.max(maxLat, ring.p[i+1]);
  }
  // Shift the whole ring by one turn of the globe if that is where the crop
  // is looking (Natural Earth already splits rings at the antimeridian, so a
  // single shift per ring is always right).
  const offset = shiftLon((minLon + maxLon) / 2, crop) - (minLon + maxLon) / 2;
  minLon += offset; maxLon += offset;
  return maxLon >= crop.minLon && minLon <= crop.maxLon
      && maxLat >= crop.minLat && minLat <= crop.maxLat;
}

function ringPath(ctx, ring, crop) {
  ctx.beginPath();
  for (let i = 0; i < ring.p.length; i += 2) {
    const point = project(ring.p[i], ring.p[i+1], crop);
    if (i === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

// ============================================================ type

const brandFont = (size, bold = false) =>
  `${bold ? 700 : 400} ${size}px "Nunito", -apple-system, ` +
  `BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang TC", "Noto Sans TC", sans-serif`;
const titleFont = (size) =>
  `500 ${size}px "Fredoka", "Nunito", -apple-system, sans-serif`;

const emojiFont = (size) =>
  `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/** Canvas has no line-height, so approximate the one UIKit used. */
const lineHeight = (size) => size * 1.2;

/** Make sure the typefaces are ready before anything is measured. */
let paperArt = null, flowerArt = null, logoArt = null, postcardWorld = null, artworkPromise;
function loadArtwork() {
  const load = src => new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => resolve(null); image.src = src;
  });
  return artworkPromise ||= Promise.all([
    load("assets/watercolor-paper.png"), load("assets/peach-blossoms.png"), load("assets/watercolor-stand-logo.png"), load("assets/postcard-world-original.png")
  ]).then(([paper, flower, logo, world]) => { paperArt = paper; flowerArt = flower; logoArt = logo; postcardWorld = world; });
}
let handwritingPromise;
export async function ensureFonts() {
  await loadArtwork();
  if (!document.fonts) return;
  handwritingPromise ||= new FontFace("Cormorant Garamond", 'url("fonts/cormorant-garamond-italic.ttf")', { weight: "300 700", style: "italic" }).load().then(face => document.fonts.add(face));
  await handwritingPromise;
  const sample = "5 places Hội An Đà Lạt São Paulo ÀÉÎÕÜ";
  try {
    await Promise.all([
      document.fonts.load('400 24px "Nunito"', sample),
      document.fonts.load('700 24px "Nunito"', sample),
      document.fonts.load('500 64px "Fredoka"', sample),
      document.fonts.load('italic 500 72px "Cormorant Garamond"', sample),
    ]);
    await document.fonts.ready;
  } catch { /* falls back to the system font — the postcard still renders */ }
}

// ============================================================ the postcard

/**
 * checkIns: OLDEST first (the reverse of what db.myCheckIns returns).
 * origin:   the trip_origins row, or null.
 * photo:    an already-loaded HTMLImageElement, or null.
 */
export function makePostcard({ checkIns, origin = null, photo = null, options = {}, format = "keepsake",
                               title = null, places = null }) {
  CARD = LAYOUTS[format] || LAYOUTS.story;
  const K = CARD.scale;
  MAP = { x: 0, y: 0, width: CARD.map.width / K, height: CARD.map.height / K };
  const show = { photo: true, distance: true, dates: true, stops: true, ...options };
  if (!checkIns.length) throw new Error("Nothing to put on a postcard yet.");
  if (!COUNTRIES) throw new Error("Country outlines aren't loaded.");

  // ---- route, oldest first, origin in front ----
  const coords = [];
  if (origin) coords.push({ lat: origin.latitude, lon: origin.longitude });
  for (const checkIn of checkIns) coords.push({ lat: checkIn.latitude, lon: checkIn.longitude });

  // ---- which cities count ----
  // Each city once, in first-visit order. The origin city never appears:
  // leaving home and coming back isn't a destination. "Home" means the same
  // city name as the origin, or a final stop within 15 km of it — 15 and not
  // 30, because Hong Kong to Shenzhen is under 30 km and genuinely elsewhere.
  const homeCities = new Set();
  if (origin) {
    homeCities.add(cityOnly(origin.name).toLowerCase());
    const last = checkIns[checkIns.length - 1];
    if (last && haversineKm({ lat: origin.latitude, lon: origin.longitude },
                            { lat: last.latitude, lon: last.longitude }) < 15) {
      homeCities.add(cityOnly(last.place_name).toLowerCase());
    }
  }
  const cities = [];
  const seen = new Set();
  for (const checkIn of checkIns) {
    const city = cityOnly(checkIn.place_name);
    const key = city.toLowerCase();
    if (!homeCities.has(key) && !seen.has(key)) { seen.add(key); cities.push(city); }
  }
  // A trip that never left home would show nothing — fall back to the one city.
  if (!cities.length && checkIns[0]) cities.push(cityOnly(checkIns[0].place_name));
  const placeCount = cities.length;

  const flags = [];
  for (const checkIn of checkIns) {
    const flag = flagEmoji(checkIn.country_code);
    if (flag && !flags.includes(flag)) flags.push(flag);
  }
  // Codes arrive from the geocoder lowercase ("th"); the ring data and the
  // names table are uppercase ("TH"). Everything below works in uppercase.
  const visitedCodes = [];
  for (const checkIn of checkIns) {
    const code = (checkIn.country_code || "").toUpperCase();
    if (code && !visitedCodes.includes(code)) visitedCodes.push(code);
  }

  const route = unwrapRoute(coords);
  // Frame destinations; departure still contributes to the distance below.
  const mapRoute = unwrapRoute(checkIns.map(c => ({ lat: c.latitude, lon: c.longitude })));
  const crop = cropBox(mapRoute, MAP.width / MAP.height);
  const artFrame = postcardWorld ? artworkFrame(mapRoute, MAP.width / MAP.height) : null;
  const mapPoint = (lon, lat) => artFrame ? artworkProject(lon, lat, artFrame) : project(lon, lat, crop);

  // ---- canvas ----
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";     // matches UIKit's draw(at:) top-left origin

  // 1. Warm paper with softly scalloped edges.
  drawPaper(ctx);

  // 2. The map: a watercolour wash with brushy, uneven edges.
  const M = CARD.map;
  ctx.save();
  brushRect(ctx, M.x, M.y, M.width, M.height, 14);
  ctx.clip();
  ctx.fillStyle = SEA;
  ctx.fillRect(M.x, M.y, M.width, M.height);
  wash(ctx, M, 7);
  ctx.translate(M.x, M.y);
  ctx.scale(K, K);                 // everything below is in the logical frame
  ctx.beginPath();
  ctx.rect(MAP.x, MAP.y, MAP.width, MAP.height);
  ctx.clip();

  if (postcardWorld) {
    // Crop the untouched source bitmap. One scale factor for both axes:
    // Keep proportions and soften only the painted map, not labels or decorations.
    ctx.save();
    ctx.filter = "contrast(72%) brightness(1.10)";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const scale = MAP.width / artFrame.width;
    const turns = Math.ceil(artFrame.width / postcardWorld.naturalWidth) + 1;
    for (let turn = -turns; turn <= turns; turn++) {
      ctx.drawImage(postcardWorld,
        (turn * postcardWorld.naturalWidth - artFrame.x) * scale, -artFrame.y * scale,
        postcardWorld.naturalWidth * scale, postcardWorld.naturalHeight * scale);
    }
    ctx.restore();
    // A translucent ivory glaze softens pigment without blurring the artwork.
    ctx.save();
    ctx.fillStyle = "rgba(255, 248, 235, 0.20)";
    ctx.fillRect(0, 0, MAP.width, MAP.height);
    ctx.restore();
  } else {
  // Render coastlines at export resolution, with the same scale on both axes.
  // A world illustration cannot supply accurate detail at a regional crop.
  const onScreen = COUNTRIES.rings.filter(ring => ringTouchesCrop(ring, crop));
  paintWatercolor(ctx, SEA, 0);
  const countryShapes = new Map();
  for (const ring of onScreen) {
    if (!countryShapes.has(ring.c)) countryShapes.set(ring.c, new Path2D());
    countryShapes.get(ring.c).addPath(ringPath2D(ring, crop));
  }
  for (const [code, shape] of countryShapes) {
    const visited = visitedCodes.some(c => mapCountry(c) === code);
    const seed = [...code].reduce((n, c) => n + c.charCodeAt(0), 0);
    const color = visited ? "#FFC0AB" : ["#F6E9C4", "#E3E9CC", "#F7ECCD"][seed % 3];
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 2;
    ctx.fill(shape);
    ctx.shadowBlur = 0;
    ctx.clip(shape);
    paintWatercolor(ctx, color, seed);
    ctx.restore();
  }
  }
  // 3. Route — thin dashed amber line through the stops.
  if (mapRoute.length > 1) {
    ctx.beginPath();
    mapRoute.forEach((c, index) => {
      const point = mapPoint(c.lon, c.lat);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else {
        const previous = mapPoint(mapRoute[index - 1].lon, mapRoute[index - 1].lat);
        const dx = point.x - previous.x, dy = point.y - previous.y;
        ctx.bezierCurveTo(previous.x + dx * .25 - dy * .12, previous.y + dy * .25 + dx * .12,
          previous.x + dx * .75 + dy * .12, previous.y + dy * .75 - dx * .12, point.x, point.y);
      }
    });
    ctx.strokeStyle = ROUTE;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([11, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // City labels take priority, matching the reference's readable travel map.
  const taken = [];
  const points = mapRoute.map(c => mapPoint(c.lon, c.lat));
  for (const p of points) taken.push({ x: p.x - 13, y: p.y - 13, width: 26, height: 26 });
  const seenLabels = new Set();
  checkIns.forEach((checkIn, i) => {
    const name = cityOnly(checkIn.place_name).toUpperCase();
    if (seenLabels.has(name)) return;
    seenLabels.add(name);
    const p = points[i];
    drawPin(ctx, p.x, p.y, 27, false);
    ctx.font = brandFont(25, true);
    const width = ctx.measureText(name).width, height = lineHeight(25);
    placeOutside(ctx, taken, name, width, height, [
      [p.x + 19, p.y - 12], [p.x - width - 19, p.y - 12],
      [p.x - width / 2, p.y - height - 20], [p.x - width / 2, p.y + 20],
    ]);
  });
  // Add a quiet country label only when it has enough clear land around it.
  for (const code of visitedCodes) {
    const spot = labelSpot(code);
    if (!spot) continue;
    const anchor = mapPoint(spot.lon, spot.lat);
    ctx.font = brandFont(21, true);
    const name = englishName(code).toUpperCase();
    const width = ctx.measureText(name).width, height = lineHeight(21);
    const x = anchor.x - width / 2, y = anchor.y - height / 2;
    const available = spot.lonSpan / (crop.maxLon - crop.minLon) * MAP.width;
    if (width > available * .9 || x < 15 || x + width > MAP.width - 15 || y < 15 || y + height > MAP.height - 15) continue;
    if (taken.some(b => x < b.x + b.width + 14 && x + width + 14 > b.x && y < b.y + b.height + 14 && y + height + 14 > b.y)) continue;
    haloText(ctx, name, x, y);
    taken.push({x, y, width, height});
  }

  ctx.restore();

  // ---- 6. Keepsake: stamp, photo, title, places ----
  const show2 = { ...show };
  const cardTitle = (title && title.trim()) || defaultTitle(cities, visitedCodes);
  const placeLine = (places && places.trim()) || cities.join(" · ");
  const sub = [];
  if (show2.distance) {
    let km = 0;
    for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i-1], coords[i]);
    if (km >= 1) sub.push(`${Math.round(km).toLocaleString("en-GB")} km travelled`);
  }
  if (show2.dates) {
    const range = dateRange(origin, checkIns);
    if (range) sub.push(range);
  }
  const withPhoto = show2.photo && photo;

  if (format === "keepsake") {
    drawStamp(ctx, 848, 66, 158, 190, 4, visitedCodes.at(-1));
    drawPostmark(ctx, 716, 166);
    if (withPhoto) drawTapedPhoto(ctx, photo, 671, 463, 300, 290, 7);
    let y = drawTitle(ctx, cardTitle, 106, 822, 745, 57, -2, 2);
    if (show2.stops && placeLine) y = drawPlaces(ctx, placeLine, 106, y + 8, 760, 28, 2);
    if (sub.length) drawMeta(ctx, sub, 140, y + 9, 690, 19);
    drawSprig(ctx, 882, 896, .88);
    ctx.save();
    ctx.translate(876, 1062); ctx.scale(.52, .52);
    drawFooter(ctx, 0, 0);
    ctx.restore();
  } else if (format === "landscape") {
    drawStamp(ctx, CARD.width - 84 - 150, 84, 150, 180, 4, visitedCodes.at(-1));
    drawPostmark(ctx, CARD.width - 84 - 300, 120);
    const x = M.x + M.width + 64, width = CARD.width - x - 84;
    let y = 300;
    y = drawTitle(ctx, cardTitle, x, y, width, 62, -2, 3);
    if (show2.stops && placeLine) y = drawPlaces(ctx, placeLine, x, y + 18, width, 34, 3);
    if (sub.length) y = drawMeta(ctx, sub, x, y + 12, width, 28);
    if (withPhoto) drawTapedPhoto(ctx, photo, x + 20, Math.max(y + 36, 760), Math.min(width - 40, 360), 280, -4);
    drawSprig(ctx, CARD.width - 170, CARD.height - 210, 1);
    drawFooter(ctx, x, CARD.height - 96);
  } else {
    drawStamp(ctx, M.x + M.width - 170, M.y + 24, 140, 168, 4, visitedCodes.at(-1));
    drawPostmark(ctx, M.x + M.width - 330, M.y + 60);
    if (withPhoto) drawTapedPhoto(ctx, photo, M.x + M.width - 400, M.y + M.height - 330, 380, 300, 4);
    const x = 96, width = CARD.width - 2 * x;
    let y = M.y + M.height + 70;
    y = drawTitle(ctx, cardTitle, x, y, width - 140, 80, -2, 2);
    if (show2.stops && placeLine) y = drawPlaces(ctx, placeLine, x, y + 16, width - 120, 36, 2);
    if (sub.length) y = drawMeta(ctx, sub, x, y + 10, width - 120, 30);
    drawSprig(ctx, CARD.width - 190, CARD.height - 330, 1.1);
    drawFooter(ctx, x, CARD.height - 110);
  }

  return canvas;
}

// ============================================================ small helpers

// Approximate registration of this hand-painted illustration, in original pixels.
// These affect overlays and crop selection only; the bitmap is never warped.
function interpolateArt(value, anchors) {
  let i = anchors.findIndex((a, j) => j < anchors.length - 1 && value >= a[0] && value <= anchors[j + 1][0]);
  if (i < 0) i = value < anchors[0][0] ? 0 : anchors.length - 2;
  const [a, b] = [anchors[i], anchors[i + 1]];
  return a[1] + (value - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
}
function artworkPixel(lon, lat) {
  const turn = Math.floor((lon + 180) / 360), wrapped = lon - turn * 360;
  const x = interpolateArt(wrapped, [[-180,0],[-120,260],[-60,580],[0,890],[60,1090],[80,1180],[100,1290],[110,1380],[120,1450],[180,1774]]);
  const y = interpolateArt(lat, [[-90,887],[-60,780],[-30,680],[0,560],[10,465],[20,407],[30,305],[60,130],[90,0]]);
  return { x: (x + turn * 1774) * postcardWorld.naturalWidth / 1774, y: y * postcardWorld.naturalHeight / 887 };
}
function artworkFrame(route, aspect) {
  const points = route.map(c => artworkPixel(c.lon, c.lat));
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  // Keep regional context and avoid magnifying a tiny patch of paint.
  let width = Math.max(230, (maxX - minX) * 1.7), height = Math.max(220, (maxY - minY) * 1.7);
  width = Math.max(width, height * aspect); height = width / aspect;
  return { x: (minX + maxX - width) / 2, y: Math.max(0, Math.min(postcardWorld.naturalHeight - height, (minY + maxY - height) / 2)), width, height };
}
function artworkProject(lon, lat, frame) {
  const p = artworkPixel(lon, lat), scale = MAP.width / frame.width;
  return { x: (p.x - frame.x) * scale, y: (p.y - frame.y) * scale };
}

/** Fine pigment texture stays at a natural scale instead of magnifying a world map. */
function paintWatercolor(ctx, color, seed) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, MAP.width, MAP.height);
  if (!paperArt) return;
  ctx.save();
  const size = Math.max(MAP.width, MAP.height) * 1.12;
  ctx.translate(MAP.width / 2, MAP.height / 2);
  ctx.rotate((seed % 4) * Math.PI / 2);
  ctx.filter = "grayscale(1)";
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = .85;
  ctx.drawImage(paperArt, -size / 2, -size / 2, size, size);
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = .10;
  ctx.drawImage(paperArt, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** Small peach dots, centred exactly on each postcard destination. */
function drawPin(ctx, x, y, size, isOrigin) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, Math.max(3.5, size * .4), 0, Math.PI * 2);
  ctx.fillStyle = isOrigin ? "#F6C5AD" : "#F4A389";
  ctx.fill();
  ctx.strokeStyle = "#FFFCF5";
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();
}

/** Ink label with a paper-coloured halo, so it reads on land or sea. */
function haloText(ctx, text, x, y) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = PAPER;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = INK;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Draw a halo label at the first candidate spot that is inside the frame
 *  and doesn't overlap a label already drawn (else the first spot, clamped). */
function placeOutside(ctx, taken, text, width, height, candidates) {
  const clamp = ([x, y]) => [
    Math.min(Math.max(x, 8), MAP.width - width - 8),
    Math.min(Math.max(y, 8), MAP.height - height - 8),
  ];
  const overlaps = (x, y) => taken.some((b) =>
    x < b.x + b.width + 4 && x + width + 4 > b.x && y < b.y + b.height && y + height > b.y);
  let spot = null;
  for (const candidate of candidates) {
    const inside = candidate[0] >= 8 && candidate[0] + width <= MAP.width - 8;
    const [x, y] = clamp(candidate);
    if (inside && !overlaps(x, y)) { spot = [x, y]; break; }
  }
  if (!spot) {
    for (const candidate of candidates) {
      const [x, y] = clamp(candidate);
      if (!overlaps(x, y)) { spot = [x, y]; break; }
    }
  }
  spot ||= clamp(candidates[0]);
  haloText(ctx, text, spot[0], spot[1]);
  taken.push({ x: spot[0], y: spot[1], width, height });
}

function drawPhoto(ctx, photo, frame, radius) {
  ctx.save();
  roundedRect(ctx, frame, radius);
  ctx.clip();
  drawAspectFill(ctx, photo, frame);
  ctx.restore();
  roundedRect(ctx, frame, radius);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ============================================================ keepsake pieces

/** Default journal heading — editable for each trip in the postcard editor. */
export function defaultTitle() {
  return "Somewhere along the way";
}

function seeded(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Paper with scalloped edges, a soft shadow and fine grain. */
function drawPaper(ctx) {
  const W = CARD.width, H = CARD.height, inset = 24;
  const path = new Path2D(), randomEdge = seeded(27);
  const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset, corner = 32;
  // Small irregular deckled scallops and broad rounded corners, like handmade paper.
  const edge = (ax, ay, bx, by, nx, ny) => {
    const length = Math.hypot(bx - ax, by - ay), count = Math.round(length / 23);
    for (let i = 0; i < count; i++) {
      const t = (i + .5) / count, end = (i + 1) / count;
      const depth = 4 + randomEdge() * 5;
      path.quadraticCurveTo(ax + (bx - ax) * t + nx * depth, ay + (by - ay) * t + ny * depth,
        ax + (bx - ax) * end, ay + (by - ay) * end);
    }
  };
  path.moveTo(x0 + corner, y0);
  edge(x0 + corner, y0, x1 - corner, y0, 0, -1);
  path.quadraticCurveTo(x1, y0, x1, y0 + corner);
  edge(x1, y0 + corner, x1, y1 - corner, 1, 0);
  path.quadraticCurveTo(x1, y1, x1 - corner, y1);
  edge(x1 - corner, y1, x0 + corner, y1, 0, 1);
  path.quadraticCurveTo(x0, y1, x0, y1 - corner);
  edge(x0, y1 - corner, x0, y0 + corner, -1, 0);
  path.quadraticCurveTo(x0, y0, x0 + corner, y0);
  path.closePath();
  ctx.save();
  ctx.shadowColor = "rgba(74,44,68,0.16)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = PAPER;
  ctx.fill(path);
  ctx.restore();
  ctx.save();
  ctx.clip(path);
  if (paperArt) {
    ctx.save();
    ctx.filter = "grayscale(1)";
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = .8;
    const tileSize = 1000;
    for (let y = 0; y < H; y += tileSize) for (let x = 0; x < W; x += tileSize)
      ctx.drawImage(paperArt, x, y, tileSize, tileSize);
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = .15;
    ctx.drawImage(paperArt, 0, 0, W, H);
    ctx.restore();
  }
  const random = seeded(5);
  for (let i = 0; i < 2600; i++) {             // paper fibres and speckle
    ctx.fillStyle = `rgba(${random() > 0.5 ? "150,120,100" : "255,255,255"},${0.04 + random() * 0.06})`;
    ctx.fillRect(random() * W, random() * H, 1 + random() * 2, 1 + random() * 2);
  }
  ctx.restore();
}

/** A rectangle with gently wobbling, brushed edges. */
function brushRect(ctx, x, y, w, h, wobble) {
  const random = seeded(13);
  const points = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) points.push([x + (w * i) / steps, y + (random() - 0.5) * wobble]);
  for (let i = 1; i <= steps; i++) points.push([x + w + (random() - 0.5) * wobble, y + (h * i) / steps]);
  for (let i = 1; i <= steps; i++) points.push([x + w - (w * i) / steps, y + h + (random() - 0.5) * wobble]);
  for (let i = 1; i < steps; i++) points.push([x + (random() - 0.5) * wobble, y + h - (h * i) / steps]);
  ctx.beginPath();
  points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

/** Watercolour mottling over the sea. */
function wash(ctx, frame, seed) {
  const random = seeded(seed);
  for (let i = 0; i < 160; i++) {
    const x = frame.x + random() * frame.width, y = frame.y + random() * frame.height, r = 30 + random() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = random() > 0.5 ? "255,255,255" : "140,190,215";
    g.addColorStop(0, `rgba(${tone},${0.06 + random() * 0.08})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function ringPath2D(ring, crop, dx = 0) {
  const path = new Path2D();
  for (let i = 0; i < ring.p.length; i += 2) {
    const point = project(ring.p[i], ring.p[i + 1], crop);
    if (i === 0) path.moveTo(point.x + dx, point.y + dx); else path.lineTo(point.x + dx, point.y + dx);
  }
  path.closePath();
  return path;
}

/** Antique destination postage: perforated ivory paper and engraved map silhouette. */
function drawStamp(ctx, x, y, w, h, tiltDeg, code) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(tiltDeg * Math.PI / 180);
  ctx.scale(w / 158, h / 190);
  ctx.translate(-79, -95);
  const edge = new Path2D(); edge.rect(0, 0, 158, 190);
  // Full circular cut-outs are centred on the edge, leaving true perforations.
  for (let px = 7; px < 158; px += 12) {
    edge.moveTo(px + 3, 0); edge.arc(px, 0, 3, 0, Math.PI * 2);
    edge.moveTo(px + 3, 190); edge.arc(px, 190, 3, 0, Math.PI * 2);
  }
  for (let py = 7; py < 190; py += 12) {
    edge.moveTo(3, py); edge.arc(0, py, 3, 0, Math.PI * 2);
    edge.moveTo(161, py); edge.arc(158, py, 3, 0, Math.PI * 2);
  }
  ctx.shadowColor = "rgba(86,65,43,.20)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#FFF7E5"; ctx.fill(edge, "evenodd");
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#DDE2CD"; ctx.fillRect(12, 12, 134, 166);
  if (paperArt) {
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = .22;
    ctx.drawImage(paperArt, 12, 12, 134, 166); ctx.restore();
  }
  ctx.strokeStyle = "#78826B"; ctx.lineWidth = 1;
  ctx.strokeRect(17, 17, 124, 156); ctx.strokeRect(20, 20, 118, 150);
  ctx.fillStyle = "#56634E"; ctx.textAlign = "center";
  ctx.font = '600 10px "Nunito", sans-serif'; ctx.fillText("IMHERE • AIR MAIL", 79, 28);
  const bounds = code && bboxOf(code);
  if (bounds) {
    const cos = Math.cos((bounds.minLat + bounds.maxLat) / 2 * Math.PI / 180);
    const scale = Math.min(84 / Math.max(.1, (bounds.maxLon - bounds.minLon) * cos), 88 / Math.max(.1, bounds.maxLat - bounds.minLat));
    ctx.fillStyle = "#8D9B7E"; ctx.strokeStyle = "#607054"; ctx.lineWidth = .7;
    for (const ring of ringsFor(code)) {
      ctx.beginPath();
      for (let i = 0; i < ring.p.length; i += 2) {
        const px = 79 + (ring.p[i] - (bounds.minLon + bounds.maxLon) / 2) * cos * scale;
        const py = 94 - (ring.p[i + 1] - (bounds.minLat + bounds.maxLat) / 2) * scale;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  ctx.fillStyle = "#56634E";
  const destination = code ? englishName(code).toUpperCase() : "BON VOYAGE";
  let size = 13; ctx.font = `700 ${size}px "Nunito", sans-serif`;
  while (ctx.measureText(destination).width > 108 && size > 8) { size--; ctx.font = `700 ${size}px "Nunito", sans-serif`; }
  ctx.fillText(destination, 79, 143);
  ctx.font = '400 8px "Nunito", sans-serif'; ctx.fillText("A MEMORY • 01", 79, 160);
  ctx.restore();
}

/** Wavy postmark lines beside the stamp. */
function drawPostmark(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = "rgba(107,74,99,0.45)";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    for (let t = 0; t <= 140; t += 4) {
      const px = x + t, py = y + i * 16 + Math.sin(t / 14) * 5;
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The trip photo as a tilted print, held on with two strips of pastel tape. */
function drawTapedPhoto(ctx, photo, x, y, w, h, tiltDeg) {
  const border = 16;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((tiltDeg * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = "rgba(74,44,68,0.22)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#FFFDFA";
  ctx.fillRect(-border, -border, w + border * 2, h + border * 2 + 22);
  ctx.shadowColor = "transparent";
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  drawAspectFill(ctx, photo, { x: 0, y: 0, width: w, height: h });
  ctx.restore();
  tape(ctx, w * 0.5 - 60, -border - 14, 120, 34, -3, "rgba(242,190,165,0.72)");
  tape(ctx, w - 50, h - 6, 96, 30, 38, "rgba(190,225,205,0.72)");
  ctx.restore();
}

function tape(ctx, x, y, w, h, tiltDeg, colour) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((tiltDeg * Math.PI) / 180);
  ctx.beginPath();
  const teeth = 6;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 0; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? -4 : 0), -h / 2 + (h * i) / teeth);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = teeth; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? 4 : 0), -h / 2 + (h * i) / teeth);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

/** Title in Fredoka, slightly tilted, with a peach brush underline. Returns the y below. */
function drawTitle(ctx, text, x, y, width, size, tiltDeg, maxLines = 2) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((tiltDeg * Math.PI) / 180);
  ctx.font = `italic 500 ${size * 1.08}px "Cormorant Garamond", Georgia, serif`;
  ctx.fillStyle = INK;
  const end = wrapText(ctx, text, 0, 0, width, lineHeight(size), maxLines);
  const lastWidth = Math.min(width, ctx.measureText(text).width) * 0.7;
  ctx.strokeStyle = "rgba(238,147,114,0.75)";
  ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(size * 0.1, end + 4);
  ctx.quadraticCurveTo(lastWidth * 0.5, end - 2, lastWidth, end + 6);
  ctx.stroke();
  ctx.restore();
  return y + end + 24;
}

/** A small peach pin, then the places. */
function drawPlaces(ctx, text, x, y, width, size, maxLines) {
  ctx.font = brandFont(size, true);
  ctx.fillStyle = INK;
  drawPin(ctx, x + 12, y + size * 0.95, 15, false);
  return wrapText(ctx, text, x + 36, y, width - 36, lineHeight(size) + 6, maxLines);
}

function drawMeta(ctx, lines, x, y, width, size) {
  ctx.font = brandFont(size);
  ctx.fillStyle = INK2;
  return wrapText(ctx, lines.join("  ·  "), x, y, width, lineHeight(size) + 4, 2);
}

function drawFooter(ctx, x, y) {
  ctx.save();
  const center = x + 52;
  if (logoArt) ctx.drawImage(logoArt, center - 48, y - 66, 96, 96);
  ctx.font = titleFont(30);
  ctx.fillStyle = INK2;
  ctx.textAlign = "center";
  ctx.fillText("Imhere", center, y + 30);
  ctx.restore();
}

function sparkleAt(ctx, cx, cy, r, colour) {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.18, cy - r * 0.18, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * 0.18, cy + r * 0.18, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.18, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * 0.18, cy - r * 0.18, cx, cy - r);
  ctx.fill();
  ctx.restore();
}

/** A little painted sprig with two blossoms (bottom corner decoration). */
function drawSprig(ctx, x, y, s) {
  if (flowerArt) { ctx.drawImage(flowerArt, x - 34*s, y - 18*s, 150*s, 205*s); return; }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = "#9CC59E"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 150); ctx.quadraticCurveTo(40, 90, 110, 20); ctx.stroke();
  const leaf = (lx, ly, a) => { ctx.fillStyle = "rgba(169,209,168,0.85)"; ctx.beginPath();
    ctx.ellipse(lx, ly, 18, 8, a, 0, Math.PI * 2); ctx.fill(); };
  leaf(30, 112, -0.2); leaf(52, 90, 1.1); leaf(70, 66, -0.3); leaf(92, 42, 1.0);
  const blossom = (bx, by, r) => {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2;
      ctx.fillStyle = "rgba(246,190,168,0.9)"; ctx.beginPath();
      ctx.ellipse(bx + Math.cos(a) * r, by + Math.sin(a) * r, r, r * 0.65, a, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#F2C46D"; ctx.beginPath(); ctx.arc(bx, by, r * 0.45, 0, Math.PI * 2); ctx.fill();
  };
  blossom(112, 18, 12); blossom(20, 128, 9);
  ctx.restore();
}

function roundedRect(ctx, frame, radius) {
  const { x, y, width, height } = frame;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawAspectFill(ctx, image, frame) {
  const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  ctx.drawImage(image,
    frame.x + frame.width / 2 - width / 2,
    frame.y + frame.height / 2 - height / 2,
    width, height);
}

/** Wrap onto at most maxLines lines; "…" if it doesn't fit. Returns the y below. */
function wrapText(ctx, text, x, y, maxWidth, step, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + " …").width > maxWidth) last = last.split(" ").slice(0, -1).join(" ");
    lines[maxLines - 1] = (last || lines[maxLines - 1]) + " …";
  }
  lines.forEach((text, i) => ctx.fillText(text, x, y + i * step));
  return y + lines.length * step;
}

/** "12 Jul – 17 Jul 2026" from departure (or first check-in) to the latest. */
function dateRange(origin, checkIns) {
  const start = origin?.departure_at || checkIns[0]?.created_at;
  const end = checkIns[checkIns.length - 1]?.created_at;
  if (!start || !end) return "";
  const from = new Date(start).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const to = new Date(end).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", year: "numeric" });
  return from === to.slice(0, from.length) ? to : `${from} – ${to}`;
}

/** Turn the finished canvas into a file the browser can save. */
export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
