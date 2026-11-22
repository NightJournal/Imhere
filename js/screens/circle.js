// ---------------------------------------------------------------
// Circle — who can see me, who I can see, and invite links.
// The friend view lives here too (tap a traveller to open it).
// ---------------------------------------------------------------
import { el, fill, toast, staleness, hoursSince, cityOnly, flagEmoji, haversineKm,
         TRANSPORT, openSheet, closeSheet, confirmSheet, icon, avatarElement } from "../ui.js";
import { STALE_HOURS } from "../config.js";
import * as data from "../db.js";
import { setSubtitle } from "../app.js";
import { mountGlobe } from "../globe.js";
import { reverseGeocode } from "../geo.js";
import { groupsCard } from "./groups.js";
import { reactionSlot, fillReactions, reactionBar } from "../reactions.js";
import { timeLeft } from "./posters.js";
import { friendPostcardsCard } from "./shared-postcards.js";

let friendGlobe = null;

function closeFriendGlobe() {
  if (friendGlobe) { friendGlobe.destroy(); friendGlobe = null; }
  document.body.classList.remove("is-friend");
}

// ============================================================ live location details
// The globe can't show a walk or a taxi ride (its closest view is a few
// hundred km across, with no streets), so the details are words and a
// one-tap hand-off to a real map app.

const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const ll = (p) => ({ lat: p.latitude, lon: p.longitude });
const coords = (p) => `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;

/** "14 updates · 2.3 km moved · since 20:41" */
function liveSummary(trail) {
  let km = 0;
  for (let i = 1; i < trail.length; i++) km += haversineKm(ll(trail[i - 1]), ll(trail[i]));
  const distance = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  return el("div", { class: "live-summary", style: "margin-top:8px" },
    el("span", {}, el("strong", {}, String(trail.length)), trail.length === 1 ? " update" : " updates"),
    el("span", {}, el("strong", {}, distance), " moved"),
    el("span", {}, "since ", el("strong", {}, hhmm(trail[0].recorded_at))));
}

/** Open the latest position in the phone's own map app. */
function mapsButtons(point, name) {
  const label = encodeURIComponent(`${name || "Traveller"} (Imhere)`);
  const apple = `https://maps.apple.com/?ll=${point.latitude},${point.longitude}&q=${label}`;
  const google = `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`;
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const link = (href, text, primary) => el("a", { href, target: "_blank", rel: "noopener noreferrer",
    class: "button-link " + (primary ? "secondary" : "ghost") }, text);
  return el("div", { class: "stack", style: "margin-top:10px;gap:6px" },
    isApple ? link(apple, "Open in Apple Maps", true) : link(google, "Open in Google Maps", true),
    isApple ? link(google, "Open in Google Maps", false) : link(apple, "Open in Apple Maps", false));
}

/**
 * The route as a timeline: one line per stretch of at least ~150 m, newest
 * first, with place names filled in one at a time (the place-name service
 * asks for gentle use). Only looked up when the list is opened.
 */
function liveTimeline(trail) {
  const stops = [];
  for (const point of trail) {
    const last = stops.at(-1);
    if (!last || haversineKm(ll(last), ll(point)) >= 0.15) stops.push(point);
    else last.until = point.recorded_at;           // stayed put: extend the stay
  }
  const latestFirst = stops.slice().reverse().slice(0, 30);
  const rows = latestFirst.map((point) => {
    const place = el("span", {}, coords(point));
    const time = point.until && hhmm(point.until) !== hhmm(point.recorded_at)
      ? `${hhmm(point.recorded_at)}–${hhmm(point.until)}` : hhmm(point.recorded_at);
    return { point, place, row: el("li", { class: "list-row rowline" }, place, el("span", { class: "dim", style: "white-space:nowrap" }, time)) };
  });
  const list = el("ol", { class: "live-timeline", "aria-label": "Route, newest first" }, rows.map((r) => r.row));
  const box = el("details", { class: "more", style: "margin-top:10px" },
    el("summary", {}, `Route timeline (${stops.length} place${stops.length === 1 ? "" : "s"})`, icon("chevron")),
    list,
    stops.length > 30 ? el("p", { class: "dim" }, `Showing the latest 30 of ${stops.length}.`) : null);
  let named = false;
  box.addEventListener("toggle", async () => {
    if (!box.open || named) return;
    named = true;
    for (const { point, place } of rows) {
      if (!box.isConnected) return;
      const found = await reverseGeocode(point.latitude, point.longitude).catch(() => null);
      if (found) place.textContent = found.label.split(",").slice(0, 2).join(",").trim() || coords(point);
      await new Promise((r) => setTimeout(r, 350));   // be gentle with the free service
    }
  });
  return box;
}

// ============================================================ friend view

async function friendView(container, traveller, back) {
  fill(container, el("div", { class: "empty", "aria-busy": "true" }, el("p", { class: "dim" }, "Loading…")));
  const [{ checkIns, plans, origins, profile, posters }, liveData] = await Promise.all([
    data.friendData(traveller.id),
    data.friendLive(traveller.id).catch(() => ({ lastSeen: null, trail: [], session: null })),
  ]);
  const avatarURL = await data.avatarURL(profile?.avatar_path || traveller.avatar_path).catch(() => null);
  const latest = checkIns[0];
  setSubtitle("");

  const backButton = el("button", { class: "ghost", style: "width:auto;padding-left:0;margin-bottom:var(--s2)" },
    icon("back"), "Circle");
  backButton.onclick = () => { closeFriendGlobe(); back(); };

  const mapBox = el("div", { class: "globe-pane", role: "img",
    "aria-label": `Globe of ${traveller.display_name || "this traveller"}'s check-ins` });

  const quiet = latest && hoursSince(latest.created_at) > STALE_HOURS;
  const checkInSlots = [];
  const slotFor = (list, id) => { const slot = reactionSlot(); list.push({ id, slot, own: false }); return slot; };
  const latestCard = latest
    ? el("section", { class: "card", style: "border-top:0" },
        el("div", { class: "rowline" },
          el("span", { class: "place" },
            `${flagEmoji(latest.country_code)} ${cityOnly(latest.place_name)}`.trim()),
          el("span", { class: "pill " + (quiet ? "quiet" : "live") }, staleness(latest.created_at))),
        latest.message ? el("div", { style: "margin-top:8px" }, latest.message) : null,
        latest.checked_in_by ? el("div", { class: "dim", style: "margin-top:6px" }, "Group check-in by someone they're travelling with") : null,
        latest.transport_mode
          ? el("div", { class: "dim", style: "margin-top:6px" },
              `${TRANSPORT[latest.transport_mode]} ${latest.transport_number || ""} ${
                latest.transport_distance_km ? Math.round(latest.transport_distance_km) + " km" : ""}`.trim())
          : null,
        el("div", { class: "photo-slot" }),
        slotFor(checkInSlots, latest.id))
    : el("section", { class: "card", style: "border-top:0" }, el("p", { class: "dim" },
        "No check-ins to show. You'll see their current trip, updates they share outside a trip, and their past trips from after you joined if they've allowed it."));

  // Automatic location (only if they switched it on). Never called a check-in.
  const liveHead = liveData.trail.at(-1) || liveData.lastSeen;
  const liveIsNewer = liveHead && (!latest || new Date(liveHead.recorded_at) > new Date(latest.created_at));
  const livePlace = el("span", { class: "place" }, "Locating place…");
  const liveCard = liveHead && liveIsNewer
    ? el("section", { class: "card live-card" },
        el("div", { class: "rowline" },
          el("span", { style: "display:flex;align-items:center;gap:8px" }, icon("live"),
            el("strong", {}, liveData.session && liveData.trail.length ? "Sharing live" : "Last seen (automatic)")),
          el("span", { class: "pill " + (hoursSince(liveHead.recorded_at) > STALE_HOURS ? "quiet" : "live") },
            staleness(liveHead.recorded_at))),
        el("div", { style: "margin-top:6px" }, livePlace),
        el("p", { class: "dim", style: "margin-top:6px" },
          liveData.session && liveData.trail.length
            ? `Sharing until ${new Date(liveData.session.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. It only updates while Imhere is open on their phone.`
            : "Sent automatically when they opened Imhere. Not a check-in: it says where the phone was, not how they are."))
    : null;
  if (liveCard) {
    reverseGeocode(liveHead.latitude, liveHead.longitude)
      .then((place) => { livePlace.textContent = place ? `${flagEmoji(place.countryCode)} ${place.label}`.trim()
        : `${liveHead.latitude.toFixed(4)}, ${liveHead.longitude.toFixed(4)}`; })
      .catch(() => { livePlace.textContent = `${liveHead.latitude.toFixed(4)}, ${liveHead.longitude.toFixed(4)}`; });
    if (liveData.session && liveData.trail.length) liveCard.append(liveSummary(liveData.trail));
    liveCard.append(mapsButtons(liveHead, traveller.display_name));
    if (liveData.session && liveData.trail.length > 1) liveCard.append(liveTimeline(liveData.trail));
  }

  const planSlots = [];
  const planCards = plans.length
    ? el("div", { class: "card" },
        el("h3", {}, "Plans shared with you"),
        plans.map((plan) => el("div", { class: "list-row" },
          el("div", { class: "rowline" },
            el("span", { style: "font-weight:600" }, plan.destination),
            el("span", { class: "dim" }, `${plan.start_date} – ${plan.end_date}`)),
          (plan.plan_stops || []).sort((a, b) => a.order_index - b.order_index)
            .map((stop) => el("div", { class: "dim" }, `· ${stop.place}`)),
          plan.note ? el("div", { class: "dim" }, plan.note) : null,
          plan.collaborative ? el("div", { class: "dim" }, "Planning together: edit it from the Plans tab.") : null,
          slotFor(planSlots, plan.id))))
    : null;

  // Their posters (only those from trips you're allowed to see).
  const posterCard = posters.length
    ? el("div", { class: "card" },
        el("h3", {}, "Their posters"),
        el("div", { class: "poster-grid" }, posters.map((poster) => {
          const thumb = el("img", { alt: `Poster of ${cityOnly(poster.place_name)}`, loading: "lazy" });
          data.posterURL(poster.poster_path).then((url) => { if (url) thumb.src = url; });
          const tile = el("button", { class: "poster-tile", type: "button" }, thumb,
            el("div", { class: "dim" }, `${flagEmoji(poster.country_code)} ${cityOnly(poster.place_name)}`.trim()),
            el("div", { class: "dim", style: "font-size:12.5px" }, timeLeft(poster.created_at)));
          tile.onclick = async () => {
            const url = await data.posterURL(poster.poster_path);
            if (!url) { toast("Couldn't open that poster", "error"); return; }
            const bar = el("div", { style: "margin-top:var(--s3)" });
            openSheet(cityOnly(poster.place_name),
              el("div", { class: "postcard-stage tall" }, el("img", { class: "postcard-preview", src: url, alt: "" })), bar);
            data.reactionsFor("poster", [poster.id])
              .then((byId) => bar.append(reactionBar("poster", poster.id, byId.get(poster.id) || [])))
              .catch(() => bar.append(reactionBar("poster", poster.id, [])));
          };
          return tile;
        })))
    : null;

  const history = checkIns.length > 1
    ? el("div", { class: "card" },
        el("h3", {}, "Where they've been"),
        checkIns.map((checkIn) => el("div", { class: "list-row" },
          el("div", { class: "rowline" },
            el("span", {}, `${flagEmoji(checkIn.country_code)} ${cityOnly(checkIn.place_name)}`.trim()),
            el("span", { class: "dim" }, (checkIn.checked_in_by ? "group · " : "") + staleness(checkIn.created_at))),
          checkIn.message ? el("div", { class: "dim" }, checkIn.message) : null,
          checkIn.id === latest?.id ? null : slotFor(checkInSlots, checkIn.id))))
    : null;

  document.body.classList.add("is-friend");
  fill(container, backButton,
    el("div", { class: "friend" }, mapBox,
      el("div", {},
        el("div", { style: "display:flex;align-items:center;gap:var(--s3);padding:var(--s3) 0" },
          avatarElement(traveller.display_name, avatarURL),
          el("h2", { style: "font-size:24px" }, traveller.display_name || "Traveller")),
        liveCard, latestCard, planCards, el("div", { class: "friend-postcards-slot" }), posterCard, history)));
  data.friendPostcards(traveller.id).then((list) => {
    const card = friendPostcardsCard(list);
    if (card) container.querySelector(".friend-postcards-slot")?.replaceWith(card);
  }).catch(() => {});
  fillReactions("checkin", checkInSlots);
  fillReactions("plan", planSlots);
  closeFriendGlobe();
  document.body.classList.add("is-friend");
  try {
    friendGlobe = await mountGlobe(mapBox, {
      onPinTap: (item) => friendGlobe.flyTo(item.lat, item.lon, Math.max(0.3, friendGlobe.altitude() * 0.8)),
    });
    friendGlobe.show({ checkIns, origins, person: { name: traveller.display_name, avatarURL } });
    friendGlobe.showLive(liveData);
    if (liveCard) friendGlobe.flyTo(liveHead.latitude, liveHead.longitude, 0.6);
  } catch (error) {
    mapBox.replaceChildren(el("p", { class: "dim", style: "padding:var(--s4)" }, error.message));
  }

  if (latest?.photo_path) {
    const url = await data.photoURL(latest.photo_path);
    if (url) latestCard.querySelector(".photo-slot")
      ?.append(el("img", { class: "photo", src: url, style: "margin-top:10px" }));
  }
}

// ============================================================ invites

function choiceChips(label, options, initial, format) {
  let value = initial;
  const row = el("div", { class: "chips", role: "group", "aria-label": label });
  const buttons = options.map((option) => {
    const chip = el("button", { class: "chip" + (option === value ? " on" : ""), type: "button",
      "aria-pressed": String(option === value) }, format(option));
    chip.onclick = () => {
      value = option;
      buttons.forEach((b, i) => { b.classList.toggle("on", options[i] === option); b.setAttribute("aria-pressed", String(options[i] === option)); });
    };
    return chip;
  });
  row.append(...buttons);
  return { element: el("div", { class: "field" }, el("span", { class: "label" }, label), row), get: () => value };
}

function inviteSheet(reload) {
  const output = el("div", { class: "stack" });
  const activeList = el("div", { class: "stack" });
  const days = choiceChips("Link works for", [1, 3, 7, 14, 30], 7, (d) => (d === 1 ? "1 day" : `${d} days`));
  const people = choiceChips("How many people can join with it", [1, 2, 3, 5, 10], 1, (n) => (n === 1 ? "1 person" : `${n} people`));

  const drawActive = async () => {
    const invites = await data.myInvites().catch(() => []);
    if (!invites.length) { fill(activeList); return; }
    fill(activeList, el("h3", { style: "margin-top:10px" }, "Links that still work"),
      invites.map((invite) => {
        const cancel = el("button", { class: "ghost", type: "button", style: "width:auto" }, "Cancel link");
        cancel.onclick = async () => {
          cancel.disabled = true;
          try { await data.cancelInvite(invite.token); toast("Link cancelled. Nobody new can join with it.", "ok"); drawActive(); }
          catch (error) { toast(error.message, "error"); cancel.disabled = false; }
        };
        return el("div", { class: "list-row rowline" },
          el("div", {},
            el("div", { style: "font-weight:700" }, `${invite.use_count} of ${invite.max_uses} joined`),
            el("div", { class: "dim" }, `Until ${new Date(invite.expires_at).toLocaleDateString([], { day: "numeric", month: "short" })} · …${invite.token.slice(-6)}`)),
          cancel);
      }));
  };

  const create = el("button", { class: "primary" }, "Create an invite link");
  create.onclick = async () => {
    create.disabled = true;
    try {
      const invite = await data.createInvite({ days: days.get(), people: people.get() });
      const link = `${location.origin}${location.pathname}#join=${invite.token}`;
      const box = el("input", { type: "text", value: link, readonly: "readonly" });
      const copy = el("button", { class: "secondary" }, "Copy link");
      copy.onclick = async () => {
        // Don't trust a quiet success: copy, then say so only if it worked.
        let copied = false;
        try { await navigator.clipboard.writeText(link); copied = true; } catch { copied = false; }
        if (copied) toast("Link copied", "ok");
        else { box.select(); toast("Couldn't copy automatically. The link is selected: press ⌘C or long-press to copy."); }
      };
      const who = invite.max_uses === 1 ? "one person" : `up to ${invite.max_uses} people`;
      fill(output,
        el("p", { class: "dim" },
          `Works for ${who} until ${new Date(invite.expires_at).toLocaleDateString([], { day: "numeric", month: "short" })}. Anyone holding it can join, so send it only to them. Each person can use it once: if you remove someone, this link won't let them back in.`),
        box, copy);
      drawActive();
      reload();
    } catch (error) { toast(error.message, "error"); }
    create.disabled = false;
  };

  const code = el("input", { type: "text", placeholder: "Paste an invite link or code" });
  const join = el("button", { class: "secondary" }, "Join their circle");
  join.onclick = async () => {
    const match = code.value.match(/[0-9a-f-]{36}/i);
    if (!match) { toast("That doesn't look like an invite code", "error"); return; }
    join.disabled = true;
    if (/group=/.test(code.value)) {            // a travel-group link pasted here
      try {
        const outcome = await data.joinGroup(match[0]);
        if (outcome === "ok") { toast("You've joined the group", "ok"); closeSheet(); reload(); }
        else toast(data.groupProblem(outcome), "error");
      } catch (error) { toast(error.message, "error"); }
      join.disabled = false;
      return;
    }
    try {
      const outcome = await data.redeemInvite(match[0]);
      if (outcome === "ok") { toast("You've joined their circle", "ok"); closeSheet(); reload(); }
      else toast(data.inviteProblem(outcome), "error");
    } catch (error) { toast(error.message, "error"); }
    join.disabled = false;
  };

  openSheet("Invites",
    el("div", { class: "stack" },
      el("h3", {}, "Invite someone to follow me"),
      days.element, people.element,
      create, output, activeList,
      el("h3", { style: "margin-top:10px" }, "Follow someone else"),
      code, join));
  drawActive();
}

// ============================================================ main screen

async function render(container, options = {}) {
  setSubtitle("");
  const [members, travellers] = await Promise.all([data.myCircle(), data.myTravellers()]);
  const reload = () => render(container);

  const invite = el("button", { class: "primary" }, "Invite / join with a code");
  invite.onclick = () => inviteSheet(reload);

  const followingCard = el("section", { class: "card" },
    el("h3", {}, "People I'm following"),
    travellers.length
      ? travellers.map((traveller) => {
          const face = avatarElement(traveller.display_name, null);
          data.avatarURL(traveller.avatar_path).then((url) => { if (url) fill(face, el("img", { src: url, alt: "" })); });
          const row = el("button", { class: "list-row rowline", type: "button",
            style: "width:100%;background:none;border-left:0;border-right:0;border-bottom:0;cursor:pointer;text-align:left" },
            el("span", { style: "display:flex;align-items:center;gap:var(--s3)" }, face,
              el("span", { style: "font-weight:700" }, traveller.display_name || "Traveller")),
            el("span", { class: "dim" }, "View"));
          row.onclick = () => friendView(container, traveller, reload);
          return row;
        })
      : el("div", { class: "dim" }, "Nobody yet. Ask a traveller for their invite link."));

  const myCircleCard = el("section", { class: "card" },
    el("h3", {}, "People who can see me"),
    members.length
      ? members.map((member) => {
          const toggle = el("button",
            { class: "chip" + (member.can_view_history ? " on" : ""), type: "button",
              "aria-pressed": String(Boolean(member.can_view_history)),
              title: "Past trips they can see: only trips you started after they joined" },
            member.can_view_history ? "Past trips: on" : "Past trips: off");
          toggle.onclick = async () => {
            const next = !member.can_view_history;
            await data.setHistoryAccess(member.member_id, next);
            member.can_view_history = next;
            toggle.classList.toggle("on", next);
            toggle.textContent = next ? "Past trips: on" : "Past trips: off";
            toggle.setAttribute("aria-pressed", String(next));
            toast(next ? `${member.display_name} can see trips you've started since they joined` : `${member.display_name} now only sees your current trip`, "ok");
          };
          const remove = el("button", { class: "icon-button", "aria-label": `Remove ${member.display_name}` }, icon("close"));
          remove.onclick = async () => {
            if (!(await confirmSheet("Remove from your circle?",
              `${member.display_name} will stop seeing where you are.`, "Remove"))) return;
            await data.removeMember(member.member_id);
            toast("Removed", "ok");
            reload();
          };
          const face = avatarElement(member.display_name, null);
          data.avatarURL(member.avatar_path).then((url) => { if (url) fill(face, el("img", { src: url, alt: "" })); });
          return el("div", { class: "list-row" },
            el("div", { class: "rowline" },
              el("div", { style: "display:flex;align-items:center;gap:var(--s3);min-width:0" }, face, el("div", {},
                el("div", { style: "font-weight:700" }, member.display_name),
                el("div", { class: "dim" },
                  member.status === "active" ? "Active" : "Invited"))),
              el("div", { style: "display:flex;gap:8px;align-items:center" }, toggle, remove)));
        })
      : el("div", { class: "dim" },
          "Nobody can see you yet. Create an invite link and send it to someone."));

  closeFriendGlobe();
  if (options.openPerson) { await friendView(container, options.openPerson, reload); return; }
  const groups = await groupsCard({ reload, openMember: (person) => friendView(container, person, reload) })
    .catch(() => null);
  fill(container, el("div", { style: "padding-bottom:var(--s5)" }, invite), groups, followingCard, myCircleCard,
    el("p", { class: "dim", style: "padding:var(--s3) 0" },
      "Everyone in your circle sees your current trip, unless you choose who can see it from the trip card. With Past trips on, they also see trips you've started since they joined, never anything older. New people start with Past trips on; switch it off for anyone who should only see your current trip. Plans are shared one by one."));
}

export default { render };
