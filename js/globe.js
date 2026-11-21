import { loadWorldArt } from "./world-art.js";
// ---------------------------------------------------------------
// The check-in globe. One module for My Earth and the friend view.
//
//   const globe = await mountGlobe(container, { onPinTap, onClusterList });
//   globe.show({ checkIns, origins, tripID, person });
//   globe.flyTo(lat, lon);  globe.destroy();
//
// Built on globe.gl (vendored, MIT; it already contains three.js).
// The look is painted here, in the browser, from data/countries-50m.json:
// a watercolour texture for the sea and the soft land colour, and a crisp
// country layer on top so coastlines still hold up at city zoom.
// No map tiles and no image files, so it works offline once loaded.
// ---------------------------------------------------------------
import { cityOnly, staleness, mapCountry } from "./ui.js";

// ---- palette (matches app.css) ----
const SEA = "#94D5EF";
// Mint, cream, peach and lavender washes for the land.
const LAND = ["#C7E5AF", "#FFF0BE", "#FFC6AF", "#DBC0DF", "#D8E8AF", "#FFE5BE"];
const VISITED = "#FFB6A0";
const PEACH = "#EE9372";       // pins and the route's warm end
const INK = "#4A2C44";
const PAPER = "#FFFDFA";

// ---- zoom limits, in globe radii above the surface ----
// 0.045 ≈ a city and its surroundings. It never goes to street level.
const ALT_MIN = 0.045;
const ALT_MAX = 2.6;
const ALT_HOME = 1.75;
const CLUSTER_PX = 30;          // pins closer than this on screen merge
const IDLE_RESUME_MS = 8000;    // auto-rotation comes back after this

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// ============================================================ loading

let libraryPromise = null;
/** globe.gl is ~1.9 MB, so it only loads when a globe is first shown. */
function loadLibrary() {
  if (window.Globe) return Promise.resolve(window.Globe);
  libraryPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/globe.gl.min.js";
    script.onload = () => window.Globe ? resolve(window.Globe)
      : reject(new Error("The globe library loaded but didn't start."));
    script.onerror = () => { libraryPromise = null;
      reject(new Error("Couldn't load the globe (vendor/globe.gl.min.js).")); };
    document.head.append(script);
  });
  return libraryPromise;
}

let countriesPromise = null;
export function loadCountries50() {
  countriesPromise ||= fetch("data/countries-50m.json").then((response) => {
    if (!response.ok) throw new Error("Couldn't load the country outlines.");
    return response.json();
  }).catch((error) => { countriesPromise = null; throw error; });
  return countriesPromise;
}

/** Ring data → GeoJSON features, one MultiPolygon per country code. */
function toFeatures(countries) {
  const byCode = new Map();
  for (const ring of countries.rings) {
    // Antarctica's outline wraps the pole and breaks the 3D shape builder;
    // the painted texture already shows it, and nobody checks in there.
    if (ring.c === "AQ") continue;
    const coords = [];
    for (let i = 0; i < ring.p.length; i += 2) coords.push([ring.p[i], ring.p[i + 1]]);
    if (coords.length < 4) continue;
    const first = coords[0], last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
    if (!byCode.has(ring.c)) byCode.set(ring.c, []);
    byCode.get(ring.c).push([coords]);
  }
  return [...byCode].map(([code, polygons]) => ({
    type: "Feature", properties: { code },
    geometry: { type: "MultiPolygon", coordinates: polygons },
  }));
}

const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const landColour = (code) => LAND[hash(code) % LAND.length];

// ============================================================ texture

/** A seeded random so the watercolour looks the same on every visit. */
function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Paint the sea and land as a watercolour wash (equirectangular). */
function paintTexture(countries, visited, paper) {
  const W = 2048, H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const random = seeded(11);
  const X = (lon) => ((lon + 180) / 360) * W;
  const Y = (lat) => ((90 - lat) / 180) * H;

  // Sea: a base wash, then hundreds of faint blooms of lighter and deeper blue.
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 420; i++) {
    const x = random() * W, y = random() * H, r = 20 + random() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = random() > 0.5 ? "255,255,255" : "130,185,210";
    g.addColorStop(0, `rgba(${tone},${0.05 + random() * 0.07})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // One path per ring, built once. Filters (blur) are applied to ONE combined
  // path, never per country — a blur per fill froze phones for a minute.
  const pathOf = (ring, dx = 0, dy = 0, into = new Path2D()) => {
    for (let i = 0; i < ring.p.length; i += 2) {
      const x = X(ring.p[i]) + dx, y = Y(ring.p[i + 1]) + dy;
      if (i === 0) into.moveTo(x, y); else into.lineTo(x, y);
    }
    into.closePath();
    return into;
  };
  // Rings that cross the date line run past 180° (e.g. Fiji, eastern Russia);
  // draw those a second time one map-width to the left so both edges are painted.
  const wraps = (ring) => { for (let i = 0; i < ring.p.length; i += 2) if (ring.p[i] > 180) return true; return false; };
  const copies = countries.rings.flatMap((ring) => wraps(ring) ? [[ring, 0], [ring, -W]] : [[ring, 0]]);
  const all = new Path2D(), allShifted = new Path2D();
  for (const [ring, dx] of copies) { pathOf(ring, dx, 0, all); pathOf(ring, dx + 1.5, 1.5, allShifted); }

  // Land: a soft, slightly offset under-wash (the bleed), then the colour,
  // then a darker pigment edge — the three things that make paint read as paint.
  ctx.save();
  ctx.filter = "blur(3px)";
  ctx.fillStyle = "rgba(200,175,160,0.30)";
  ctx.fill(allShifted);
  ctx.restore();
  for (const [ring, dx] of copies) {
    ctx.fillStyle = visited.has(ring.c) ? VISITED : landColour(ring.c);
    ctx.fill(pathOf(ring, dx));
  }
  ctx.save();
  ctx.filter = "blur(1.2px)";
  ctx.strokeStyle = "rgba(170,135,120,0.30)";
  ctx.lineWidth = 1.4;
  ctx.stroke(all);
  ctx.restore();

  // Layer translucent pigment blooms inside the land silhouette. Clipping
  // once preserves the geographic outlines and avoids per-country filters.
  ctx.save();
  ctx.clip(all);
  for (let i = 0; i < 1800; i++) {
    const x = random() * W, y = random() * H, r = 4 + random() * 32;
    const bloom = ctx.createRadialGradient(x, y, r * .25, x, y, r);
    const pigment = random() > .48 ? "255,253,242" : "117,153,119";
    bloom.addColorStop(0, `rgba(${pigment},${.05 + random() * .14})`);
    bloom.addColorStop(.65, `rgba(${pigment},.035)`);
    bloom.addColorStop(1, `rgba(${pigment},0)`);
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Illustrated relief along major ranges, clipped to the real land shapes.
  ctx.save(); ctx.clip(all);
  const ranges = [ [[70,36],[80,31],[90,29],[100,30]], [[44,43],[52,36]],
    [[8,46],[18,46]], [[-125,53],[-112,40],[-105,31]], [[-76,5],[-71,-19],[-70,-44]] ];
  for (const points of ranges) {
    for (let j = 1; j < points.length; j++) {
      const [a,b] = [points[j-1],points[j]];
      for (let t = 0; t < 1; t += .12) {
        const x = X(a[0]+(b[0]-a[0])*t), y = Y(a[1]+(b[1]-a[1])*t);
        const w = 5+random()*10, h = 6+random()*12;
        ctx.fillStyle = "rgba(153,121,143,.24)";
        ctx.beginPath(); ctx.moveTo(x-w,y+4); ctx.lineTo(x,y-h);
        ctx.lineTo(x+w,y+4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,251,230,.44)";
        ctx.beginPath(); ctx.moveTo(x-w,y+4); ctx.lineTo(x,y-h);
        ctx.lineTo(x-1,y+4); ctx.closePath(); ctx.fill();
      }
    }
  }
  ctx.restore();
  if (paper) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = .24;
    // Mirror at the join to avoid a hard seam on the rotating sphere.
    ctx.drawImage(paper, 0, 0, W / 2, H);
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(paper, 0, 0, W / 2, H);
    ctx.restore();
  }
  // Paper speckle over everything.
  const speckle = ctx.getImageData(0, 0, W, H);
  const d = speckle.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() - 0.5) * 10;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(speckle, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// ============================================================ pins

const PIN_SVG = (fill, stroke, hole) => `
<svg viewBox="0 0 24 34" width="24" height="34" aria-hidden="true">
  <path d="M12 33C12 33 2 20.5 2 12.5A10 10 0 0 1 22 12.5C22 20.5 12 33 12 33Z"
        fill="${fill}" stroke="${stroke}" stroke-width="2"/>
  <circle cx="12" cy="12.5" r="3.6" fill="${hole}"/>
</svg>`;

function initials(name) {
  const letters = String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("");
  return (letters || "?").slice(0, 2).toUpperCase();
}

function makePinElement(item, handlers) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `globe-pin globe-pin--${item.kind}`;
  if (item.kind === "cluster") {
    node.setAttribute("aria-label", `${item.members.length} check-ins here — zoom in`);
    const latest = item.members.find((m) => m.kind === "latest");
    if (latest) {
      // The cluster holding your latest check-in shows your face, with the count.
      node.className = "globe-pin globe-pin--latest globe-pin--with-count";
      const face = document.createElement("span");
      face.className = "globe-pin__face";
      if (latest.avatarURL) {
        const image = document.createElement("img");
        image.src = latest.avatarURL; image.alt = "";
        face.append(image);
      } else face.textContent = initials(latest.personName);
      const count = document.createElement("span");
      count.className = "globe-pin__count";
      count.textContent = String(item.members.length);
      node.append(face, count);
    } else node.textContent = String(item.members.length);
  } else if (item.kind === "latest") {
    const face = document.createElement("span");
    face.className = "globe-pin__face";
    if (item.avatarURL) {
      const image = document.createElement("img");
      image.src = item.avatarURL; image.alt = "";
      face.append(image);
    } else face.textContent = initials(item.personName);
    node.append(face);
    node.setAttribute("aria-label", `Latest: ${cityOnly(item.checkIn.place_name)}, ${staleness(item.checkIn.created_at)}`);
  } else if (item.kind === "origin") {
    node.innerHTML = PIN_SVG(PAPER, INK, INK);
    node.setAttribute("aria-label", `Trip start: ${cityOnly(item.origin.name)}`);
  } else {
    node.innerHTML = PIN_SVG(PEACH, PAPER, PAPER);
    node.setAttribute("aria-label", `${cityOnly(item.checkIn.place_name)}, ${staleness(item.checkIn.created_at)}`);
  }
  if (item.fresh && !reducedMotion()) node.classList.add("globe-pin--bloom");
  // Stop the drag-to-spin from swallowing the tap.
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("click", (event) => { event.stopPropagation(); handlers.tap(item); });
  return node;
}

// ============================================================ mount

export async function mountGlobe(container, { onPinTap = () => {}, onClusterList = () => {} } = {}) {
  const [Globe, countries] = await Promise.all([loadLibrary(), loadCountries50()]);
  const paper = await new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = "assets/watercolor-paper.png";
  });
  const worldArt = await loadWorldArt();
  const features = toFeatures(countries);

  container.classList.add("globe-pane");
  const stage = document.createElement("div");
  stage.className = "globe-stage";
  const glow = document.createElement("div");
  glow.className = "globe-glow";
  const grain = document.createElement("div");
  grain.className = "globe-grain";
  container.replaceChildren(glow, stage, grain);

  const globe = Globe({ animateIn: false,
                        rendererConfig: { antialias: true, alpha: true, powerPreference: "low-power" } })(stage)
    .backgroundColor("rgba(0,0,0,0)")
    .showAtmosphere(true)
    .atmosphereColor("#BFE6F7")
    .atmosphereAltitude(0.035)
    .polygonsData(features)
    .polygonGeoJsonGeometry((f) => f.geometry)
    .polygonAltitude(0.0025)
    .polygonSideColor(() => "rgba(0,0,0,0)")
    .polygonStrokeColor(() => "rgba(0,0,0,0)")
    .polygonsTransitionDuration(0)
    // Fine curved routes: thin arcs lifted off the surface, white to peach.
    .arcStartLat((a) => a.from[0]).arcStartLng((a) => a.from[1])
    .arcEndLat((a) => a.to[0]).arcEndLng((a) => a.to[1])
    .arcColor(() => ["rgba(255,255,255,0.95)", "rgba(238,147,114,0.95)"])
    .arcStroke(0.45)
    .arcAltitudeAutoScale(0.28)
    .arcDashLength(0.06)
    .arcDashGap(0.025)
    .arcDashAnimateTime(0)
    .arcsTransitionDuration(0)
    // Live sharing: the trail as a thin peach path, and a soft ring where
    // the person was last seen. Separate layers, so pins are untouched.
    .pathPoints((p) => p.points)
    .pathPointLat((pt) => pt[0]).pathPointLng((pt) => pt[1]).pathPointAlt(() => 0.003)
    .pathColor(() => ["rgba(238,147,114,0.35)", "rgba(238,147,114,1)"])
    .pathStroke(1.4)
    .pathTransitionDuration(0)
    .ringLat((r) => r.lat).ringLng((r) => r.lon)
    .ringColor(() => (t) => `rgba(125,98,196,${Math.max(0, 1 - t)})`)
    .ringMaxRadius(0.9).ringPropagationSpeed(0.7).ringRepeatPeriod(1600)
    .htmlLat((d) => d.lat)
    .htmlLng((d) => d.lon)
    .htmlAltitude(0.004)
    .htmlTransitionDuration(0)
    .htmlElementVisibilityModifier((node, visible) => {
      node.style.opacity = visible ? "" : "0";
      node.style.pointerEvents = visible ? "" : "none";
    });

  // Paper, not glass: no shine, and the painted texture glows a little on
  // its own so the scene lighting doesn't turn the pastels grey.
  globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
  globe.lights([]); // Even pigment colors, without gray directional shadows.
  const material = globe.globeMaterial();
  material.shininess = 0;
  const brighten = () => {
    if (!material.map) return false;
    material.map.anisotropy = Math.min(16, globe.renderer().capabilities.getMaxAnisotropy());
    material.map.needsUpdate = true;
    material.emissiveMap = material.map;
    material.emissive?.set?.("#ffffff");
    material.emissiveIntensity = 1.0;

    material.needsUpdate = true;
    return true;
  };
  let brightenTimer = null;
  const scheduleBrighten = (previous) => {
    clearInterval(brightenTimer);
    brightenTimer = setInterval(() => {
      if (material.map && material.map !== previous && brighten()) clearInterval(brightenTimer);
    }, 100);
    setTimeout(() => clearInterval(brightenTimer), 8000);
  };

  const controls = globe.controls();
  controls.enablePan = false;
  controls.minDistance = 100 * (1 + ALT_MIN);
  controls.maxDistance = 100 * (1 + ALT_MAX);
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.6;

  // ---- size follows the pane ----
  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (width && height) globe.width(width).height(height);
  };
  const sizeObserver = new ResizeObserver(() => { resize(); updateGlow(globe.pointOfView().altitude); });
  sizeObserver.observe(container);
  resize();

  // ---- idle auto-rotation, stops on touch ----
  let idleTimer = null;
  const setRotating = (on) => { controls.autoRotate = on && !reducedMotion(); controls.autoRotateSpeed = 0.35; };
  controls.addEventListener("start", () => { setRotating(false); clearTimeout(idleTimer); });
  controls.addEventListener("end", () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setRotating(true), IDLE_RESUME_MS);
  });
  setRotating(true);

  // ---- pause when nobody can see it ----
  let onScreen = true;
  const updateRunning = () => {
    if (onScreen && document.visibilityState === "visible") globe.resumeAnimation();
    else globe.pauseAnimation();
  };
  const viewObserver = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; updateRunning(); });
  viewObserver.observe(container);
  document.addEventListener("visibilitychange", updateRunning);

  // ---- state ----
  let state = { items: [], visited: new Set(), textureKey: null };
  const seen = new Set();          // check-in ids already drawn once (for the bloom)

  const fly = (lat, lon, altitude, ms = 900) =>
    globe.pointOfView({ lat, lng: lon, altitude: Math.min(ALT_MAX, Math.max(ALT_MIN, altitude)) },
                      reducedMotion() ? 0 : ms);

  // The thin cyan-and-lavender rim hugs the globe's edge: work out the
  // globe's radius on screen from the camera, so the rim always fits.
  const screenRadius = (altitude) => {
    const camera = globe.camera();
    const height = container.getBoundingClientRect().height || 1;
    const d = 1 + altitude;                       // camera distance in globe radii
    return (height / 2) / Math.tan((camera.fov * Math.PI) / 360) / Math.sqrt(d * d - 1);
  };
  const updateGlow = (altitude) => {
    const r = screenRadius(altitude);
    glow.style.width = `${Math.round(r * 2 + 10)}px`;
    glow.style.opacity = String(Math.max(0, Math.min(1, (altitude - 0.35) / 0.8)));
  };

  // ---- country layer ----
  // Far away, the painted texture carries the land and the vector layer only
  // draws the thin borders. Close up, the texture is too soft, so the vector
  // shapes turn solid and keep the coastline crisp. (Semi-transparent caps
  // show their triangles, so it's all or nothing.)
  let capMode = "";
  function updateCaps(altitude) {
    const mode = altitude < 0.2 ? "solid" : "clear";
    if (mode === capMode) return;
    capMode = mode;
    globe.polygonCapColor(mode === "clear"
      ? () => "rgba(0,0,0,0)"
      : (f) => state.visited.has(f.properties.code) ? VISITED : landColour(f.properties.code));
  }

  // ---- clustering: merge pins that overlap on screen at this zoom ----
  function clustered() {
    const placed = [];
    for (const item of state.items) {
      const screen = globe.getScreenCoords(item.lat, item.lon, 0);
      // The trip's start is drawn on its own (it often shares a spot with a check-in).
      if (item.kind === "origin") { placed.push({ ...item, screen }); continue; }
      const hit = placed.find((p) => p.kind !== "origin" && p.screen && screen &&
        Math.hypot(p.screen.x - screen.x, p.screen.y - screen.y) < CLUSTER_PX);
      if (hit) {
        if (hit.kind !== "cluster") {
          const first = { ...hit };
          Object.assign(hit, { kind: "cluster", members: [first], id: "cluster-" + first.id });
        }
        hit.members.push(item);
        if (item.kind === "latest") hit.hasLatest = true;
      } else placed.push({ ...item, screen });
    }
    return placed;
  }

  let lastSignature = "";
  function redrawPins() {
    const list = clustered();
    const signature = list.map((p) => p.id + (p.members ? ":" + p.members.length : "")).join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;
    globe.htmlElementsData(list).htmlElement((item) => makePinElement(item, { tap }));
    for (const item of state.items) if (item.checkIn) seen.add(item.checkIn.id);
    state.items.forEach((item) => { item.fresh = false; });
  }

  const moveListeners = [];
  let zoomFrame = 0;
  globe.onZoom((pov) => {
    moveListeners.forEach((listener) => listener(pov));
    updateGlow(pov.altitude);
    updateCaps(pov.altitude);
    cancelAnimationFrame(zoomFrame);
    zoomFrame = requestAnimationFrame(redrawPins);
  });

  function tap(item) {
    if (item.kind !== "cluster") { onPinTap(item); return; }
    const pov = globe.pointOfView();
    const lat = item.members.reduce((s, m) => s + m.lat, 0) / item.members.length;
    const lon = item.members.reduce((s, m) => s + m.lon, 0) / item.members.length;
    if (pov.altitude <= ALT_MIN * 1.05) { onClusterList(item.members); return; }
    // Zoom in far enough that the members' spread fills about a third of the view.
    let spread = 0;
    for (const a of item.members) for (const b of item.members) {
      spread = Math.max(spread, Math.hypot(a.lat - b.lat, a.lon - b.lon));
    }
    const target = Math.max(ALT_MIN, Math.min(pov.altitude * 0.35, spread / 12));
    fly(lat, lon, target);
  }

  // ============================================================ public

  function show({ checkIns = [], origins = [], tripID = null, person = {} } = {}) {
    // Visited = every country with a check-in (the origin doesn't count).
    const visited = new Set(checkIns.map((c) => mapCountry(c.country_code)).filter(Boolean));
    const key = [...visited].sort().join(",");
    if (key !== state.textureKey) {
      const previous = material.map;
      globe.globeImageUrl(worldArt.toDataURL("image/png"));
      scheduleBrighten(previous);
      state.textureKey = key;
    }
    state.visited = visited;
    capMode = "";
    updateCaps(globe.pointOfView().altitude);

    const chronological = [...checkIns].reverse();           // oldest first
    const currentTrip = tripID ?? checkIns[0]?.trip_id ?? null;
    const origin = origins.find((o) => o.trip_id === currentTrip) || null;
    const latestID = checkIns[0]?.id;
    const items = [];
    if (origin) items.push({ id: "origin-" + origin.trip_id, kind: "origin",
      lat: origin.latitude, lon: origin.longitude, origin });
    for (const checkIn of chronological) {
      items.push({
        id: checkIn.id, lat: checkIn.latitude, lon: checkIn.longitude, checkIn,
        kind: checkIn.id === latestID ? "latest" : "pin",
        personName: person.name, avatarURL: person.avatarURL,
        fresh: seen.size > 0 && !seen.has(checkIn.id),
      });
    }
    // Latest last, so it sits on top and wins a cluster's face.
    items.sort((a, b) => (a.kind === "latest") - (b.kind === "latest"));
    state.items = items;
    state.visited = visited;

    // Route: origin → stops of the current trip, in time order.
    const route = [];
    if (origin) route.push([origin.latitude, origin.longitude]);
    for (const c of chronological) if (!currentTrip || c.trip_id === currentTrip) route.push([c.latitude, c.longitude]);
    const arcs = [];
    for (let i = 1; i < route.length; i++) arcs.push({ from: route[i - 1], to: route[i] });
    globe.arcsData(arcs);

    lastSignature = "";
    redrawPins();
    const latest = checkIns[0];
    if (latest) fly(latest.latitude, latest.longitude, ALT_HOME, 0);
    else globe.pointOfView({ lat: 22.3, lng: 114.2, altitude: ALT_HOME }, 0);
    updateGlow(globe.pointOfView().altitude);
    setTimeout(redrawPins, 50);
  }

  function destroy() {
    clearTimeout(idleTimer);
    sizeObserver.disconnect();
    viewObserver.disconnect();
    document.removeEventListener("visibilitychange", updateRunning);
    globe.pauseAnimation();
    try { globe._destructor?.(); } catch { /* best effort */ }
    container.replaceChildren();
  }

  /** Live trail + last-seen ring (both optional). */
  function showLive({ trail = [], lastSeen = null } = {}) {
    const points = trail.map((p) => [p.latitude, p.longitude]);
    globe.pathsData(points.length > 1 ? [{ points }] : []);
    const head = trail.at(-1) || lastSeen;
    globe.ringsData(head && !reducedMotion() ? [{ lat: head.latitude, lon: head.longitude }] : []);
  }

  return {
    show,
    showLive,
    destroy,
    flyTo: (lat, lon, altitude = 0.35) => { setRotating(false); fly(lat, lon, altitude); },
    flyToTrip(points) {
      if (!points.length) return;
      const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
      let spread = 0;
      for (const p of points) spread = Math.max(spread, Math.hypot(p.lat - lat, p.lon - lon));
      setRotating(false);
      fly(lat, lon, Math.max(0.35, Math.min(ALT_MAX, spread / 18)));
    },
    /** For tests: the camera's current altitude. */
    altitude: () => globe.pointOfView().altitude,
    /** Where a place is on screen (px in the pane), and whether it's on the near side. */
    screenOf(lat, lon) {
      const point = globe.getScreenCoords(lat, lon, 0.004);
      const pov = globe.pointOfView();
      const rad = Math.PI / 180;
      const v = (la, lo) => [Math.cos(la * rad) * Math.cos(lo * rad), Math.cos(la * rad) * Math.sin(lo * rad), Math.sin(la * rad)];
      const a = v(pov.lat, pov.lng), b = v(lat, lon);
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return { x: point.x, y: point.y, visible: dot > 1 / (1 + pov.altitude) };
    },
    /** Call on every camera move (used by the floating cards). */
    onMove(callback) { moveListeners.push(callback); },
    limits: { min: ALT_MIN, max: ALT_MAX },
    instance: globe,
  };
}
