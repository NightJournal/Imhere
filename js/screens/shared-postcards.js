// ---------------------------------------------------------------
// Postcards posted to Imhere: shown on your Earth page and on your
// friends' view of you, with reactions. Seen only by people who can see
// that trip; deleted 48 hours after posting.
// ---------------------------------------------------------------
import { el, toast, openSheet, confirmSheet, icon } from "../ui.js";
import * as data from "../db.js";
import { reactionBar } from "../reactions.js";
import { timeLeft } from "./posters.js";

function download(url, postcard) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `imhere-postcard-${postcard.created_at.slice(0, 10)}.jpg`;
  document.body.append(link); link.click(); link.remove();
}

/** Open one postcard: big image, time left, reactions, and (if mine) download/delete. */
async function openPostcard(postcard, { own, reload }) {
  const url = await data.postcardURL(postcard.image_path);
  if (!url) { toast("Couldn't open that postcard", "error"); return; }
  const reactions = el("div", { style: "margin-top:var(--s3)" });
  let actions = [];
  if (own) {
    const keep = el("button", { class: "secondary", style: "margin-top:var(--s3)" }, "Download to keep");
    keep.onclick = () => download(url, postcard);
    const remove = el("button", { class: "danger", style: "margin-top:var(--s4)" }, icon("trash"), "Take it down now");
    remove.onclick = async () => {
      if (!(await confirmSheet("Take this postcard down?", "Everyone stops seeing it, and its reactions go too."))) return;
      try { await data.deletePostcard(postcard); toast("Taken down", "ok"); reload?.(); }
      catch (error) { toast(error.message, "error"); }
    };
    actions = [keep, remove];
  }
  openSheet(postcard.title || "Postcard",
    el("div", { class: "postcard-stage" }, el("img", { class: "postcard-preview", src: url, alt: postcard.title || "Postcard" })),
    el("p", { class: "dim", style: "margin-top:var(--s2)" }, `${timeLeft(postcard.created_at)}, then it's deleted for good.`),
    reactions, ...actions);
  data.reactionsFor("postcard", [postcard.id])
    .then((byId) => reactions.append(reactionBar("postcard", postcard.id, byId.get(postcard.id) || [], { own })))
    .catch(() => reactions.append(reactionBar("postcard", postcard.id, [], { own })));
}

function grid(postcards, options) {
  return el("div", { class: "postcard-grid" }, postcards.map((postcard) => {
    const thumb = el("img", { alt: postcard.title || "Postcard", loading: "lazy" });
    data.postcardURL(postcard.image_path).then((url) => { if (url) thumb.src = url; });
    const tile = el("button", { class: "postcard-tile", type: "button" }, thumb,
      el("div", { class: "dim" }, postcard.title || "Postcard"),
      el("div", { class: "dim", style: "font-size:12.5px" }, timeLeft(postcard.created_at)));
    tile.onclick = () => openPostcard(postcard, options);
    return tile;
  }));
}

/** My posted postcards (Earth page). */
export async function myPostcardsCard(reload) {
  const postcards = await data.myPostcards();
  if (!postcards.length) return null;
  return el("section", { class: "card" },
    el("h3", {}, `Your posted postcards (${postcards.length})`),
    el("p", { class: "dim" }, "Seen by the people who can see that trip. Each one disappears 48 hours after you post it."),
    grid(postcards, { own: true, reload }));
}

/** A friend's posted postcards (their page in Circle). */
export function friendPostcardsCard(postcards) {
  if (!postcards.length) return null;
  return el("section", { class: "card" }, el("h3", {}, "Their postcards"), grid(postcards, { own: false }));
}
