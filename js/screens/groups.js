// ---------------------------------------------------------------
// Groups. Two kinds:
//  * Friend groups — no end date. Members see each other's CURRENT trip and
//    live location (no history). Each member can pause sharing.
//  * Travel groups — people travelling together, until an end date.
//
// While a group runs, its members see each other's check-ins and live
// location from the group's time (nothing older, nothing after it ends).
// "Check in for the group" also puts your check-in into the history of
// every member who allows it, so their own circle sees it too.
// ---------------------------------------------------------------
import { el, fill, toast, openSheet, closeSheet, confirmSheet, icon, avatarElement } from "../ui.js";
import * as data from "../db.js";
import { app } from "../app.js";

const day = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
const isoDate = (d) => d.toISOString().slice(0, 10);

/** The "Groups" card on the Circle screen. */
export async function groupsCard({ reload, openMember }) {
  const groups = await data.myGroups().catch(() => []);
  const createFriends = el("button", { class: "secondary", type: "button" }, icon("circle"), "New friend group");
  createFriends.onclick = () => createFriendGroupSheet(reload);
  const create = el("button", { class: "secondary", type: "button" }, icon("plans"), "New travel group");
  create.onclick = () => createGroupSheet(reload);

  const active = groups.filter((g) => g.active);
  const ended = groups.filter((g) => !g.active).slice(0, 3);
  const row = (group) => {
    const button = el("button", { class: "list-row rowline", type: "button",
      style: "width:100%;background:none;border-left:0;border-right:0;border-bottom:0;cursor:pointer;text-align:left" },
      el("span", { style: "min-width:0" },
        el("span", { style: "display:block;font-weight:700" }, group.name),
        el("span", { class: "dim" }, !group.active ? `Ended ${day(group.ends_at)}`
          : `${group.kind === "friends" ? "Friend group" : `Travel group until ${day(group.ends_at)}`} · ${group.members.length} ${group.members.length === 1 ? "person" : "people"}`)),
      el("span", { class: "pill " + (group.active ? "live" : "quiet") },
        !group.active ? "Ended" : group.kind === "friends" ? "Friends" : "Travel"));
    button.onclick = () => groupSheet(group, { reload, openMember });
    return button;
  };

  return el("section", { class: "card" },
    el("h3", {}, "Groups"),
    el("p", { class: "dim" },
      "Friend group: no end date. Everyone sees each other's current trip and live location. Travel group: until an end date, everyone sees each other's check-ins and live location from the trip."),
    active.length ? active.map(row) : null,
    ended.length ? ended.map(row) : null,
    el("div", { class: "button-row", style: "margin-top:var(--s3)" }, createFriends, create));
}

function createFriendGroupSheet(reload) {
  const name = el("input", { type: "text", maxlength: "60", placeholder: "e.g. Uni friends" });
  const message = el("p", { class: "dim", role: "alert" });
  const go = el("button", { class: "primary", type: "button" }, "Create friend group");
  go.onclick = async () => {
    if (!name.value.trim()) { message.textContent = "Give the group a name."; name.focus(); return; }
    go.disabled = true;
    try {
      await data.createFriendGroup(name.value.trim());
      toast("Friend group created. Invite your friends from inside it.", "ok");
      closeSheet(); reload();
    } catch (error) { message.textContent = error.message || "Couldn't create the group."; go.disabled = false; }
  };
  openSheet("New friend group",
    el("div", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Name"), name),
      el("p", { class: "dim" },
        "No end date. Everyone in it sees each other's current trip and live location, nothing older and no check-ins outside a trip. Only you can invite people. Anyone can pause sharing or leave."),
      message, go));
  setTimeout(() => name.focus(), 50);
}

function createGroupSheet(reload) {
  const today = new Date();
  const name = el("input", { type: "text", maxlength: "60", placeholder: "e.g. Japan with uni friends" });
  const ends = el("input", { type: "date", min: isoDate(new Date(today.getTime() + 86400000)),
    max: isoDate(new Date(today.getTime() + 30 * 86400000)), value: isoDate(new Date(today.getTime() + 7 * 86400000)) });
  const message = el("p", { class: "dim", role: "alert" });
  const go = el("button", { class: "primary", type: "button" }, "Create group");
  go.onclick = async () => {
    if (!name.value.trim()) { message.textContent = "Give the group a name."; name.focus(); return; }
    // The group runs until the END of the chosen day, local time.
    const end = new Date(ends.value + "T23:59:00");
    if (!(end > new Date())) { message.textContent = "Pick an end date after today."; return; }
    go.disabled = true;
    try {
      await data.createGroup(name.value.trim(), end.toISOString());
      toast("Group created. Now invite the people you're travelling with.", "ok");
      closeSheet();
      reload();
    } catch (error) {
      message.textContent = /31 days|check/.test(error.message || "") ? "A group can last up to 30 days." : (error.message || "Couldn't create the group.");
      go.disabled = false;
    }
  };
  openSheet("New travel group",
    el("div", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Name"), name),
      el("label", { class: "field" }, el("span", { class: "label" }, "Ends on (up to 30 days)"), ends),
      el("p", { class: "dim" },
        "Until the end of that day, everyone in the group sees each other's check-ins and live location made during the group. Not your older trips, and nothing after it ends. You can end it early."),
      message, go));
  setTimeout(() => name.focus(), 50);
}

function groupSheet(group, { reload, openMember }) {
  const me = app.user?.id;
  const mine = group.members.find((m) => m.member_id === me);
  const isCreator = group.created_by === me;

  const members = group.members.map((m) => {
    const face = avatarElement(m.display_name, null);
    if (m.avatar_path) data.avatarURL(m.avatar_path).then((url) => { if (url) fill(face, el("img", { src: url, alt: "" })); });
    const you = m.member_id === me;
    const view = !you && group.active ? el("button", { class: "ghost", type: "button", style: "width:auto" }, "View") : null;
    if (view) view.onclick = () => { closeSheet(); openMember({ id: m.member_id, display_name: m.display_name, avatar_path: m.avatar_path }); };
    const remove = isCreator && !you && group.active
      ? el("button", { class: "icon-button", type: "button", "aria-label": `Remove ${m.display_name} from the group` }, icon("close")) : null;
    if (remove) remove.onclick = async () => {
      if (!(await confirmSheet("Remove from the group?", `${m.display_name} will stop seeing the group, and the group stops seeing them.`, "Remove"))) return;
      try { await data.removeGroupMember(group.id, m.member_id); toast("Removed", "ok"); reload(); }
      catch (error) { toast(error.message, "error"); }
    };
    return el("div", { class: "list-row rowline" },
      el("span", { style: "display:flex;align-items:center;gap:var(--s3);min-width:0" }, face,
        el("span", {}, el("span", { style: "display:block;font-weight:700" }, you ? `${m.display_name} (you)` : m.display_name),
          el("span", { class: "dim" }, [m.member_id === group.created_by ? "Started the group" : `Joined ${day(m.joined_at)}`,
            group.kind === "friends" && m.sharing === false ? "sharing paused" : null].filter(Boolean).join(" · ")))),
      el("span", { style: "display:flex;gap:6px;align-items:center" }, view, remove));
  });

  const friends = group.kind === "friends";

  // Friend groups: pause sharing (both ways).
  const sharingOn = mine?.sharing ?? true;
  const shareKnob = el("button", { class: "switch" + (sharingOn ? " on" : ""), type: "button", role: "switch",
    "aria-checked": String(sharingOn), "aria-label": "Share with this group" });
  shareKnob.onclick = async () => {
    const next = !shareKnob.classList.contains("on");
    shareKnob.disabled = true;
    try {
      await data.setGroupSharing(group.id, next);
      shareKnob.classList.toggle("on", next); shareKnob.setAttribute("aria-checked", String(next));
      toast(next ? "Sharing with the group again" : "Paused: they can't see you, and you can't see them", "ok");
    } catch (error) { toast(error.message, "error"); }
    shareKnob.disabled = false;
  };

  // Travel groups: may the group check in for me?
  const allow = mine?.allow_group_checkins ?? true;
  const knob = el("button", { class: "switch" + (allow ? " on" : ""), type: "button", role: "switch",
    "aria-checked": String(allow), "aria-label": "Let the group check in for me" });
  knob.onclick = async () => {
    const next = !knob.classList.contains("on");
    knob.disabled = true;
    try {
      await data.setGroupCheckins(group.id, next);
      knob.classList.toggle("on", next); knob.setAttribute("aria-checked", String(next));
      toast(next ? "Group check-ins will appear in your history and your circle" : "Group check-ins won't be added for you", "ok");
    } catch (error) { toast(error.message, "error"); }
    knob.disabled = false;
  };

  const invites = isCreator && group.active ? inviteBlock(group) : null;

  const leave = !isCreator && group.active ? el("button", { class: "danger", type: "button" }, "Leave group") : null;
  const endLabel = friends ? "Close group" : "End group now";
  if (leave) leave.onclick = async () => {
    if (!(await confirmSheet("Leave this group?", "You'll stop seeing the group, and they stop seeing you. Check-ins already added to your history stay yours.", "Leave"))) return;
    try { await data.leaveGroup(group.id); toast("You left the group", "ok"); reload(); }
    catch (error) { toast(error.message, "error"); }
  };
  const end = isCreator && group.active ? el("button", { class: "danger", type: "button" }, endLabel) : null;
  if (end) end.onclick = async () => {
    if (!(await confirmSheet(friends ? "Close this friend group?" : "End the group now?", "Everyone stops seeing each other straight away, and unused invite links stop working. This can't be undone.", endLabel))) return;
    try { await data.endGroup(group.id); toast("Group ended", "ok"); reload(); }
    catch (error) { toast(error.message, "error"); }
  };

  // Ended groups: tidy up. Anyone can remove it from their own list; the
  // creator can also delete it for everyone.
  const hide = !group.active ? el("button", { class: "secondary", type: "button" }, "Remove from my list") : null;
  if (hide) hide.onclick = async () => {
    if (!(await confirmSheet("Remove from your list?",
      "Only you stop seeing this group. Everyone else keeps it, without you in the member list. Check-ins in your history stay.", "Remove"))) return;
    try { await data.removeEndedGroup(group.id); toast("Removed from your list", "ok"); closeSheet(); reload(); }
    catch (error) { toast(error.message, "error"); }
  };
  const wipe = !group.active && isCreator ? el("button", { class: "danger", type: "button" }, "Delete for everyone") : null;
  if (wipe) wipe.onclick = async () => {
    if (!(await confirmSheet("Delete this group for everyone?",
      "The group and its member list disappear for every member. Check-ins already in people's histories stay theirs. This can't be undone.", "Delete"))) return;
    try { await data.deleteGroupForEveryone(group.id); toast("Group deleted", "ok"); closeSheet(); reload(); }
    catch (error) { toast(error.message, "error"); }
  };

  openSheet(group.name,
    el("p", { class: "dim", style: "margin-bottom:var(--s3)" },
      !group.active ? "This group has ended. Nobody in it can see the others any more."
        : friends ? "Friend group, no end date. Members see each other's current trip and live location."
        : `Travel group, runs until ${new Date(group.ends_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`),
    el("section", { class: "card" }, el("h3", {}, `People (${group.members.length})`), members),
    group.active && friends ? el("section", { class: "card" },
      el("div", { class: "toggle-row" }, el("span", {}, "Share with this group"), shareKnob),
      el("p", { class: "dim" },
        "Switch off for a quiet spell: they won't see your current trip or live location, and you won't see theirs, until you switch it back on.")) : null,
    group.active && !friends ? el("section", { class: "card" },
      el("div", { class: "toggle-row" }, el("span", {}, "Let the group check in for me"), knob),
      el("p", { class: "dim" },
        "When someone checks in “for the group”, it's added to your history too, marked with their name, so your own circle sees it. You can delete any of these.")) : null,
    invites,
    el("div", { class: "stack", style: "margin-top:var(--s3)" }, leave, end, hide, wipe));
}

function inviteBlock(group) {
  let people = 1;
  const chips = el("div", { class: "chips", role: "group", "aria-label": "How many people can join with it" });
  const options = [1, 2, 3, 5, 10];
  const buttons = options.map((n) => {
    const chip = el("button", { class: "chip" + (n === people ? " on" : ""), type: "button", "aria-pressed": String(n === people) },
      n === 1 ? "1 person" : `${n} people`);
    chip.onclick = () => { people = n; buttons.forEach((b, i) => { b.classList.toggle("on", options[i] === n); b.setAttribute("aria-pressed", String(options[i] === n)); }); };
    return chip;
  });
  chips.append(...buttons);
  const output = el("div", { class: "stack" });
  const list = el("div", { class: "stack" });
  const drawList = async () => {
    const invites = await data.groupInvites(group.id).catch(() => []);
    fill(list, invites.length ? el("h3", { style: "margin-top:var(--s2)" }, "Group links that still work") : null,
      invites.map((invite) => {
        const cancel = el("button", { class: "ghost", type: "button", style: "width:auto" }, "Cancel link");
        cancel.onclick = async () => { await data.cancelGroupInvite(invite.token).catch(() => {}); toast("Link cancelled", "ok"); drawList(); };
        return el("div", { class: "list-row rowline" },
          el("div", {}, el("div", { style: "font-weight:700" }, `${invite.use_count} of ${invite.max_uses} joined`),
            el("div", { class: "dim" }, `…${invite.token.slice(-6)}`)), cancel);
      }));
  };
  const create = el("button", { class: "primary", type: "button" }, "Create a group link");
  create.onclick = async () => {
    create.disabled = true;
    try {
      const invite = await data.createGroupInvite(group.id, people);
      const link = `${location.origin}${location.pathname}#group=${invite.token}`;
      const box = el("input", { type: "text", value: link, readonly: "readonly" });
      const copy = el("button", { class: "secondary", type: "button" }, "Copy link");
      copy.onclick = async () => {
        let copied = false;
        try { await navigator.clipboard.writeText(link); copied = true; } catch { copied = false; }
        if (copied) toast("Link copied", "ok"); else { box.select(); toast("Couldn't copy automatically. The link is selected."); }
      };
      fill(output, el("p", { class: "dim" },
        `Works for ${invite.max_uses === 1 ? "one person" : `up to ${invite.max_uses} people`} for 7 days${group.kind === "friends" ? "" : " (or until the group ends)"}. Whoever joins sees where everyone in the group is, so only send it to people you trust.`),
        box, copy);
      drawList();
    } catch (error) { toast(error.message, "error"); }
    create.disabled = false;
  };
  drawList();
  return el("section", { class: "card stack" },
    el("h3", {}, group.kind === "friends" ? "Invite friends" : "Invite people you're travelling with"),
    el("div", { class: "field" }, el("span", { class: "label" }, "How many people can join with it"), chips),
    create, output, list);
}

/** Check-in sheet helper: the groups I could check in for right now. */
export async function activeGroups() {
  const groups = await data.myGroups().catch(() => []);
  return groups.filter((g) => g.active && g.kind !== "friends");   // group check-ins: travel groups only
}

/** After sign-in: join the group from a #group= link. */
export async function redeemPendingGroup() {
  const token = sessionStorage.getItem("pendingGroup");
  if (!token) return;
  sessionStorage.removeItem("pendingGroup");
  try {
    const outcome = await data.joinGroup(token);
    if (outcome === "ok") toast("You've joined the group. See it in Circle.", "ok");
    else toast(data.groupProblem(outcome), "error");
  } catch (error) { toast(error.message, "error"); }
}
