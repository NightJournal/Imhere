// ---------------------------------------------------------------
// Who can see a trip. "Everyone" (the default) means your whole circle
// and all your friend groups, including people who join later. Turn it
// off to pick: everyone starts ticked, untick who shouldn't see it.
// The same choice covers the trip's check-ins, start point, posters and
// posted postcards. Travel groups aren't affected: they see what you
// check in while the group runs.
// ---------------------------------------------------------------
import { el, toast, openSheet, closeSheet } from "./ui.js";
import * as data from "./db.js";

/** Load the people and friend groups you could pick from. */
export async function audienceChoices() {
  const [members, groups] = await Promise.all([
    data.myCircle().catch(() => []),
    data.myGroups().catch(() => []),
  ]);
  return {
    people: members.filter((m) => m.status === "active")
      .map((m) => ({ id: m.member_id, name: m.display_name || "Someone" })),
    groups: groups.filter((g) => g.active && g.kind === "friends").map((g) => ({ id: g.id, name: g.name })),
  };
}

/**
 * The picker. current = { limited, viewers: [ids], groups: [ids] } or null
 * for a new trip. Returns { element, value() }.
 */
export function audiencePicker(choices, current = null) {
  let limited = !!current?.limited;
  const viewers = new Set(current?.limited ? current.viewers : choices.people.map((p) => p.id));
  const groupIDs = new Set(current?.limited ? current.groups : choices.groups.map((g) => g.id));

  const knob = el("button", { class: "switch" + (limited ? "" : " on"), type: "button", role: "switch",
    "aria-checked": String(!limited), "aria-label": "Everyone in my circle and friend groups" });
  const pickBox = el("div", { class: "stack" });

  const chip = (label, set, id) => {
    const on = set.has(id);
    const button = el("button", { type: "button", class: "chip" + (on ? " on" : ""), "aria-pressed": String(on) }, label);
    button.onclick = () => {
      if (set.has(id)) set.delete(id); else set.add(id);
      button.classList.toggle("on", set.has(id));
      button.setAttribute("aria-pressed", String(set.has(id)));
    };
    return button;
  };

  function draw() {
    knob.classList.toggle("on", !limited);
    knob.setAttribute("aria-checked", String(!limited));
    if (!limited) { pickBox.replaceChildren(); return; }
    pickBox.replaceChildren(
      el("p", { class: "dim" }, "Only the people and groups ticked below can see this trip. People you add to your circle later won't see it unless you tick them."),
      choices.people.length
        ? el("div", { class: "field" }, el("span", { class: "label" }, "People in your circle"),
            el("div", { class: "chips" }, choices.people.map((p) => chip(p.name, viewers, p.id))))
        : el("p", { class: "dim" }, "Nobody in your circle yet."),
      choices.groups.length
        ? el("div", { class: "field" }, el("span", { class: "label" }, "Friend groups"),
            el("div", { class: "chips" }, choices.groups.map((g) => chip(g.name, groupIDs, g.id))))
        : null);
  }
  knob.onclick = () => { limited = !limited; draw(); };
  draw();

  const element = el("div", { class: "stack" },
    el("div", { class: "toggle-row" },
      el("span", {}, el("strong", {}, "Everyone"), el("br"),
        el("span", { class: "dim" }, "Your whole circle and friend groups, including people who join later")),
      knob),
    pickBox);
  return {
    element,
    value: () => ({ limited, viewers: limited ? [...viewers] : [], groups: limited ? [...groupIDs] : [] }),
  };
}

/** Sheet to change who sees an existing trip. */
export async function editTripAudience(tripId, onDone = () => {}) {
  const [choices, current] = await Promise.all([audienceChoices(), data.tripAudience(tripId)]);
  const picker = audiencePicker(choices, current);
  const save = el("button", { class: "primary" }, "Save");
  save.onclick = async () => {
    save.disabled = true;
    try {
      await data.setTripAudience(tripId, picker.value());
      toast("Saved. It applies to the whole trip", "ok");
      closeSheet(); onDone();
    } catch (error) { toast(error.message, "error"); save.disabled = false; }
  };
  openSheet("Who can see this trip",
    el("p", { class: "dim", style: "margin-bottom:var(--s3)" },
      "This covers the whole trip: its check-ins, starting point and posted postcards. Someone you untick stops seeing all of it straight away."),
    picker.element, save);
}
