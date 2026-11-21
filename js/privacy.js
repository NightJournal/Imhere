// ---------------------------------------------------------------
// Privacy note — plain words on what Imhere keeps, where, and who
// can see it. Opened from the sign-in screen and from You.
// Keep this in step with server/setup.sql when the rules change.
// ---------------------------------------------------------------
import { el, openSheet } from "./ui.js";

const section = (title, ...lines) => el("section", { class: "card stack" },
  el("h3", {}, title), ...lines.map((line) => el("p", { class: "dim" }, line)));

export function openPrivacy() {
  openSheet("Privacy",
    el("p", { style: "margin-bottom:var(--s4)" },
      "Imhere is for telling a few chosen people where you are. Here is exactly what that means."),
    section("Who can see what",
      "Only people in your circle, and only people who joined with an invite link you made. Nobody else, and nobody who isn't signed in.",
      "Check-ins: your circle sees your current trip. Past trips: each person has a switch (Circle \u2192 Past trips, on for new people). Even when it's on, they only see trips you started after they joined, never your older history. Check-ins made outside a trip stay private.",
      "Your one photo: your circle can open it only when they can see the check-in it belongs to. A new photo replaces the old one. Photos are shrunk on your phone before upload, which also removes hidden details like where the photo was taken.",
      "Your name, profile picture and travel plans you choose to share are visible to your circle.",
      "Remove someone and they lose access straight away. An old invite link won't let them back in."),
    section("Automatic location (only if you turn it on)",
      "Share when I open Imhere: one “last seen” point, replaced each time. Turning it off deletes it.",
      "Live sharing: your route while Imhere is open on screen, for the time you choose (24 hours at most). Stopping deletes the route. Your circle sees these even when you're not on a trip, marked as automatic, not as check-ins."),
    section("Friend groups",
      "A friend group has no end date. Its members see each other's current trip and live location only: no past trips, no check-ins outside a trip. Only the person who made it can invite, with links that expire after 7 days.",
      "\u201cShare with this group\u201d off pauses it both ways: they don't see you, you don't see them. Leaving, being removed or the group being closed stops it for good."),
    section("Travel groups",
      "A travel group has an end date (30 days at most). Until then, its members see each other's check-ins, last-seen point and live route from the group's time, never anything older. When it ends, or when someone leaves or is removed, that stops.",
      "\u201cCheck in for the group\u201d adds that check-in to the history of members who allow it (a switch in the group), marked as a group check-in, so their own circle sees it. Each person can delete it."),
    section("Where your data is kept",
      "Your account, check-ins, plans and photos are stored with Supabase, in Singapore, protected by rules that check who is asking.",
      "To turn a location into a place name, Imhere sends the coordinates (not your name or account) to Photon, a public place-search service run by komoot in Germany. Like any website, it sees the internet address of the phone asking.",
      "If you sign in with Google, Google tells Imhere your email address and name.",
      "\u201cOpen in Apple Maps / Google Maps\u201d on someone's live card hands that one position to the map app you choose, only when you tap it.",
      "The website itself is served by GitHub Pages. No ads, no analytics, no tracking."),
    section("On this phone",
      "Your check-in passcode is kept only on this device, scrambled. Imhere never sends it anywhere.",
      "Check-ins made without signal wait on this phone until they can be sent. Signing out deletes anything still waiting, so it can never be sent from someone else's account."),
    section("Getting your data removed",
      "Delete a check-in or plan from the app at any time. To delete everything, open You \u2192 Delete my account: your login, check-ins, plans, posters, photos, circle and location are all removed for good."));
}
