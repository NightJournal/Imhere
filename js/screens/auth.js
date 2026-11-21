// ---------------------------------------------------------------
// Sign in / create account. Shown full-screen when there's no session.
// ---------------------------------------------------------------
import { el, fill, toast } from "../ui.js";
import * as data from "../db.js";
import { openPrivacy } from "../privacy.js";

function privacyLink() {
  const link = el("button", { class: "ghost", type: "button" }, "Privacy: what Imhere stores and who sees it");
  link.onclick = openPrivacy;
  return link;
}

let mode = "signin"; // or "signup"

async function render(container, { onSignedIn }) {
  const email = el("input", { type: "email", placeholder: "you@example.com",
                              autocomplete: "username", inputmode: "email" });
  const password = el("input", { type: "password", placeholder: "Password",
                                 autocomplete: mode === "signin" ? "current-password" : "new-password" });
  const name = el("input", { type: "text", placeholder: "How your circle sees you",
                             autocomplete: "name" });
  const error = el("div", { class: "form-error", role: "alert" });
  const submit = el("button", { class: "primary" },
    mode === "signin" ? "Sign in" : "Create account");

  async function attempt() {
    error.textContent = "";
    submit.disabled = true;
    try {
      if (mode === "signin") {
        await data.signIn(email.value, password.value);
      } else {
        if (password.value.length < 8) {
          error.textContent = "Use at least 8 characters for your password.";
          submit.disabled = false;
          return;
        }
        const result = await data.signUp(email.value, password.value, name.value.trim());
        if (!result.session) {
          error.textContent = "Almost there: we've emailed you a link. Open it to confirm your account, then sign in here. (Check spam if it hasn't arrived in a few minutes.)";
          submit.disabled = false;
          return;
        }
      }
      await redeemPendingInvite();
      await onSignedIn();
    } catch (problem) {
      error.textContent = problem.message || "Could not sign in.";
      submit.disabled = false;
    }
  }

  submit.onclick = attempt;
  password.onkeydown = (event) => { if (event.key === "Enter") attempt(); };

  // Google: one tap, no password to forget. Leaves the page and comes back.
  const google = el("button", { class: "secondary", type: "button" }, "Continue with Google");
  google.onclick = async () => {
    error.textContent = "";
    google.disabled = true;
    google.textContent = "Opening Google…";
    try {
      await data.signInWithGoogle();
    } catch (problem) {
      error.textContent = problem.message || "Google sign-in isn't available right now.";
      google.disabled = false;
      google.textContent = "Continue with Google";
    }
  };
  const divider = el("div", { class: "divider" }, "or use email");

  const swap = el("button", { class: "ghost" },
    mode === "signin" ? "New here? Create an account" : "I already have an account");
  swap.onclick = () => { mode = mode === "signin" ? "signup" : "signin"; render(container, { onSignedIn }); };

  fill(container,
    el("div", { class: "auth" },
      el("div", { class: "auth-hero" },
        el("div", { class: "empty-globe", "aria-hidden": "true" }),
        el("h1", {}, "Imhere"),
        el("p", { class: "lede", style: "margin-top:var(--s2)" },
          "Tell the people who care about you where you are.")),
      el("div", { class: "auth-form stack" },
        google, divider,
        mode === "signup"
          ? el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), name)
          : null,
        el("label", { class: "field" }, el("span", { class: "label" }, "Email"), email),
        el("label", { class: "field" }, el("span", { class: "label" }, "Password"), password),
        submit, error, swap,
        privacyLink()))
  );
  (mode === "signup" ? name : email).focus();
}

/** If they arrived via an invite link, join that circle right after sign-in. */
export async function redeemPendingInvite() {
  const token = sessionStorage.getItem("pendingInvite");
  if (!token) return;
  sessionStorage.removeItem("pendingInvite");
  try {
    const outcome = await data.redeemInvite(token);
    if (outcome === "ok") toast("You've joined their circle", "ok");
    else toast(data.inviteProblem(outcome), "error");
  } catch (error) {
    toast(error.message, "error");
  }
}

export default { render };
