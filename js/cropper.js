// ---------------------------------------------------------------
// Photo cropper. Drag to move, pinch / slider / scroll to zoom, rotate
// in quarter turns.
//
//   const blob = await cropAvatar(file);              // 400×400, round guide
//   const blob = await cropImage(file, { aspect });   // any shape
// Both return null if cancelled.
// ---------------------------------------------------------------
import { el, openSheet, closeSheet, onSheetClose, stashSheet, icon } from "./ui.js";

const OUT = 400;           // saved size (px)
const MAX_SOURCE = 2000;   // big photos are reduced first: faster, less memory
const MAX_ZOOM = 5;

async function loadSource(file, quarterTurns = 0) {
  const bitmap = await createImageBitmap(file);   // respects the photo's orientation
  const shrink = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * shrink), h = Math.round(bitmap.height * shrink);
  const turned = quarterTurns % 2 === 1;
  const canvas = document.createElement("canvas");
  canvas.width = turned ? h : w;
  canvas.height = turned ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close?.();
  return canvas;
}

export function cropAvatar(file) {
  return cropImage(file, { aspect: 1, round: true, outWidth: OUT, title: "Crop your photo",
    hint: "Drag to move. Pinch, scroll or use the slider to zoom. What's inside the circle is what your circle sees." });
}

/**
 * Crop to a rectangle of the given aspect (width / height).
 * round: show a circle guide (profile pictures). outWidth: saved width in px.
 */
export function cropImage(file, { aspect = 1, round = false, outWidth = 1200, title = "Crop photo",
                                  hint = "Drag to move. Pinch, scroll or use the slider to zoom." } = {}) {
  return new Promise(async (resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    let turns = 0;
    let source;
    try { source = await loadSource(file, turns); }
    catch { finish(null); return; }
    // If a sheet is open (e.g. the postcard editor), set it aside and bring
    // it back when cropping is done.
    const restore = stashSheet();

    // The crop window: as wide as fits, but never taller than 380 px.
    let viewW = Math.min(320, window.innerWidth - 64);
    let viewH = viewW / aspect;
    if (viewH > 380) { viewH = 380; viewW = viewH * aspect; }
    viewW = Math.round(viewW); viewH = Math.round(viewH);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = el("canvas", { class: "crop-canvas", width: String(viewW * dpr), height: String(viewH * dpr),
      style: `width:${viewW}px;height:${viewH}px`, tabindex: "0",
      "aria-label": "Photo crop area. Drag or use arrow keys to move, plus and minus to zoom." });
    const ctx = canvas.getContext("2d");

    // State: zoom (1 = the photo just covers the window) and the centre point
    // of the window, in source-image pixels.
    let zoom = 1, cx = source.width / 2, cy = source.height / 2;
    const base = () => Math.max(viewW / source.width, viewH / source.height);
    const halfW = () => viewW / (2 * base() * zoom);               // half the window, in image px
    const halfH = () => viewH / (2 * base() * zoom);
    const clamp = () => {
      cx = Math.min(source.width - halfW(), Math.max(halfW(), cx));
      cy = Math.min(source.height - halfH(), Math.max(halfH(), cy));
    };

    function draw() {
      clamp();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, cx - halfW(), cy - halfH(), 2 * halfW(), 2 * halfH(), 0, 0, viewW, viewH);
      if (!round) return;
      // Dim everything outside the circle, then a thin white ring.
      const r = Math.min(viewW, viewH) / 2 - 2;
      ctx.fillStyle = "rgba(74,44,68,.5)";
      ctx.beginPath();
      ctx.rect(0, 0, viewW, viewH);
      ctx.arc(viewW / 2, viewH / 2, r, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(viewW / 2, viewH / 2, r, 0, Math.PI * 2); ctx.stroke();
    }

    const setZoom = (next, anchorX = viewW / 2, anchorY = viewH / 2) => {
      // Keep the point under the finger/cursor still while zooming.
      const before = base() * zoom;
      const ix = cx - halfW() + anchorX / before, iy = cy - halfH() + anchorY / before;
      zoom = Math.min(MAX_ZOOM, Math.max(1, next));
      const after = base() * zoom;
      cx = ix - anchorX / after + halfW();
      cy = iy - anchorY / after + halfH();
      slider.value = String(zoom);
      draw();
    };

    // ---- pointer: one finger pans, two fingers pinch ----
    const pointers = new Map();
    let pinch = null;
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const now = { x: event.offsetX, y: event.offsetY };
      pointers.set(event.pointerId, now);
      if (pointers.size === 1) {
        const scale = base() * zoom;
        cx -= (now.x - last.x) / scale;
        cy -= (now.y - last.y) / scale;
        draw();
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        setZoom(pinch.zoom * (distance / pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    });
    const lift = (event) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; };
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      setZoom(zoom * Math.exp(-event.deltaY * 0.0015), event.offsetX, event.offsetY);
    }, { passive: false });
    canvas.addEventListener("keydown", (event) => {
      const step = 12 / (base() * zoom);
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) { cx += moves[event.key][0]; cy += moves[event.key][1]; draw(); event.preventDefault(); }
      else if (event.key === "+" || event.key === "=") { setZoom(zoom * 1.15); event.preventDefault(); }
      else if (event.key === "-") { setZoom(zoom / 1.15); event.preventDefault(); }
    });

    const slider = el("input", { type: "range", min: "1", max: String(MAX_ZOOM), step: "0.01", value: "1",
      "aria-label": "Zoom", class: "crop-zoom" });
    slider.addEventListener("input", () => setZoom(Number(slider.value)));

    const rotate = el("button", { class: "secondary", type: "button", style: "width:auto" }, "Rotate");
    rotate.onclick = async () => {
      turns = (turns + 1) % 4;
      rotate.disabled = true;
      source = await loadSource(file, turns);
      zoom = 1; slider.value = "1"; cx = source.width / 2; cy = source.height / 2;
      draw();
      rotate.disabled = false;
    };

    const save = el("button", { class: "primary", type: "button" }, "Use this photo");
    save.onclick = () => {
      clamp();
      const out = document.createElement("canvas");
      // Never enlarge: a small crop of a small photo stays its real size.
      out.width = Math.round(Math.min(outWidth, 2 * halfW()));
      out.height = Math.round(out.width / aspect);
      const octx = out.getContext("2d");
      octx.imageSmoothingQuality = "high";
      octx.drawImage(source, cx - halfW(), cy - halfH(), 2 * halfW(), 2 * halfH(), 0, 0, out.width, out.height);
      out.toBlob((blob) => { finish(blob); closeSheet(); }, "image/jpeg", 0.86);
    };
    const cancel = el("button", { class: "ghost", type: "button" }, "Cancel");
    cancel.onclick = () => { finish(null); closeSheet(); };

    openSheet(title,
      el("p", { class: "dim", style: "margin-bottom:var(--s3)" }, hint),
      el("div", { class: "crop-stage" }, canvas),
      el("div", { class: "crop-controls" },
        el("span", { "aria-hidden": "true", class: "dim" }, "−"), slider, el("span", { "aria-hidden": "true", class: "dim" }, "+"), rotate),
      el("div", { class: "stack", style: "margin-top:var(--s4)" }, save, cancel));
    onSheetClose(() => { finish(null); restore?.(); });
    draw();
    setTimeout(() => canvas.focus({ preventScroll: true }), 60);
  });
}
