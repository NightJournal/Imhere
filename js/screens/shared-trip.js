import { el, fill, flagEmoji, cityOnly } from "../ui.js";
import { readSharedTrip } from "../db.js";
import { mountGlobe } from "../globe.js";

/** Guest route: never enters authenticated boot, starts live sharing, or writes data. */
export async function renderSharedTrip(container, token) {
  for (const id of ["boot", "rail", "topbar", "tabbar"]) document.getElementById(id)?.classList.add("hidden");
  document.body.classList.add("guest-view");
  const content = el("div", { class: "guest-content" });
  const home = el("a", { href: location.pathname, class: "button-link ghost" }, "Open Imhere");
  const header = el("header", { class: "guest-header" },
    el("img", { src: "assets/watercolor-stand-logo.png", alt: "", width: "64", height: "64" }),
    el("div", {}, el("h1", {}, "A shared journey"), el("p", { class: "dim" }, "View only · No account needed")), home);
  fill(container, header, content);
  let globe = null, timer = null, busy = false;
  const refresh = el("button", { class: "secondary", type: "button" }, "Refresh trip");
  async function load() {
    if (busy) return;
    busy = true; refresh.disabled = true;
    clearTimeout(timer); globe?.destroy(); globe = null;
    fill(content, el("p", { role: "status", class: "dim" }, "Loading shared trip…"));
    try {
      const trip = await readSharedTrip(token);
      if (!trip) {
        fill(content, el("section", { class: "card" }, el("h2", {}, "This link is no longer available"),
          el("p", { class: "dim" }, "It may have expired or been cancelled. Ask the traveller for a new link.")));
        return;
      }
      const entries = trip.check_ins || [];
      const map = el("div", { class: "guest-globe", "aria-label": "Shared trip map" });
      fill(content, el("h2", {}, `${trip.display_name || "A traveller"}'s trip`),
        el("p", { class: "dim" }, "Shared check-ins and approximate map positions. This is not live location."),
        entries.length ? map : el("p", {}, "No check-ins on this trip yet."),
        el("section", { class: "card" }, entries.map(c => el("div", { class: "list-row rowline" },
          el("span", {}, `${flagEmoji(c.country_code)} ${cityOnly(c.place_name)}`.trim()),
          el("time", { datetime: c.created_at, class: "dim" }, new Date(c.created_at).toLocaleDateString())))), refresh);
      // Re-check revocation while open; hide stale content if the check cannot succeed.
      const remaining = new Date(trip.expires_at).getTime() - Date.now();
      timer = setTimeout(load, Math.max(1000, Math.min(60000, remaining)));
      if (entries.length) {
        try {
          globe = await mountGlobe(map);
          globe.show({ checkIns: entries, origins: [], person: { name: trip.display_name } });
        } catch { fill(map, el("p", { class: "dim" }, "The map couldn't load. Your shared stops are listed below.")); }
      }
    } catch {
      fill(content, el("p", { role: "status" }, "Couldn't open this shared trip. Check your connection and try again."), refresh);
    } finally { busy = false; refresh.disabled = false; }
  }
  refresh.onclick = load;
  window.addEventListener("pagehide", () => { clearTimeout(timer); globe?.destroy(); }, { once: true });
  await load();
}
