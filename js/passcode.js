// ---------------------------------------------------------------
// Passcode — every check-in needs it, so nobody holding your phone
// can tell your circle "I'm fine" on your behalf.
//
// Kept on THIS device only (never sent anywhere): a salted PBKDF2 hash
// in localStorage. Forgot it? Signing out wipes it, and signing back
// in with your password lets you set a new one.
//
// Live location and "share when I open the app" do NOT ask for it:
// those only send where the phone is, and are labelled as automatic.
// ---------------------------------------------------------------
import { el, fill, icon } from "./ui.js";

const ITERATIONS = 150000;
const MAX_TRIES = 5;           // then a pause that doubles each time
const BASE_LOCK_MS = 60_000;

const keyFor = (userId) => `imhere.pin.${userId}`;
const failKey = (userId) => `imhere.pinfail.${userId}`;

const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function hashPin(pin, saltHex, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, material, 256);
  return bytesToHex(bits);
}

function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }

export function hasPasscode(userId) { return Boolean(read(keyFor(userId))?.hash); }

export async function setPasscode(userId, pin) {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(pin, salt);
  localStorage.setItem(keyFor(userId), JSON.stringify({ salt, hash, iterations: ITERATIONS }));
  localStorage.removeItem(failKey(userId));
}

/** Remove every passcode on this device (sign-out). */
export function clearAll() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("imhere.pin.") || key.startsWith("imhere.pinfail.")) localStorage.removeItem(key);
  }
}

function lockedFor(userId) {
  const fail = read(failKey(userId));
  return fail?.until && fail.until > Date.now() ? fail.until - Date.now() : 0;
}

/** true / false, with lockout bookkeeping. */
export async function checkPasscode(userId, pin) {
  const saved = read(keyFor(userId));
  if (!saved) return false;
  if (lockedFor(userId)) return false;
  const ok = (await hashPin(pin, saved.salt, saved.iterations || ITERATIONS)) === saved.hash;
  const fail = read(failKey(userId)) || { count: 0, locks: 0 };
  if (ok) { localStorage.removeItem(failKey(userId)); return true; }
  fail.count += 1;
  if (fail.count >= MAX_TRIES) {
    fail.until = Date.now() + BASE_LOCK_MS * 2 ** fail.locks;
    fail.locks += 1;
    fail.count = 0;
  }
  localStorage.setItem(failKey(userId), JSON.stringify(fail));
  return false;
}

const validPin = (pin) => /^\d{4,6}$/.test(pin);

function pinInput(label) {
  const input = el("input", { type: "password", inputmode: "numeric", pattern: "[0-9]*",
    autocomplete: "off", maxlength: "6", class: "pin-input", "aria-label": label, placeholder: "••••" });
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); });
  return input;
}

/**
 * Ask for the passcode INSIDE the current sheet (so the check-in form
 * isn't thrown away). First time on this device: create one instead.
 * Resolves true when confirmed, false when cancelled.
 */
export function confirmPasscode(host, userId, { action = "Confirm check-in" } = {}) {
  return new Promise((resolve) => {
    const message = el("p", { class: "dim", role: "alert" });
    const cancel = el("button", { class: "ghost", type: "button" }, "Cancel");
    const finish = (result) => { host.replaceChildren(); host.classList.add("hidden"); resolve(result); };
    cancel.onclick = () => finish(false);
    host.classList.remove("hidden");

    if (!hasPasscode(userId)) {
      const first = pinInput("New passcode");
      const second = pinInput("Type it again");
      const go = el("button", { class: "primary", type: "button" }, "Save passcode and check in");
      go.onclick = async () => {
        if (!validPin(first.value)) { message.textContent = "Use 4 to 6 digits."; first.focus(); return; }
        if (first.value !== second.value) { message.textContent = "The two passcodes don't match."; second.value = ""; second.focus(); return; }
        go.disabled = true;
        await setPasscode(userId, first.value);
        finish(true);
      };
      second.addEventListener("keydown", (event) => { if (event.key === "Enter") go.click(); });
      fill(host, el("div", { class: "pin-box stack" },
        el("div", { class: "pin-title" }, icon("lock"), "Set a check-in passcode"),
        el("p", { class: "dim" },
          "Every check-in asks for it, so nobody else holding your phone can tell your circle you're fine. It stays on this device. Forget it? Sign out and back in to set a new one."),
        el("label", { class: "field" }, el("span", { class: "label" }, "New passcode (4–6 digits)"), first),
        el("label", { class: "field" }, el("span", { class: "label" }, "Type it again"), second),
        message, go, cancel));
      setTimeout(() => first.focus(), 50);
      return;
    }

    const input = pinInput("Passcode");
    const go = el("button", { class: "primary", type: "button" }, action);
    const showLock = () => {
      const ms = lockedFor(userId);
      if (!ms) return false;
      message.textContent = `Too many wrong tries. Try again in ${Math.ceil(ms / 60000)} min, or sign out and back in to reset it.`;
      return true;
    };
    go.onclick = async () => {
      if (showLock()) return;
      if (!validPin(input.value)) { message.textContent = "Enter your 4–6 digit passcode."; return; }
      go.disabled = true;
      const ok = await checkPasscode(userId, input.value);
      go.disabled = false;
      if (ok) { finish(true); return; }
      input.value = "";
      if (!showLock()) message.textContent = "Wrong passcode.";
      input.focus();
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go.click(); });
    fill(host, el("div", { class: "pin-box stack" },
      el("div", { class: "pin-title" }, icon("lock"), "Enter your passcode"),
      el("label", { class: "field" }, el("span", { class: "label" }, "Passcode"), input),
      message, go, cancel));
    showLock();
    setTimeout(() => input.focus(), 50);
  });
}

/** Change passcode (needs the current one). Rendered into `host`. */
export function changePasscodeForm(host, userId, onDone = () => {}) {
  const current = pinInput("Current passcode");
  const next = pinInput("New passcode");
  const again = pinInput("New passcode again");
  const message = el("p", { class: "dim", role: "alert" });
  const save = el("button", { class: "primary", type: "button" }, "Change passcode");
  save.onclick = async () => {
    if (lockedFor(userId)) { message.textContent = "Too many wrong tries. Try again later."; return; }
    if (!(await checkPasscode(userId, current.value))) { message.textContent = "Current passcode is wrong."; current.value = ""; return; }
    if (!validPin(next.value)) { message.textContent = "Use 4 to 6 digits."; return; }
    if (next.value !== again.value) { message.textContent = "The new passcodes don't match."; return; }
    await setPasscode(userId, next.value);
    onDone();
  };
  fill(host, el("div", { class: "stack" },
    el("label", { class: "field" }, el("span", { class: "label" }, "Current passcode"), current),
    el("label", { class: "field" }, el("span", { class: "label" }, "New passcode (4–6 digits)"), next),
    el("label", { class: "field" }, el("span", { class: "label" }, "New passcode again"), again),
    message, save));
}
