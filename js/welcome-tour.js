import { el, fill, icon } from "./ui.js";

const dismissed = new Set();
let activeTour = null;
const keyFor = userId => `imhere.welcome.v1.${userId}`;
export function needsWelcome(userId) {
  if (!userId || dismissed.has(userId)) return false;
  try { return localStorage.getItem(keyFor(userId)) !== "done"; }
  catch { return true; }
}
export function dismissWelcome() { activeTour?.close(); }

export function showWelcome({ userId, onCheckin }) {
  if (activeTour) return;
  const steps = [
    { title: "Keep a little memory", icon: "pin", text: "Tap Check in when you arrive somewhere. Choose your location and add a photo if you like.", tip: "Start with where you are today." },
    { title: "Watch your world grow", icon: "earth", text: "Your check-ins appear on My Earth. Drag to spin the globe, zoom in, and tap a place to revisit it.", tip: "Every stop becomes part of your travel journal." },
    { title: "Send a little keepsake", icon: "share", text: "Open Postcard from a trip. Choose a layout, edit the heading or add a photo, then save your postcard.", tip: "Explore Plans for upcoming trips and Circle to connect with people you know." },
  ];
  const opener = document.activeElement;
  const dialog = el("dialog", { class: "welcome-tour", "aria-labelledby": "welcome-title", "aria-describedby": "welcome-copy" });
  activeTour = dialog;
  let index = 0;
  const skip = el("button", { class: "ghost tour-skip", type: "button" }, "Skip intro");
  skip.onclick = () => dialog.close();
  const header = el("div", { class: "tour-topline" }, el("span", {}, "A LITTLE GUIDE TO IMHERE"), skip);
  const art = el("div", { class: "tour-art", "aria-hidden": "true" });
  const progress = el("p", { class: "tour-progress", "aria-live": "polite" });
  const title = el("h2", { id: "welcome-title", tabindex: "-1" });
  const copy = el("p", { id: "welcome-copy", class: "tour-copy" });
  const tip = el("p", { class: "tour-tip" });
  const back = el("button", { class: "secondary", type: "button" }, "Back");
  const next = el("button", { class: "primary", type: "button" }, "Next");
  back.onclick = () => { index--; render(); title.focus(); };
  next.onclick = () => {
    if (index < steps.length - 1) { index++; render(); title.focus(); }
    else { dialog.close(); onCheckin?.(); }
  };
  const later = el("button", { class: "ghost tour-later", type: "button" }, "Explore on my own");
  later.onclick = () => dialog.close();
  function render() {
    const step = steps[index];
    fill(art, el("img", { src: "assets/watercolor-stand-logo.png", alt: "" }), el("span", { class: "tour-badge" }, icon(step.icon)));
    progress.textContent = `${index + 1} of ${steps.length} · About 30 seconds`;
    title.textContent = step.title; copy.textContent = step.text; tip.textContent = step.tip;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? "Make my first check-in" : "Next";
    later.hidden = index !== steps.length - 1;
  }
  dialog.append(header, art, progress, title, copy, tip,
    el("div", { class: "tour-actions" }, back, next), later);
  dialog.addEventListener("close", () => {
    dismissed.add(userId);
    try { localStorage.setItem(keyFor(userId), "done"); } catch { /* usable with storage disabled */ }
    activeTour = null; dialog.remove(); opener?.focus?.();
  }, { once: true });
  document.body.append(dialog); render(); dialog.showModal(); next.focus();
}
