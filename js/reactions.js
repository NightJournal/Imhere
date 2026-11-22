// ---------------------------------------------------------------
// Reactions: one emoji per person on a check-in, plan or poster.
// Everyone who can see the thing sees its reactions and who made them
// (the database decides who can see what). The owner can remove any
// reaction on their own things.
// ---------------------------------------------------------------
import { el, toast } from "./ui.js";
import * as data from "./db.js";
import { app } from "./app.js";

const QUICK = ["❤️", "😂", "😮", "🥹", "👏", "✈️", "🙏", "🔥"];

/** Is this a usable emoji (no letters, digits or spaces, not too long)? */
export function cleanEmoji(text) {
  const value = (text || "").trim();
  if (!value || value.length > 16) return null;
  if (/[\p{L}\p{N}\s<>&"'`\\/]/u.test(value)) return null;
  return value;
}

/**
 * A reaction bar for one thing.
 * kind: "checkin" | "plan" | "poster"; own: true when it's my own thing
 * (I see who reacted and can remove reactions, but don't react myself).
 */
export function reactionBar(kind, id, rows = [], { own = false } = {}) {
  const box = el("div", { class: "reactions" });
  let list = rows.slice();
  let picking = false;
  const me = () => app.user?.id;

  async function choose(emoji) {
    const mine = list.find((r) => r.user_id === me());
    picking = false;
    try {
      const saved = await data.setReaction(kind, id, emoji, mine);
      list = list.filter((r) => r.user_id !== me()).concat(saved);
    } catch (error) { toast(error.message || "Couldn't react", "error"); }
    draw();
  }

  async function remove(reaction) {
    try {
      await data.removeReaction(reaction.id);
      list = list.filter((r) => r.id !== reaction.id);
    } catch (error) { toast(error.message || "Couldn't remove it", "error"); }
    draw();
  }

  function picker() {
    const typed = el("input", { type: "text", class: "react-input", maxlength: "16",
      placeholder: "Any emoji", "aria-label": "Type or paste any emoji" });
    const use = el("button", { type: "button", class: "chip" }, "Use");
    const send = () => {
      const emoji = cleanEmoji(typed.value);
      if (!emoji) { toast("Just an emoji, no words", "error"); typed.focus(); return; }
      choose(emoji);
    };
    use.onclick = send;
    typed.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); send(); } };
    return el("div", { class: "react-picker", role: "group", "aria-label": "Pick a reaction" },
      QUICK.map((emoji) => {
        const b = el("button", { type: "button", class: "react-quick", "aria-label": `React ${emoji}` }, emoji);
        b.onclick = () => choose(emoji);
        return b;
      }),
      el("span", { class: "react-own" }, typed, use));
  }

  function draw() {
    const counts = new Map();
    for (const r of list) counts.set(r.emoji, [...(counts.get(r.emoji) || []), r]);
    const chips = [...counts].map(([emoji, people]) => {
      const mineHere = people.some((r) => r.user_id === me());
      const names = people.map((r) => (r.user_id === me() ? "you" : r.reactor_name || "someone")).join(", ");
      const chip = el("button", { type: "button", class: "react-chip" + (mineHere ? " on" : ""),
        "aria-pressed": String(mineHere), title: names, "aria-label": `${emoji} ${people.length}, from ${names}` },
        `${emoji} ${people.length}`);
      chip.disabled = own;
      if (!own) chip.onclick = () => (mineHere ? remove(people.find((r) => r.user_id === me())) : choose(emoji));
      return chip;
    });
    let add = null;
    if (!own) {
      add = el("button", { type: "button", class: "react-add", "aria-expanded": String(picking) },
        picking ? "Close" : list.some((r) => r.user_id === me()) ? "Change" : "+ React");
      add.onclick = () => { picking = !picking; draw(); };
    }
    const who = list.length
      ? el("div", { class: "react-who dim" },
          list.map((r, i) => {
            const label = `${r.user_id === me() ? "You" : r.reactor_name || "Someone"} ${r.emoji}`;
            const part = el("span", {}, i ? " · " : "", label);
            if (own) {
              const x = el("button", { type: "button", class: "react-x", "aria-label": `Remove ${label}` }, "×");
              x.onclick = () => remove(r);
              part.append(x);
            }
            return part;
          }))
      : null;
    if (own && !list.length) { box.replaceChildren(); return; }
    box.replaceChildren(el("div", { class: "react-row" }, ...chips, add || ""), picking ? picker() : "", who || "");
    if (picking) box.querySelector(".react-quick")?.focus();
  }

  draw();
  return box;
}

/**
 * Fill many reaction slots with one query.
 * slots: array of { id, slot (element), own }.
 */
export async function fillReactions(kind, slots) {
  if (!slots.length) return;
  const byId = await data.reactionsFor(kind, slots.map((s) => s.id)).catch(() => new Map());
  for (const { id, slot, own } of slots) slot.replaceChildren(reactionBar(kind, id, byId.get(id) || [], { own }));
}

export const reactionSlot = () => el("div", { class: "reaction-slot" });
