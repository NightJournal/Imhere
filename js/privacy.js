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
      "Check-ins: your circle sees the ones from your current trip. Check-ins made outside a trip, and past trips, stay private unless you switch History on for that person.",
      "Your one photo: your circle can open it only when they can see the check-in it belongs to. A new photo replaces the old one.",
      "Your name, profile picture and travel plans you choose to share are visible to your circle.",
      "Remove someone and they lose access straight away. An old invite link won't let them back in."),
    section("Automatic location (only if you turn it on)",
      "Share when I open Imhere: one “last seen” point, replaced each time. Turning it off deletes it.",
      "Live sharing: your route while Imhere is open on screen, for the time you choose (24 hours at most). Stopping deletes the route. Your circle sees these even when you're not on a trip, marked as automatic, not as check-ins."),
    section("Where your data is kept",
      "Your account, check-ins, plans and photos are stored with Supabase, in Singapore, protected by rules that check who is asking.",
      "To turn a location into a place name, Imhere sends the coordinates (not your name or account) to Photon, a public place-search service run by komoot in Germany. Like any website, it sees the internet address of the phone asking.",
      "If you sign in with Google, Google tells Imhere your email address and name.",
      "The website itself is served by GitHub Pages. No ads, no analytics, no tracking."),
    section("On this phone",
      "Your check-in passcode is kept only on this device, scrambled. Imhere never sends it anywhere.",
      "Check-ins made without signal wait on this phone until they can be sent. Signing out deletes anything still waiting, so it can never be sent from someone else's account."),
    section("Getting your data removed",
      "Delete a check-in or plan from the app at any time. To delete your whole account and everything linked to it, ask the person who runs this Imhere."));
}
