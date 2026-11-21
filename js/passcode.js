// ---------------------------------------------------------------
// Check-in passcode — checked by the SERVER.
//
// Supabase keeps it scrambled (bcrypt) and adds a check-in only when the
// passcode is right (add_checkin), so nobody can skip it with developer
// tools. Same passcode on every device. 5 wrong tries lock it for a minute,
// then 2, 4, 8… Forgot it? Sign out and sign back in: for 10 minutes after
// a fresh sign-in you can set a new one without the old one.
//
// This phone also keeps a scrambled copy (PBKDF2) — only so you can check
// in with no signal. The server checks the code again when it's sent.
// ---------------------------------------------------------------
import { el, fill, icon } from "./ui.js";
import * as data from "./db.js";

const ITERATIONS = 150000;
const keyFor = (userId) => `imhere.pin.${userId}`;

const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function hashPin(pin, saltHex, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, material, 256);
  return bytesToHex(bits);
}

function readLocal(userId) { try { return JSON.parse(localStorage.getItem(keyFor(userId)) || "null"); } catch { return null; } }

/** Remember a scrambled copy on this phone (for checking in with no signal). */
async function rememberLocally(userId, pin) {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(pin, salt);
  localStorage.setItem(keyFor(userId), JSON.stringify({ salt, hash, iterations: ITERATIONS }));
}

async function matchesLocal(userId, pin) {
  const saved = readLocal(userId);
  if (!saved) return false;
  return (await hashPin(pin, saved.salt, saved.iterations || ITERATIONS)) === saved.hash;
}

export function hasPasscode(userId) { return Boolean(readLocal(userId)?.hash); }

/** Remove every passcode copy on this device (sign-out). The server copy stays. */
export function clearAll() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("imhere.pin.") || key.startsWith("imhere.pinfail.")) localStorage.removeItem(key);
  }
}

const validPin = (pin) => /^\d{4,6}$/.test(pin);

function pinInput(label) {
  const input = el("input", { type: "password", inputmode: "numeric", pattern: "[0-9]*",
    autocomplete: "off", maxlength: "6", class: "pin-input", "aria-label": label, placeholder: "••••" });
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); });
  return input;
}

const signOutHint = "Forgot it? Sign out and sign back in, then set a new one within 10 minutes.";

/**
 * Ask for the passcode INSIDE the current sheet (so the check-in form isn't
 * thrown away). Resolves to the passcode (string) once it's confirmed, or
 * null if cancelled. First time: sets one on the server.
 */
export function confirmPasscode(host, userId, { action = "Confirm check-in" } = {}) {
  return new Promise(async (resolve) => {
    const message = el("p", { class: "dim", role: "alert" });
    const cancel = el("button", { class: "ghost", type: "button" }, "Cancel");
    const finish = (result) => { host.replaceChildren(); host.classList.add("hidden"); resolve(result); };
    cancel.onclick = () => finish(null);
    host.classList.remove("hidden");

    // What does the server know? (No signal: go by this phone's copy.)
    let status = "unknown";
    if (navigator.onLine) {
      fill(host, el("div", { class: "pin-box" }, el("p", { class: "dim" }, "Checking…")));
      try { status = await data.passcodeStatus(); } catch { status = "unknown"; }
    }

    // ---- no passcode yet: set one (needs signal) ----
    if (status === "none" && !hasPasscode(userId)) {
      const first = pinInput("New passcode");
      const second = pinInput("Type it again");
      const go = el("button", { class: "primary", type: "button" }, "Save passcode and check in");
      go.onclick = async () => {
        if (!validPin(first.value)) { message.textContent = "Use 4 to 6 digits (6 is safer)."; first.focus(); return; }
        if (first.value !== second.value) { message.textContent = "The two passcodes don't match."; second.value = ""; second.focus(); return; }
        go.disabled = true;
        try {
          const outcome = await data.setPasscodeOnServer(first.value);
          if (outcome !== "ok") { message.textContent = data.passcodeProblem(outcome); go.disabled = false; return; }
          await rememberLocally(userId, first.value);
          finish(first.value);
        } catch (error) { message.textContent = "Couldn't save it: " + (error.message || error); go.disabled = false; }
      };
      second.addEventListener("keydown", (event) => { if (event.key === "Enter") go.click(); });
      fill(host, el("div", { class: "pin-box stack" },
        el("div", { class: "pin-title" }, icon("lock"), "Set a check-in passcode"),
        el("p", { class: "dim" },
          "Every check-in asks for it, so nobody else can tell your circle you're fine. Imhere keeps it scrambled, so not even we can read it. It works on all your devices."),
        el("label", { class: "field" }, el("span", { class: "label" }, "New passcode (4–6 digits)"), first),
        el("label", { class: "field" }, el("span", { class: "label" }, "Type it again"), second),
        message, go, cancel));
      setTimeout(() => first.focus(), 50);
      return;
    }

    if (status === "unknown" && !hasPasscode(userId)) {
      fill(host, el("div", { class: "pin-box stack" },
        el("div", { class: "pin-title" }, icon("lock"), "Passcode needs signal"),
        el("p", { class: "dim" }, "This phone hasn't checked your passcode yet, so it needs signal once. Try again when you're online."),
        cancel));
      return;
    }

    // ---- enter it ----
    const input = pinInput("Passcode");
    const go = el("button", { class: "primary", type: "button" }, action);
    const forgot = el("button", { class: "link-button", type: "button" }, "Forgot it?");
    forgot.onclick = () => resetFlow(host, userId, finish, cancel);
    go.onclick = async () => {
      if (!validPin(input.value)) { message.textContent = "Enter your 4–6 digit passcode."; return; }
      go.disabled = true;
      const pin = input.value;
      try {
        if (navigator.onLine && status !== "unknown") {
          let outcome = await data.checkPasscodeOnServer(pin);
          if (outcome === "none") {
            // Passcode from before it moved to the server: check it on this
            // phone, then save it to the server so it works everywhere.
            if (await matchesLocal(userId, pin)) outcome = await data.setPasscodeOnServer(pin);
            else outcome = "wrong";
          }
          if (outcome === "ok") { await rememberLocally(userId, pin); finish(pin); return; }
          message.textContent = data.passcodeProblem(outcome);
        } else {
          // No signal: check this phone's copy; the server checks again on sending.
          if (await matchesLocal(userId, pin)) { finish(pin); return; }
          message.textContent = "Wrong passcode.";
        }
      } catch (error) { message.textContent = "Couldn't check it: " + (error.message || error); }
      go.disabled = false;
      input.value = "";
      input.focus();
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go.click(); });
    fill(host, el("div", { class: "pin-box stack" },
      el("div", { class: "pin-title" }, icon("lock"), "Enter your passcode"),
      el("label", { class: "field" }, el("span", { class: "label" }, "Passcode"), input),
      message,
      status.startsWith("locked:") ? el("p", { class: "dim" }, data.passcodeProblem(status)) : null,
      go, el("div", { style: "text-align:center" }, forgot), cancel));
    setTimeout(() => input.focus(), 50);
  });
}

/** Set a new passcode without the old one: allowed for 10 minutes after signing in. */
function resetFlow(host, userId, finish, cancel) {
  const first = pinInput("New passcode");
  const second = pinInput("Type it again");
  const message = el("p", { class: "dim", role: "alert" });
  const go = el("button", { class: "primary", type: "button" }, "Set new passcode and check in");
  go.onclick = async () => {
    if (!navigator.onLine) { message.textContent = "Setting a new passcode needs signal."; return; }
    if (!validPin(first.value)) { message.textContent = "Use 4 to 6 digits (6 is safer)."; return; }
    if (first.value !== second.value) { message.textContent = "The two passcodes don't match."; return; }
    go.disabled = true;
    try {
      const outcome = await data.setPasscodeOnServer(first.value);
      if (outcome === "ok") { await rememberLocally(userId, first.value); finish(first.value); return; }
      message.textContent = outcome === "need_old"
        ? "For your safety, sign out and sign back in first. You'll then have 10 minutes to set a new passcode."
        : data.passcodeProblem(outcome);
    } catch (error) { message.textContent = error.message || String(error); }
    go.disabled = false;
  };
  fill(host, el("div", { class: "pin-box stack" },
    el("div", { class: "pin-title" }, icon("lock"), "Set a new passcode"),
    el("p", { class: "dim" }, "Works within 10 minutes of signing in. Otherwise, sign out and back in first."),
    el("label", { class: "field" }, el("span", { class: "label" }, "New passcode (4–6 digits)"), first),
    el("label", { class: "field" }, el("span", { class: "label" }, "Type it again"), second),
    message, go, cancel));
  setTimeout(() => first.focus(), 50);
}

/** Change passcode (needs the current one). Rendered into `host`. */
export function changePasscodeForm(host, userId, onDone = () => {}) {
  const current = pinInput("Current passcode");
  const next = pinInput("New passcode");
  const again = pinInput("New passcode again");
  const message = el("p", { class: "dim", role: "alert" });
  const save = el("button", { class: "primary", type: "button" }, "Change passcode");
  save.onclick = async () => {
    if (!navigator.onLine) { message.textContent = "Changing your passcode needs signal."; return; }
    if (!validPin(next.value)) { message.textContent = "Use 4 to 6 digits (6 is safer)."; return; }
    if (next.value !== again.value) { message.textContent = "The new passcodes don't match."; return; }
    save.disabled = true;
    try {
      const outcome = await data.setPasscodeOnServer(next.value, current.value);
      if (outcome === "ok") { await rememberLocally(userId, next.value); onDone(); return; }
      message.textContent = outcome === "wrong" ? "Current passcode is wrong." : data.passcodeProblem(outcome);
      current.value = "";
    } catch (error) { message.textContent = error.message || String(error); }
    save.disabled = false;
  };
  fill(host, el("div", { class: "stack" },
    el("label", { class: "field" }, el("span", { class: "label" }, "Current passcode"), current),
    el("label", { class: "field" }, el("span", { class: "label" }, "New passcode (4–6 digits)"), next),
    el("label", { class: "field" }, el("span", { class: "label" }, "New passcode again"), again),
    message, save));
}

/** For the waiting list: ask for the passcode again for a refused check-in. */
export function askAgain(host, userId) {
  return confirmPasscode(host, userId, { action: "Send it" });
}
