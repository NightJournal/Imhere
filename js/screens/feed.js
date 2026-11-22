// ---------------------------------------------------------------
// Circle feed: the last 7 days from everyone you can see — check-ins,
// posted postcards, posters, shared plans and live sharing — newest
// first, with reactions. Tap a name to open that person.
// ---------------------------------------------------------------
import { el, fill, staleness, cityOnly, flagEmoji, avatarElement, TRANSPORT, toast, openSheet } from "../ui.js";
import * as data from "../db.js";
import { go } from "../app.js";
import { reactionSlot, fillReactions } from "../reactions.js";
import { timeLeft } from "./posters.js";

const DAYS = 7;

const shortDate = (iso) => new Date(iso + (iso.length === 10 ? "T00:00:00" : ""))
  .toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Load an image only when it scrolls into view (photos cost download allowance). */
function lazyImage(load, attrs) {
  const img = el("img", { ...attrs, loading: "lazy" });
  const start = () => load().then((url) => { if (url) img.src = url; }).catch(() => {});
  if (!("IntersectionObserver" in window)) { start(); return img; }
  const watcher = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { watcher.disconnect(); start(); }
  }, { rootMargin: "300px" });
  watcher.observe(img);
  return img;
}

function openImage(title, url, caption) {
  openSheet(title,
    el("div", { class: "postcard-stage tall" }, el("img", { class: "postcard-preview", src: url, alt: caption || "" })),
    caption ? el("p", { style: "margin-top:var(--s3)" }, caption) : null);
}

/**
 * The feed card. openPerson(person) opens their page.
 */
export async function feedCard(openPerson) {
  const { people, items } = await data.circleFeed({ days: DAYS });
  if (!people.size) return null;   // nobody to follow yet: the rest of the page explains

  const slots = { checkin: [], plan: [], poster: [], postcard: [] };
  const slot = (kind, id) => { const s = reactionSlot(); slots[kind].push({ id, slot: s, own: false }); return s; };

  const rows = items.map((item) => {
    const person = people.get(item.user_id) || { id: item.user_id, display_name: "Friend" };
    const face = avatarElement(person.display_name, null);
    if (person.avatar_path) data.avatarURL(person.avatar_path).then((url) => { if (url) fill(face, el("img", { src: url, alt: "" })); }).catch(() => {});
    const who = el("button", { class: "feed-who", type: "button", "aria-label": `Open ${person.display_name}` },
      face, el("span", { class: "feed-name" }, person.display_name));
    who.onclick = () => openPerson(person);
    const head = el("div", { class: "feed-head" }, who, el("span", { class: "dim" }, staleness(item.at)));
    const r = item.row;
    let body;

    if (item.kind === "checkin") {
      const photo = r.photo_path
        ? lazyImage(() => data.photoURL(r.photo_path), { class: "feed-photo", alt: `Photo at ${cityOnly(r.place_name)}` })
        : null;
      body = [
        el("div", { class: "place" }, `${flagEmoji(r.country_code)} ${cityOnly(r.place_name)}`.trim()),
        r.message ? el("div", { style: "margin-top:4px" }, r.message) : null,
        r.transport_mode ? el("div", { class: "dim", style: "margin-top:4px" },
          `${TRANSPORT[r.transport_mode] || ""} ${r.transport_number || ""} ${r.transport_distance_km ? Math.round(r.transport_distance_km) + " km" : ""}`.trim()) : null,
        r.checked_in_by ? el("div", { class: "dim", style: "margin-top:4px" }, "Group check-in") : null,
        photo,
        slot("checkin", r.id),
      ];
    } else if (item.kind === "postcard" || item.kind === "poster") {
      const isCard = item.kind === "postcard";
      const load = () => (isCard ? data.postcardURL(r.image_path) : data.posterURL(r.poster_path));
      const img = lazyImage(load, { class: "feed-image", alt: isCard ? (r.caption || "Postcard") : `Poster of ${cityOnly(r.place_name)}` });
      const open = el("button", { class: "feed-image-button", type: "button", "aria-label": isCard ? "Open postcard" : "Open poster" }, img);
      open.onclick = async () => {
        const url = await load();
        if (url) openImage(isCard ? "Postcard" : cityOnly(r.place_name), url, isCard ? r.caption : null);
        else toast("Couldn't open it", "error");
      };
      body = [
        el("div", { class: "dim" }, isCard ? "Posted a postcard" : `Made a poster of ${cityOnly(r.place_name)}`),
        open,
        isCard && r.caption ? el("div", { style: "margin-top:6px" }, r.caption) : null,
        el("div", { class: "dim", style: "font-size:12.5px;margin-top:2px" }, timeLeft(r.created_at)),
        slot(item.kind, r.id),
      ];
    } else if (item.kind === "plan") {
      const stops = (r.plan_stops || []).slice().sort((a, b) => a.order_index - b.order_index);
      const edit = r.collaborative ? el("button", { class: "secondary", type: "button", style: "margin-top:8px" }, "Edit together in Plans") : null;
      if (edit) edit.onclick = () => go("plans");
      body = [
        el("div", { class: "dim" }, r.updated_at && r.updated_by !== r.user_id ? "Plan updated" : "Shared a plan"),
        el("div", { class: "place" }, `${r.destination} · ${shortDate(r.start_date)}–${shortDate(r.end_date)}`),
        stops.length ? el("div", { class: "dim" }, stops.map((s) => s.place).join(" → ")) : null,
        r.note ? el("div", { style: "margin-top:4px" }, r.note) : null,
        edit,
        slot("plan", r.id),
      ];
    } else {   // live
      const view = el("button", { class: "secondary", type: "button", style: "margin-top:8px" }, "See where they are");
      view.onclick = () => openPerson(person);
      body = [el("div", { class: "place" }, "📡 Sharing live location now"), view];
    }
    return el("article", { class: "feed-item" }, head, ...body);
  });

  for (const kind of Object.keys(slots)) fillReactions(kind, slots[kind]);

  return el("section", { class: "card feed" },
    el("h3", {}, "Updates"),
    rows.length ? rows
      : el("p", { class: "dim" }, `Nothing new from your people in the last ${DAYS} days.`));
}
