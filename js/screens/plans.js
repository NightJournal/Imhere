// ---------------------------------------------------------------
// Travel plans — where I'm going, and who is allowed to know.
// ---------------------------------------------------------------
import { el, fill, toast, openSheet, closeSheet, confirmSheet, isoDate, icon } from "../ui.js";
import * as data from "../db.js";
import { placeField } from "../geo.js";
import { reactionSlot, fillReactions } from "../reactions.js";

function dateRange(from, to) {
  const format = (d) => new Date(d + "T00:00:00")
    .toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

/** One editable stop row inside the plan sheet. */
function stopRow(stop, onRemove) {
  const field = placeField({
    placeholder: "Stop", value: stop.place || "", allowCurrent: false,
    onResolve: (place) => { if (place) stop.place = place.label; },
  });
  field.element.querySelector("input").addEventListener("input", (event) => {
    stop.place = event.target.value;   // typed text counts even without a match
  });
  const from = el("input", { type: "date", value: stop.start_date || isoDate() });
  const to = el("input", { type: "date", value: stop.end_date || isoDate() });
  from.onchange = () => { stop.start_date = from.value; };
  to.onchange = () => { stop.end_date = to.value; };

  const remove = el("button", { class: "icon-button", type: "button", "aria-label": "Remove this stop" }, icon("close"));
  const row = el("div", { class: "list-row stack" },
    field.element,
    el("div", { style: "display:flex;gap:8px;align-items:center" },
      el("label", { class: "field", style: "flex:1" }, el("span", { class: "label" }, "From"), from),
      el("label", { class: "field", style: "flex:1" }, el("span", { class: "label" }, "To"), to),
      el("div", { style: "align-self:flex-end;padding-bottom:4px" }, remove)));
  remove.onclick = () => { row.remove(); onRemove(stop); };
  return row;
}

async function planSheet(plan, members, groups, reload, { owner = true } = {}) {
  const isNew = !plan;
  plan = plan || { destination: "", start_date: isoDate(), end_date: isoDate(), note: "" };
  const stops = (plan.plan_stops || [])
    .slice().sort((a, b) => a.order_index - b.order_index)
    .map((s) => ({ place: s.place, start_date: s.start_date, end_date: s.end_date }));

  const destination = placeField({
    placeholder: "Where are you going?", value: plan.destination, allowCurrent: false,
    onResolve: (place) => { if (place) plan.destination = place.label; },
  });
  destination.element.querySelector("input").addEventListener("input", (event) => {
    plan.destination = event.target.value;
  });

  const from = el("input", { type: "date", value: plan.start_date });
  const to = el("input", { type: "date", value: plan.end_date });
  const note = el("textarea", { placeholder: "Notes (hotel, who you're with, anything)" });
  note.value = plan.note || "";

  const stopsBox = el("div", {});
  const addStop = el("button", { class: "secondary", type: "button" }, "+ Add a stop");
  const drawStop = (stop) => stopsBox.append(stopRow(stop, (gone) => {
    const index = stops.indexOf(gone);
    if (index >= 0) stops.splice(index, 1);
  }));
  stops.forEach(drawStop);
  addStop.onclick = () => {
    const stop = { place: "", start_date: from.value, end_date: to.value };
    stops.push(stop);
    drawStop(stop);
  };

  // Who may see this plan — per plan, not per circle.
  const chosenViewers = new Set((plan.plan_viewers || []).map((v) => v.viewer_id));
  const viewerBox = el("div", { class: "chips" });
  for (const member of members) {
    const chip = el("button", { type: "button", class: "chip" + (chosenViewers.has(member.member_id) ? " on" : ""),
      "aria-pressed": String(chosenViewers.has(member.member_id)) }, member.display_name);
    chip.onclick = () => {
      if (chosenViewers.has(member.member_id)) chosenViewers.delete(member.member_id);
      else chosenViewers.add(member.member_id);
      chip.classList.toggle("on");
      chip.setAttribute("aria-pressed", String(chosenViewers.has(member.member_id)));
    };
    viewerBox.append(chip);
  }

  // …and whole groups. A group share follows the group: new members see the
  // plan, people who leave stop seeing it, and it stops when the group ends.
  const chosenGroups = new Set((plan.plan_groups || []).map((g) => g.group_id));
  const groupBox = el("div", { class: "chips" });
  for (const group of groups) {
    const on = chosenGroups.has(group.id);
    const chip = el("button", { type: "button", class: "chip" + (on ? " on" : ""), "aria-pressed": String(on) },
      `${group.name} (${group.members.length})`);
    chip.onclick = () => {
      if (chosenGroups.has(group.id)) chosenGroups.delete(group.id); else chosenGroups.add(group.id);
      chip.classList.toggle("on");
      chip.setAttribute("aria-pressed", String(chosenGroups.has(group.id)));
    };
    groupBox.append(chip);
  }

  // Plan together: everyone it's shared with may edit dates, stops and notes.
  let together = !!plan.collaborative;
  const togetherKnob = el("button", { class: "switch" + (together ? " on" : ""), type: "button", role: "switch",
    "aria-checked": String(together), "aria-label": "Plan together" });
  togetherKnob.onclick = () => {
    together = !together;
    togetherKnob.classList.toggle("on", together);
    togetherKnob.setAttribute("aria-checked", String(together));
  };

  const save = el("button", { class: "primary" }, isNew ? "Save plan" : "Update plan");
  save.onclick = async () => {
    if (!plan.destination?.trim()) { toast("Give the plan a destination", "error"); return; }
    save.disabled = true;
    try {
      await data.savePlan(
        { id: plan.id, destination: plan.destination.trim(), collaborative: together,
          start_date: from.value, end_date: to.value, note: note.value.trim() },
        stops.filter((s) => s.place?.trim()),
        [...chosenViewers], [...chosenGroups], { owner });
      closeSheet();
      toast("Plan saved", "ok");
      reload();
    } catch (error) { toast(error.message, "error"); save.disabled = false; }
  };

  const sharing = owner ? [
      el("h3", { style: "margin-top:var(--s4)" }, "Who can see this plan"),
      el("div", { class: "field" }, el("span", { class: "label" }, "People in your circle"),
        members.length ? viewerBox
          : el("p", { class: "dim" }, "Nobody in your circle yet — add someone on the Circle tab.")),
      groups.length ? el("div", { class: "field" }, el("span", { class: "label" }, "Groups"), groupBox) : null,
      groups.length ? el("p", { class: "dim" },
        "Everyone in a group you pick sees this plan while the group runs, including people who join later. Anyone who leaves, or pauses sharing in a friend group, stops seeing it.") : null,
      el("div", { class: "toggle-row", style: "margin-top:var(--s2)" },
        el("span", {}, el("strong", {}, "Plan together")), togetherKnob),
      el("p", { class: "dim" },
        "On: everyone you share it with can change the dates, stops and notes. Only you choose who sees it, and only you can delete it."),
    ] : [el("p", { class: "dim" }, `Shared by ${plan.owner_name || "a friend"} to plan together. Changes are seen by everyone it's shared with.`)];

  openSheet(isNew ? "New travel plan" : owner ? "Edit plan" : "Plan together",
    el("div", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Destination"), destination.element),
      el("div", { style: "display:flex;gap:8px" },
        el("label", { class: "field", style: "flex:1" }, el("span", { class: "label" }, "From"), from),
        el("label", { class: "field", style: "flex:1" }, el("span", { class: "label" }, "To"), to)),
      el("h3", { style: "margin-top:var(--s4)" }, "Stops"),
      stopsBox, addStop,
      ...sharing,
      el("label", { class: "field" }, el("span", { class: "label" }, "Notes"), note),
      save));
}

function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function planCard(plan, { own, sharedWith, editorName, onEdit, onDelete, slots }) {
  const stops = (plan.plan_stops || []).slice().sort((a, b) => a.order_index - b.order_index);
  const edit = onEdit ? el("button", { class: "secondary" }, own ? "Edit" : "Edit together") : null;
  if (edit) edit.onclick = onEdit;
  const remove = onDelete ? el("button", { class: "ghost" }, "Delete") : null;
  if (remove) remove.onclick = onDelete;
  const slot = reactionSlot();
  slots.push({ id: plan.id, slot, own });
  return el("section", { class: "card" },
    el("div", { class: "rowline" },
      el("span", { class: "place" }, plan.destination),
      el("span", { class: "dim" }, dateRange(plan.start_date, plan.end_date))),
    !own ? el("div", { class: "dim", style: "margin-top:2px" }, `From ${plan.owner_name}`) : null,
    stops.map((stop) => el("div", { class: "dim", style: "margin-top:4px" },
      `· ${stop.place} (${dateRange(stop.start_date, stop.end_date)})`)),
    plan.note ? el("div", { style: "margin-top:8px" }, plan.note) : null,
    el("div", { class: "dim", style: "margin-top:8px" },
      [own ? (sharedWith ? `Shared with ${sharedWith}` : "Private: only you can see this") : null,
       plan.collaborative ? "planning together" : null,
       editorName && plan.updated_at ? `edited by ${editorName} ${timeAgo(plan.updated_at)}` : null]
        .filter(Boolean).join(" · ")),
    slot,
    edit || remove ? el("div", { class: "button-row", style: "margin-top:var(--s4)" }, edit, remove) : null);
}

async function render(container) {
  const [plans, shared, members, allGroups, user] = await Promise.all([
    data.myPlans(), data.sharedPlans().catch(() => []), data.myCircle(),
    data.myGroups().catch(() => []), data.currentUser()]);
  const active = members.filter((m) => m.status === "active");
  const groups = allGroups.filter((g) => g.active);
  const reload = () => render(container);

  const add = el("button", { class: "primary" }, "+ New travel plan");
  add.onclick = () => planSheet(null, active, groups, reload);

  if (!plans.length && !shared.length) {
    fill(container, el("div", { class: "empty" },
      el("div", { class: "big", "aria-hidden": "true" }),
      el("p", {}, "No plans yet"),
      el("p", { class: "dim" },
        "A plan is what you tell people before you go — separate from check-ins, and shared only with the people you pick. Switch on “Plan together” to let them edit it with you."),
      add));
    return;
  }

  // Names of people who might have edited my plans (circle + group members).
  const names = new Map();
  for (const m of active) names.set(m.member_id, m.display_name);
  for (const g of allGroups) for (const m of g.members) names.set(m.member_id, m.display_name);

  const slots = [];
  const mine = plans.map((plan) => {
    const viewers = (plan.plan_viewers || []).length;
    const groupNames = (plan.plan_groups || []).map((pg) => groups.find((g) => g.id === pg.group_id)?.name).filter(Boolean);
    const sharedWith = [viewers ? `${viewers} ${viewers === 1 ? "person" : "people"}` : null,
      groupNames.length ? groupNames.join(", ") : null].filter(Boolean).join(" and ");
    const editorName = plan.updated_by && plan.updated_by !== user?.id ? names.get(plan.updated_by) || "a friend" : null;
    return planCard(plan, { own: true, sharedWith, editorName, slots,
      onEdit: () => planSheet(plan, active, groups, reload),
      onDelete: async () => {
        if (!(await confirmSheet("Delete this plan?", plan.destination))) return;
        try { await data.deletePlan(plan.id); toast("Deleted", "ok"); reload(); }
        catch (error) { toast(error.message, "error"); }
      } });
  });
  const theirs = shared.map((plan) => planCard(plan, { own: false, slots,
    editorName: plan.updated_by && plan.updated_by !== plan.user_id
      ? (plan.updated_by === user?.id ? "you" : plan.editor_name || "a friend") : null,
    onEdit: plan.collaborative ? () => planSheet(plan, [], [], reload, { owner: false }) : null }));

  fill(container, el("div", { style: "padding-bottom:var(--s5)" }, add),
    mine,
    theirs.length ? el("h2", { style: "margin:var(--s5) 0 var(--s3);font-size:20px" }, "Shared with you") : null,
    theirs);
  fillReactions("plan", slots);
}

export default { render };
