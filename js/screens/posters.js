// ---------------------------------------------------------------
// Field-notes posters.
//
// TWO WAYS to get the stamp, and the free one is the default:
//
//  1. Make it yourself (free). Copy the prompt, paste it into whatever
//     chat app you already have — the same place this style came from —
//     with your photo attached, save the square image, upload it here.
//     No API key, no bill, and it works for ANY check-in because the
//     stamp never has to come off the server.
//
//  2. Generate automatically (paid). One tap, but every tap costs a few
//     cents and needs the Edge Function and a billed key. Hidden until
//     AI_GENERATION_ENABLED is turned on in config.js.
//
// Either way the poster itself — paper, layout, caption — is drawn here.
// ---------------------------------------------------------------
import { el, fill, toast, openSheet, closeSheet, confirmSheet, cityOnly, flagEmoji,
         staleness, icon } from "../ui.js";
import { AI_GENERATION_ENABLED } from "../config.js";
import * as data from "../db.js";
import { fillReactions } from "../reactions.js";

/** The only check-in the SERVER can generate from: photos are ephemeral, so
 *  every older check-in's photo_path now points at the newest picture. */
export function posterSource(checkIns) {
  return checkIns.find((checkIn) => checkIn.photo_path) || null;
}

// ============================================================ the sheet

// Posters are viewed on phones: 1920 px on the long side is already more
// than a phone screen shows. A 4K upload is scaled down to that, and saved
// as JPEG (a few hundred KB instead of 10+ MB). Re-drawing also drops the
// file's hidden metadata (camera, GPS position).
const POSTER_MAX_SIDE = 1920;
const POSTER_QUALITY = 0.88;

function posterToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't prepare the poster."))),
    "image/jpeg", POSTER_QUALITY));
}


export async function openPosterSheet(checkIns, onSaved = () => {}) {
  let checkIn = checkIns[0];
  const generatable = posterSource(checkIns);

  const preview = el("img", { class: "postcard-preview hidden" });
  const status = el("p", { class: "dim", role: "status", style: "text-align:center;padding:var(--s2) 0" },
    "Pick a check-in and a style, then bring back the picture the AI makes.");

  // ---- which check-in ----
  const picker = el("select", { "aria-label": "Which check-in" });
  for (const option of checkIns) {
    picker.append(el("option", { value: option.id },
      `${cityOnly(option.place_name)} — ${staleness(option.created_at)}`));
  }
  picker.onchange = () => {
    checkIn = checkIns.find((c) => c.id === picker.value) || checkIns[0];
    if (posterImage) redraw();
    generate.disabled = !AI_GENERATION_ENABLED || checkIn.id !== generatable?.id;
  };

  let posterImage = null, posterCanvas = null, provider = null;

  /** What you uploaded IS the poster — the AI made the whole thing. */
  function redraw() {
    if (!posterImage) return;
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(posterImage.naturalWidth, posterImage.naturalHeight));
    posterCanvas = document.createElement("canvas");
    posterCanvas.width = Math.round(posterImage.naturalWidth * scale);
    posterCanvas.height = Math.round(posterImage.naturalHeight * scale);
    const ctx = posterCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";                       // JPEG has no transparency
    ctx.fillRect(0, 0, posterCanvas.width, posterCanvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(posterImage, 0, 0, posterCanvas.width, posterCanvas.height);
    preview.src = posterCanvas.toDataURL("image/jpeg", POSTER_QUALITY);
    preview.classList.remove("hidden");
    save.classList.remove("hidden");
    download.classList.remove("hidden");
  }

  // ---- free path: pick a style, copy its prompt, upload the result ----
  // Styles live in data/styles/ — a picture, a prompt and a line in
  // styles.json. Adding one needs no code change; see that folder's README.
  let chosenStyle = null;

  const styleGrid = el("div", { class: "style-grid" });
  const copy = el("button", { class: "secondary", type: "button", disabled: "disabled" },
    "Copy the prompt");

  function pickStyle(style, card) {
    chosenStyle = style;
    for (const other of styleGrid.querySelectorAll(".style-card")) {
      other.classList.remove("on"); other.setAttribute("aria-pressed", "false");
    }
    card.classList.add("on");
    card.setAttribute("aria-pressed", "true");
    copy.disabled = false;
    copy.textContent = `Copy the ${style.name} prompt`;
    // Nothing to re-render on a style change: the poster is whatever you
    // uploaded, whichever style produced it.
  }

  (async function loadStyles() {
    let styles = [];
    try {
      const response = await fetch("data/styles/styles.json");
      styles = (await response.json())?.styles || [];
    } catch { /* handled below */ }
    if (!styles.length) {
      styleGrid.append(el("p", { class: "dim" },
        "No styles yet. Add a picture, a prompt and a line in data/styles/styles.json."));
      return;
    }
    styles.forEach((style, index) => {
      // A style with no reference picture yet still works — it just shows a
      // blank plate until you make one you like and save it as <id>.jpg.
      const thumb = style.image
        ? el("img", { src: style.image, alt: style.name, loading: "lazy" })
        : el("div", { class: "style-placeholder" }, "no reference yet");
      if (style.image) {
        thumb.addEventListener("error", () =>
          thumb.replaceWith(el("div", { class: "style-placeholder" }, "no reference yet")));
      }
      const card = el("button", { class: "style-card", type: "button", "aria-pressed": "false" },
        thumb,
        el("div", { class: "meta" },
          el("div", { style: "font-weight:700" }, style.name),
          style.note ? el("div", { class: "dim" }, style.note) : null));
      card.onclick = () => pickStyle(style, card);
      styleGrid.append(card);
      if (index === 0) pickStyle(style, card);
    });
  })();

  copy.onclick = async () => {
    if (!chosenStyle) return;
    try {
      const text = await (await fetch(chosenStyle.prompt)).text();
      await navigator.clipboard.writeText(text);
      toast(`${chosenStyle.name} prompt copied — paste it with your photo`, "ok");
    } catch {
      // Clipboard is blocked in some browsers; show the text instead.
      window.open(chosenStyle.prompt, "_blank");
    }
  };

  const stampInput = el("input", { type: "file", accept: "image/*", style: "display:none" });
  const upload = el("button", { class: "primary", type: "button" }, "Upload the poster");
  const steps = el("ol", { class: "dim", style: "padding-left:1.2em;display:grid;gap:4px" },
    el("li", {}, "Choose a style and copy the prompt."),
    el("li", {}, "Paste it into your AI app with your photo. Add the place, country and year."),
    el("li", {}, "Save the poster it makes, then upload it here."));
  upload.onclick = () => stampInput.click();
  stampInput.onchange = async () => {
    const file = stampInput.files?.[0];
    if (!file) return;
    status.textContent = "Reading the image…";
    try {
      posterImage = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("That file couldn't be read as an image."));
        image.src = URL.createObjectURL(file);
      });
      provider = "manual";
      redraw();
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
    }
  };

  // ---- paid path ----
  const generate = el("button", { class: "secondary", type: "button" },
    "Generate it for me (costs money)");
  generate.disabled = !AI_GENERATION_ENABLED || checkIn.id !== generatable?.id;
  generate.onclick = async () => {
    generate.disabled = true;
    generate.textContent = "Drawing… 10–30 seconds";
    try {
      const result = await data.generateStamp(checkIn.id);
      posterImage = await imageFromBase64(result.image);
      provider = result.provider;
      redraw();
      status.textContent = typeof result.remaining === "number"
        ? `${result.remaining} generation${result.remaining === 1 ? "" : "s"} left today.` : "";
    } catch (error) {
      status.textContent = error.message;
    }
    generate.textContent = "Generate it for me (costs money)";
    generate.disabled = false;
  };

  // ---- keep it ----
  const save = el("button", { class: "primary hidden", style: "margin-top:var(--s3)" },
    "Share for 24 hours");
  const download = el("button", { class: "ghost hidden", style: "margin-top:var(--s2)" }, "Download");

  save.onclick = async () => {
    if (!posterCanvas) return;
    save.disabled = true; save.textContent = "Saving…";
    try {
      const posterBlob = await posterToBlob(posterCanvas);
      await data.savePoster({ checkIn, provider, style: chosenStyle?.id ?? null,
                              posterBlob });
      toast("Poster shared. It disappears in 24 hours", "ok");
      closeSheet();
      onSaved();
    } catch (error) {
      toast(error.message, "error");
      save.disabled = false; save.textContent = "Share for 24 hours";
    }
  };

  download.onclick = async () => {
    if (!posterCanvas) return;
    const blob = await posterToBlob(posterCanvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `field-notes-${cityOnly(checkIn.place_name).toLowerCase().replace(/\s+/g, "-")}.jpg`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  openSheet("Make a poster",
    el("div", { class: "postcard-stage tall" }, preview), status,
    el("section", { class: "card stack", style: "border-top:0;padding-top:0" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Which check-in"), picker),
      el("p", { class: "dim" }, "This is what the poster gets filed under.")),
    el("section", { class: "card stack" },
      el("h3", {}, "Pick a style"),
      styleGrid,
      steps,
      copy, upload, stampInput),
    AI_GENERATION_ENABLED
      ? el("section", { class: "card stack" },
          el("h3", {}, "Or have it made for you"),
          el("p", { class: "dim" },
            generatable && checkIn.id === generatable.id
              ? "A few cents per poster, charged to your API key."
              : "Only available for your most recent check-in with a photo."),
          generate)
      : null,
    el("p", { class: "dim", style: "margin-top:var(--s3)" },
      "Posters stay in Imhere for 24 hours, then they're deleted for good. Download it to keep it."),
    save, download);
}

// ============================================================ gallery

/** "23 h left", "40 min left": posters are deleted 24 hours after they're made. */
export function timeLeft(createdAt) {
  const minutes = Math.max(0, Math.round((new Date(createdAt).getTime() + 24 * 3600e3 - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h left` : `${minutes} min left`;
}

async function downloadPoster(url, poster) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `poster-${cityOnly(poster.place_name).toLowerCase().replace(/\s+/g, "-")}.${(poster.poster_path || "").endsWith(".png") ? "png" : "jpg"}`;
  document.body.append(link); link.click(); link.remove();
}

export async function postersCard(reload) {
  const posters = await data.myPosters();
  if (!posters.length) return null;

  const grid = el("div", { class: "poster-grid" });
  for (const poster of posters) {
    const thumb = el("img", { alt: `Poster of ${cityOnly(poster.place_name)}`, loading: "lazy" });
    data.posterURL(poster.poster_path).then((url) => { if (url) thumb.src = url; });
    const tile = el("button", { class: "poster-tile", type: "button" },
      thumb,
      el("div", { class: "dim" }, `${flagEmoji(poster.country_code)} ${cityOnly(poster.place_name)}`.trim()),
      el("div", { class: "dim", style: "font-size:12.5px" }, timeLeft(poster.created_at)));
    tile.onclick = async () => {
      const url = await data.posterURL(poster.poster_path);
      if (!url) { toast("Couldn't open that poster", "error"); return; }
      const keep = el("button", { class: "secondary", style: "margin-top:var(--s3)" }, "Download to keep");
      keep.onclick = () => downloadPoster(url, poster);
      const remove = el("button", { class: "danger", style: "margin-top:var(--s4)" }, icon("trash"), "Delete this poster");
      remove.onclick = async () => {
        if (!(await confirmSheet("Delete this poster?", cityOnly(poster.place_name)))) return;
        try {
          await data.deletePoster(poster);
          toast("Deleted", "ok");
          reload();
        } catch (error) { toast(error.message, "error"); }
      };
      const reactions = el("div", { style: "margin-top:var(--s3)" });
      openSheet(cityOnly(poster.place_name),
        el("div", { class: "postcard-stage tall" }, el("img", { class: "postcard-preview", src: url, alt: "" })),
        el("p", { class: "dim", style: "margin-top:var(--s2)" }, `${timeLeft(poster.created_at)}, then it's deleted for good.`),
        reactions, keep, remove);
      fillReactions("poster", [{ id: poster.id, slot: reactions, own: true }]);
    };
    grid.append(tile);
  }
  return el("section", { class: "card" }, el("h3", {}, `Your posters (${posters.length})`),
    el("p", { class: "dim" }, "Each poster disappears 24 hours after you share it."), grid);
}
