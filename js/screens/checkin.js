// ---------------------------------------------------------------
// Check in — where I am, and that I'm okay.
//
// Opens as a sheet (phone) or side panel (desktop) from the raised
// Check in button. GPS starts straight away, so the usual check-in is
// two taps: Check in → Check in. Search, message, transport and photo
// are all still here; the extras sit under "Add details".
// ---------------------------------------------------------------
import { el, fill, toast, TRANSPORT, cityOnly, flagEmoji, openSheet, closeSheet,
         onSheetClose, icon } from "../ui.js";
import * as outbox from "../outbox.js";
import { placeField } from "../geo.js";
import { app, refreshProfile } from "../app.js";
import { confirmPasscode } from "../passcode.js";

/** Shrink a photo in the browser before upload: smaller, faster, cheaper. */
async function compress(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

const MODE_LABEL = { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry", car: "Car" };

export async function openCheckin({ onDone = () => {} } = {}) {
  if (navigator.onLine) await refreshProfile().catch(() => {});
  const travelling = Boolean(app.profile?.current_trip_id);

  let place = null;

  // ---- where: GPS first, search as the fallback ----
  const hereName = el("div", { class: "here-name" }, "Finding where you are…");
  const hereSub = el("div", { class: "here-sub" }, "Using your location");
  const here = el("div", { class: "here locating", role: "status", "aria-live": "polite" },
    icon("pin"), el("div", {}, hereName, hereSub));

  const showPlace = (resolved) => {
    place = resolved;
    save.disabled = !resolved;
    here.classList.toggle("locating", !resolved);
    if (!resolved) return;
    hereName.textContent = resolved.needsName
      ? "Your current location"
      : `${flagEmoji(resolved.countryCode)} ${resolved.city || cityOnly(resolved.label)}`.trim();
    hereSub.textContent = resolved.needsName
      ? "No signal to name it. The name is filled in when you're back online."
      : resolved.label;
  };

  const where = placeField({
    placeholder: "Search for a place",
    onResolve: (resolved) => { if (resolved) { showPlace(resolved); searchBox.open = false; } },
    onLocateError: (error) => {
      hereName.textContent = "Couldn't find your location";
      hereSub.textContent = error?.message || "Search for the place instead.";
      searchBox.open = true;
      setTimeout(() => where.focus(), 50);
    },
  });

  const searchBox = el("details", { class: "more" },
    el("summary", {}, "Not here? Search for a place", icon("chevron")),
    el("div", { class: "stack" }, where.element));

  // Offline hint: searching needs signal, GPS doesn't.
  const offlineHint = el("p", { class: "dim hidden" },
    "No signal: searching won't work, but your location still does. The place name is filled in once you're back online.");
  const updateHint = () => offlineHint.classList.toggle("hidden", navigator.onLine);
  window.addEventListener("online", updateHint);
  window.addEventListener("offline", updateHint);
  updateHint();

  // ---- details: message, transport, photo ----
  const message = el("textarea", { placeholder: "Anything to tell them? (optional)" });

  let mode = null;
  const modeRow = el("div", { class: "chips", role: "group", "aria-label": "How did you get there?" });
  const modeButtons = {};
  for (const key of ["flight", "train", "bus", "ferry", "car"]) {
    const chip = el("button", { class: "chip", type: "button", "aria-pressed": "false" },
      `${TRANSPORT[key]} ${MODE_LABEL[key]}`);
    chip.onclick = () => {
      mode = mode === key ? null : key;
      for (const [name, button] of Object.entries(modeButtons)) {
        button.classList.toggle("on", name === mode);
        button.setAttribute("aria-pressed", String(name === mode));
      }
      transportDetails.classList.toggle("hidden", !mode);
      distanceField.classList.toggle("hidden", mode !== "car");
      numberField.classList.toggle("hidden", mode === "car");
    };
    modeButtons[key] = chip;
    modeRow.append(chip);
  }
  const number = el("input", { type: "text", placeholder: "e.g. BR87" });
  const numberField = el("label", { class: "field" },
    el("span", { class: "label" }, "Flight or train number"), number);
  const distance = el("input", { type: "number", inputmode: "decimal", placeholder: "km" });
  const distanceField = el("label", { class: "field hidden" },
    el("span", { class: "label" }, "Distance driven (km)"), distance);
  const when = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  const transportDetails = el("div", { class: "stack hidden" },
    numberField, distanceField,
    el("label", { class: "field" }, el("span", { class: "label" }, "Date"), when));

  let photoBlob = null;
  const photoInput = el("input", { type: "file", accept: "image/*", class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
  const preview = el("img", { class: "photo hidden", alt: "Your photo for this check-in" });
  const pickPhoto = el("button", { class: "secondary", type: "button" }, icon("camera"), "Add a photo");
  pickPhoto.onclick = () => photoInput.click();
  photoInput.onchange = async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      photoBlob = await compress(file);
      if (!photoBlob) throw new Error("empty");
      preview.src = URL.createObjectURL(photoBlob);
      preview.classList.remove("hidden");
      fill(pickPhoto, icon("camera"), "Replace photo");
      details.open = true;
    } catch { toast("Couldn't read that image", "error"); }
  };

  const details = el("details", { class: "more" },
    el("summary", {}, "Add details", icon("chevron")),
    el("div", { class: "stack" },
      el("label", { class: "field" }, el("span", { class: "label" }, "Message"), message),
      el("div", { class: "field" }, el("span", { class: "label" }, "How did you get there?"), modeRow),
      transportDetails,
      el("div", { class: "field" }, el("span", { class: "label" }, "Photo"),
        el("p", { class: "dim", style: "margin-bottom:8px" },
          "One photo at a time. A new one replaces the last: it's a postcard, not an album."),
        pickPhoto, photoInput, preview)));

  // ---- save ----
  // Every check-in goes through the outbox: with signal it leaves at once,
  // without signal it waits on the device and sends itself later. Either
  // way, pressing the button never loses what you wrote.
  const save = el("button", { class: "primary", disabled: "disabled" }, "Check in");
  const pinHost = el("div", { class: "hidden" });
  save.onclick = async () => {
    if (!place) return;
    // Every check-in is confirmed with the passcode (set on first use).
    save.classList.add("hidden");
    const confirmed = await confirmPasscode(pinHost, app.user?.id);
    save.classList.remove("hidden");
    if (!confirmed) return;
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      await outbox.enqueue({
        place_name: place.label,
        latitude: place.lat,
        longitude: place.lon,
        country_code: place.countryCode ?? null,
        message: message.value.trim() || null,
        trip_id: app.profile?.current_trip_id ?? null,
        transport_mode: mode,
        transport_number: mode && mode !== "car" ? (number.value.trim() || null) : null,
        transport_distance_km: mode === "car" && distance.value ? Number(distance.value) : null,
        transport_date: mode ? new Date(when.value + "T00:00:00").toISOString() : null,
      }, photoBlob, { needsName: Boolean(place.needsName) });
    } catch (error) {
      // Only reachable if the device's own storage fails (private mode, full disk).
      toast("Couldn't save on this device: " + (error.message || error), "error");
      save.disabled = false;
      save.textContent = "Check in";
      return;
    }

    save.textContent = "Sending…";
    const { left } = await outbox.flush().catch(() => ({ left: 1 }));
    const placeText = place.needsName ? "your location" : cityOnly(place.label);
    closeSheet();
    if (left === 0) {
      toast(`Checked in at ${placeText}`, "ok");
      onDone(true);
    } else if (!navigator.onLine) {
      toast("No signal. Your check-in is saved on this device and sends itself when you're back online.");
      onDone(false);
    } else {
      // Online but it didn't go: either the connection is flaky (it will
      // retry) or the server refused it (the waiting list says why).
      toast("Saved on this device, not sent yet. Open Check in to see why.");
      onDone(false);
    }
  };

  // ---- check-ins still waiting to send ----
  const waitingCard = el("div", { class: "hidden", style: "margin-bottom:var(--s4)" });
  const showWaiting = (items) => {
    if (!items.length) { waitingCard.classList.add("hidden"); return; }
    const refused = items.filter((item) => item.lastError);
    fill(waitingCard,
      el("div", { class: "here", style: "background:var(--peach);min-height:0" },
        icon("signal"),
        el("div", {},
          el("div", { style: "font-weight:700" },
            `${items.length} check-in${items.length > 1 ? "s" : ""} waiting to send`),
          el("div", { class: "dim" },
            "Your circle sees them with the time you checked in, not the time they arrived."))),
      ...refused.map((item) => {
        const drop = el("button", { class: "secondary", style: "margin-top:8px" }, "Discard this one");
        drop.onclick = () => outbox.discard(item.id);
        return el("div", { style: "margin-top:10px" },
          el("div", { class: "dim" }, `“${cityOnly(item.fields.place_name)}” was refused: ${item.lastError}`),
          drop);
      }));
    waitingCard.classList.remove("hidden");
  };
  const unsubscribe = outbox.onChange(showWaiting);
  outbox.pending().then(showWaiting).catch(() => {});

  onSheetClose(() => {
    unsubscribe();
    window.removeEventListener("online", updateHint);
    window.removeEventListener("offline", updateHint);
  });

  openSheet("Check in",
    waitingCard,
    el("div", { class: "stack" },
      here,
      offlineHint,
      save,
      pinHost,
      !travelling
        ? el("p", { class: "dim" },
            "You're not on a trip. This check-in is still saved. Start a trip on My Earth if you want your circle following along.")
        : null),
    el("div", { style: "height:var(--s4)" }),
    searchBox,
    details);

  // Ask the phone where it is straight away — the tap on Check in is the
  // user's intent, so the permission prompt (first time only) makes sense.
  where.locate();   // falls back to search (onLocateError) if location is off
}

export default { openCheckin };
