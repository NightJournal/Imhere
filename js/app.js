// ---------------------------------------------------------------
// Boot + router. Every screen module exports render(container).
// Check in is not a tab any more: it's the raised button (phone) or the
// rail button (desktop), and it opens as a sheet/panel over My Earth.
// ---------------------------------------------------------------
import { $, el, fill, toast, openSheet, closeSheet, icon, avatarElement, sparkle } from "./ui.js";
import * as data from "./db.js";
import * as outbox from "./outbox.js";
import authScreen, { redeemPendingInvite } from "./screens/auth.js";
import earthScreen from "./screens/earth.js";
import { openCheckin } from "./screens/checkin.js";
import plansScreen from "./screens/plans.js";
import circleScreen from "./screens/circle.js";

import { needsWelcome, showWelcome, dismissWelcome } from "./welcome-tour.js";

const SCREENS = {
  earth:   { title: "My Earth",  module: earthScreen },
  plans:   { title: "Plans",     module: plansScreen },
  circle:  { title: "Circle",    module: circleScreen },
};

export const app = {
  user: null,
  profile: null,
  avatarURL: null,
  tab: "earth",
};

/** Switch screens. `go("earth")` from anywhere. "checkin" opens the sheet. */
export async function go(tab, options = {}) {
  if (tab === "checkin") { checkin(); return; }
  if (!SCREENS[tab]) tab = "earth";
  app.tab = tab;
  for (const button of document.querySelectorAll(".tab[data-tab]")) {
    const on = button.dataset.tab === tab;
    button.classList.toggle("active", on);
    if (on) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  document.body.classList.toggle("is-earth", tab === "earth");
  document.body.classList.remove("is-friend");
  $("screenTitle").textContent = SCREENS[tab].title;
  $("screenSubtitle").textContent = "";
  const container = $("screen");
  if (tab !== "earth") fill(container, el("div", { class: "empty", "aria-busy": "true" }, el("p", { class: "dim" }, "Loading…")));
  window.scrollTo(0, 0);
  try {
    await SCREENS[tab].module.render(container, options);
  } catch (error) {
    console.error(error);
    // Most likely no signal. Say so plainly and point at what still works.
    const offline = !navigator.onLine || outbox.isNetworkError(error);
    const toCheckin = el("button", { class: "primary" }, "Check in anyway");
    toCheckin.onclick = checkin;
    document.body.classList.remove("is-earth");
    fill(container, el("div", { class: "empty" },
      el("div", { class: "big", "aria-hidden": "true" }),
      el("p", {}, offline ? "No signal right now" : "This didn't load"),
      el("p", { class: "dim" }, offline
        ? "You can still check in. It waits on this device and sends itself when you're back online."
        : (error?.message || "Try again in a moment.")),
      toCheckin));
  }
}

/** Open the check-in sheet. After a successful check-in, show My Earth. */
export function checkin() {
  openCheckin({
    onDone: (sent) => { if (sent && app.tab === "earth") go("earth", { bloom: true });
                        else if (sent) go("earth"); },
  });
}

export function setSubtitle(text) {
  $("screenSubtitle").textContent = text || "";
}

/** Reload the profile after something changes the current trip. */
export async function refreshProfile() {
  try { app.profile = await data.myProfile(); }
  catch (error) { if (navigator.onLine && !outbox.isNetworkError(error)) throw error; return app.profile; }
  app.avatarURL = await data.avatarURL(app.profile?.avatar_path).catch(() => null);
  drawAccountButtons();
  return app.profile;
}

function drawAccountButtons() {
  const name = app.profile?.display_name || app.user?.email || "";
  const rail = $("railAccount");
  if (rail) fill(rail, avatarElement(name, app.avatarURL),
    el("span", { class: "who" }, name || "Account", el("small", {}, app.user?.email || "")));
  const tab = document.querySelector('#tabbar [data-action="account"]');
  if (tab) {
    const face = avatarElement(name, app.avatarURL);
    face.style.cssText = "width:26px;height:26px;font-size:11px";
    fill(tab, face, "You");
  }
}

function decorateNav() {
  const icons = { earth: "earth", plans: "plans", circle: "circle" };
  for (const button of document.querySelectorAll(".tab[data-tab]")) {
    const label = button.textContent.trim();
    fill(button, icon(icons[button.dataset.tab]), el("span", {}, label));
    button.onclick = () => go(button.dataset.tab);
  }
  for (const button of document.querySelectorAll('[data-action="checkin"]')) {
    fill(button, icon("pin"), el("span", {}, "Check in"));
    button.onclick = checkin;
  }
  document.querySelector(".rail-brand")?.append(sparkle());
  document.querySelector('#tabbar [data-action="account"]').onclick = accountSheet;
  $("railAccount").onclick = accountSheet;
}

async function showSignedIn() {
  app.user = await data.currentUser();
  try {
    app.profile = await data.ensureProfile();
  } catch {
    // No signal: fall back to the copy saved last time we were online.
    app.profile = JSON.parse(localStorage.getItem("imhere.profile") || "null");
  }
  app.avatarURL = navigator.onLine ? await data.avatarURL(app.profile?.avatar_path).catch(() => null) : null;
  $("boot").classList.add("hidden");
  $("topbar").classList.remove("hidden");
  $("tabbar").classList.remove("hidden");
  $("rail").classList.remove("hidden");
  document.body.classList.add("signed-in");
  drawAccountButtons();

  // Arrived through an invite link? Join now. (Covers the Google route too:
  // the token waited in sessionStorage while the page was away at Google.)
  if (navigator.onLine) await redeemPendingInvite();

  // Waiting check-ins send themselves when the signal comes back.
  outbox.startAutoFlush((sent) =>
    toast(sent === 1 ? "Your waiting check-in was sent" : `${sent} waiting check-ins sent`, "ok"));

  // Offline, My Earth can't load anything new — the useful thing is Check in.
  await go("earth");
  if (!navigator.onLine) checkin();
  else if (needsWelcome(app.user?.id)) showWelcome({ userId: app.user.id, onCheckin: checkin });
}

async function showSignedOut() {
  dismissWelcome();
  app.user = null;
  app.profile = null;
  $("boot").classList.add("hidden");
  $("topbar").classList.add("hidden");
  $("tabbar").classList.add("hidden");
  $("rail").classList.add("hidden");
  document.body.classList.remove("is-earth", "signed-in");
  await authScreen.render($("screen"), { onSignedIn: showSignedIn });
}

/** Shrink and square-crop a picture for the avatar: 400×400 JPEG. */
async function squareAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 400;
  canvas.getContext("2d").drawImage(bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 400, 400);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Couldn't prepare that picture.");
  return blob;
}

function accountSheet() {
  const name = app.profile?.display_name || "";
  const face = avatarElement(name, app.avatarURL, "lg");
  const fileInput = el("input", { type: "file", accept: "image/*", class: "sr-only", "aria-hidden": "true", tabindex: "-1" });
  const change = el("button", { class: "secondary", type: "button" }, icon("camera"),
    app.profile?.avatar_path ? "Change photo" : "Add a profile photo");
  const remove = app.profile?.avatar_path
    ? el("button", { class: "ghost", type: "button" }, "Remove photo") : null;
  change.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    change.disabled = true;
    try {
      const blob = await squareAvatar(file);
      await data.uploadAvatar(blob);
      await refreshProfile();
      fill(face, el("img", { src: app.avatarURL || URL.createObjectURL(blob), alt: "" }));
      toast("Profile photo updated", "ok");
      if (app.tab === "earth") go("earth");
    } catch (error) { toast(error.message || "Couldn't upload that photo", "error"); }
    change.disabled = false;
  };
  if (remove) remove.onclick = async () => {
    remove.disabled = true;
    try {
      await data.removeAvatar();
      await refreshProfile();
      toast("Photo removed", "ok");
      closeSheet();
      if (app.tab === "earth") go("earth");
    } catch (error) { toast(error.message, "error"); remove.disabled = false; }
  };

  const nameInput = el("input", { type: "text", value: name, autocomplete: "name" });
  const save = el("button", { class: "primary" }, "Save name");
  save.onclick = async () => {
    save.disabled = true;
    try {
      await data.ensureProfile(nameInput.value.trim());
      await refreshProfile();
      toast("Name saved", "ok");
      closeSheet();
    } catch (error) { toast(error.message, "error"); }
    save.disabled = false;
  };

  const out = el("button", { class: "danger" }, "Sign out");
  out.onclick = async () => {
    localStorage.removeItem("imhere.earth");   // don't leave your map on a shared device
    await data.signOut(); closeSheet(); location.reload();
  };

  const replay = el("button", { class: "secondary", type: "button" }, "Replay welcome guide");
  replay.onclick = () => { closeSheet(); showWelcome({ userId: app.user?.id, onCheckin: checkin }); };

  openSheet("You",
    el("div", { class: "stack", style: "text-align:center;padding-bottom:var(--s5)" },
      el("div", { style: "display:flex;justify-content:center" }, face),
      el("p", { class: "dim" }, app.user?.email || ""),
      el("p", { class: "dim" }, "Your photo sits on your latest pin, for you and your circle."),
      change, remove, fileInput),
    el("div", { class: "card stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Display name"), nameInput),
      save),
    el("div", { class: "card stack" }, replay, out)
  );
}

async function boot() {
  // supabase-js is vendored, not loaded from a CDN. If fetch-vendor.sh
  // hasn't been run it simply isn't there, and nothing else will work.
  // (globe.gl is checked when the globe first loads.)
  if (!window.supabase) {
    $("boot").innerHTML =
      '<div style="max-width:420px;text-align:center;padding:24px">' +
      '<h2 style="margin:12px 0 8px;font-size:22px">Libraries missing</h2>' +
      '<p>Run <code>sh fetch-vendor.sh</code> inside the <code>web</code> folder once, ' +
      'then reload. It downloads globe.gl and supabase-js into <code>vendor/</code>.</p></div>';
    return;
  }

  decorateNav();

  // An invite link (…/#join=<token>) is remembered until after sign-in.
  const match = location.hash.match(/join=([0-9a-f-]{36})/i);
  if (match) {
    sessionStorage.setItem("pendingInvite", match[1]);
    history.replaceState(null, "", location.pathname);
  }

  // Back from Google? currentUser() waits until supabase-js has finished
  // reading the login code from the URL — only THEN tidy the address bar
  // (doing it earlier would throw the code away and the login would fail).
  const params = new URLSearchParams(location.search + location.hash.replace(/^#/, "&"));
  const oauthError = params.get("error_description");
  const user = await data.currentUser();
  if (params.has("code") || oauthError || params.has("access_token")) {
    history.replaceState(null, "", location.pathname);
  }
  if (oauthError && !user) setTimeout(() => toast("Google sign-in failed: " + oauthError, "error"), 300);
  if (user) await showSignedIn();
  else await showSignedOut();

  data.db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.reload();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker:", error));
  }
}

window.addEventListener("error", (event) => {
  console.error(event.error);
  toast(event.error?.message || "Unexpected error", "error");
});

boot();
