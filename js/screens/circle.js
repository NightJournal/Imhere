// ---------------------------------------------------------------
// Circle — who can see me, who I can see, and invite links.
// The friend view lives here too (tap a traveller to open it).
// ---------------------------------------------------------------
import { el, fill, toast, staleness, hoursSince, cityOnly, flagEmoji,
         TRANSPORT, openSheet, closeSheet, confirmSheet, icon, avatarElement } from "../ui.js";
import { STALE_HOURS } from "../config.js";
import * as data from "../db.js";
import { setSubtitle } from "../app.js";
import { mountGlobe } from "../globe.js";
import { reverseGeocode } from "../geo.js";

let friendGlobe = null;

function closeFriendGlobe() {
  if (friendGlobe) { friendGlobe.destroy(); friendGlobe = null; }
  document.body.classList.remove("is-friend");
}

// ============================================================ friend view

async function friendView(container, traveller, back) {
  fill(container, el("div", { class: "empty", "aria-busy": "true" }, el("p", { class: "dim" }, "Loading…")));
  const [{ checkIns, plans, origins, profile }, liveData] = await Promise.all([
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
  const latestCard = latest
    ? el("section", { class: "card", style: "border-top:0" },
        el("div", { class: "rowline" },
          el("span", { class: "place" },
            `${flagEmoji(latest.country_code)} ${cityOnly(latest.place_name)}`.trim()),
          el("span", { class: "pill " + (quiet ? "quiet" : "live") }, staleness(latest.created_at))),
        latest.message ? el("div", { style: "margin-top:8px" }, latest.message) : null,
        latest.transport_mode
          ? el("div", { class: "dim", style: "margin-top:6px" },
              `${TRANSPORT[latest.transport_mode]} ${latest.transport_number || ""} ${
                latest.transport_distance_km ? Math.round(latest.transport_distance_km) + " km" : ""}`.trim())
          : null,
        el("div", { class: "photo-slot" }))
    : el("section", { class: "card", style: "border-top:0" }, el("p", { class: "dim" },
        "No check-ins visible yet. You'll see their current trip; older trips need their permission."));

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
            ? `Their route is on the globe until ${new Date(liveData.session.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. It only updates while Imhere is open on their phone.`
            : "Sent automatically when they opened Imhere. Not a check-in: it says where the phone was, not how they are."))
    : null;
  if (liveCard) {
    reverseGeocode(liveHead.latitude, liveHead.longitude)
      .then((place) => { livePlace.textContent = place ? `${flagEmoji(place.countryCode)} ${place.label}`.trim()
        : `${liveHead.latitude.toFixed(4)}, ${liveHead.longitude.toFixed(4)}`; })
      .catch(() => { livePlace.textContent = `${liveHead.latitude.toFixed(4)}, ${liveHead.longitude.toFixed(4)}`; });
    const look = el("button", { class: "secondary", type: "button", style: "margin-top:10px" }, "Show on globe");
    look.onclick = () => friendGlobe?.flyTo(liveHead.latitude, liveHead.longitude, 0.25);
    liveCard.append(look);
  }

  const planCards = plans.length
    ? el("div", { class: "card" },
        el("h3", {}, "Plans shared with you"),
        plans.map((plan) => el("div", { class: "list-row" },
          el("div", { class: "rowline" },
            el("span", { style: "font-weight:600" }, plan.destination),
            el("span", { class: "dim" }, `${plan.start_date} – ${plan.end_date}`)),
          (plan.plan_stops || []).sort((a, b) => a.order_index - b.order_index)
            .map((stop) => el("div", { class: "dim" }, `· ${stop.place}`)),
          plan.note ? el("div", { class: "dim" }, plan.note) : null)))
    : null;

  const history = checkIns.length > 1
    ? el("div", { class: "card" },
        el("h3", {}, "Where they've been"),
        checkIns.map((checkIn) => el("div", { class: "list-row" },
          el("div", { class: "rowline" },
            el("span", {}, `${flagEmoji(checkIn.country_code)} ${cityOnly(checkIn.place_name)}`.trim()),
            el("span", { class: "dim" }, staleness(checkIn.created_at))))))
    : null;

  document.body.classList.add("is-friend");
  fill(container, backButton,
    el("div", { class: "friend" }, mapBox,
      el("div", {},
        el("div", { style: "display:flex;align-items:center;gap:var(--s3);padding:var(--s3) 0" },
          avatarElement(traveller.display_name, avatarURL),
          el("h2", { style: "font-size:24px" }, traveller.display_name || "Traveller")),
        liveCard, latestCard, planCards, history)));
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

function inviteSheet(reload) {
  const output = el("div", { class: "stack" });
  const create = el("button", { class: "primary" }, "Create an invite link");
  create.onclick = async () => {
    create.disabled = true;
    try {
      const invite = await data.createInvite();
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
      fill(output,
        el("p", { class: "dim" },
          "Send this to the person you want in your circle. It works for 7 days, and they join the moment they open it and sign in."),
        box, copy);
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
    try {
      const outcome = await data.redeemInvite(match[0]);
      if (outcome === "ok") { toast("You've joined their circle", "ok"); closeSheet(); reload(); }
      else if (outcome === "own") toast("That's your own invite link", "error");
      else toast("That invite has expired or isn't valid", "error");
    } catch (error) { toast(error.message, "error"); }
    join.disabled = false;
  };

  openSheet("Invites",
    el("div", { class: "stack" },
      el("h3", {}, "Invite someone to follow me"),
      create, output,
      el("h3", { style: "margin-top:10px" }, "Follow someone else"),
      code, join));
}

// ============================================================ main screen

async function render(container) {
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
            { class: "chip" + (member.can_view_history ? " on" : ""), type: "button" },
            member.can_view_history ? "History: on" : "History: off");
          toggle.onclick = async () => {
            const next = !member.can_view_history;
            await data.setHistoryAccess(member.member_id, next);
            member.can_view_history = next;
            toggle.classList.toggle("on", next);
            toggle.textContent = next ? "History: on" : "History: off";
            toast(next ? "They can now see your past trips" : "Past trips hidden again", "ok");
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
  fill(container, el("div", { style: "padding-bottom:var(--s5)" }, invite), followingCard, myCircleCard,
    el("p", { class: "dim", style: "padding:var(--s3) 0" },
      "Your circle always sees your current trip. Past trips are hidden until you switch History on for that person. Plans are shared one by one."));
}

export default { render };
