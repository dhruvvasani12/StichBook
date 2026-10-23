
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from "./config.js";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const $ = (id) => document.getElementById(id);

function showMessage(message, isError = false) {
  const element = $("message");
  element.textContent = message;
  element.className = isError ? "error" : "";
}

function showSignedOut() {
  $("loginPanel").classList.remove("hidden");
  $("appPanel").classList.add("hidden");
}

async function showSignedIn(user) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, worker_code, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    showSignedOut();
    showMessage("Could not load your profile: " + error.message, true);
    return;
  }

  if (!profile) {
    showSignedOut();
    showMessage(
      "No StitchBook profile found. Please ask the administrator to check your account.",
      true
    );
    return;
  }

  $("loginPanel").classList.add("hidden");
  $("appPanel").classList.remove("hidden");

  const name = profile.full_name || profile.worker_code || user.email;
  $("welcomeHeading").textContent = `Welcome, ${name}`;

  if (profile.role === "admin") {
    $("roleMessage").textContent =
      "Administrator account confirmed. The admin records dashboard will be added next.";
  } else {
    $("roleMessage").textContent =
      "Worker account confirmed. The daily work form and private machine-photo upload will be added next.";
  }
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("loginButton");
  button.disabled = true;
  showMessage("Signing in…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) throw error;

    await showSignedIn(data.user);
  } catch (error) {
    showMessage("Sign-in failed: " + error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("logoutButton").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage("Sign-out failed: " + error.message, true);
    return;
  }

  showSignedOut();
  showMessage("You have signed out.");
});

const { data: sessionData, error: sessionError } =
  await supabase.auth.getSession();

if (sessionError) {
  showMessage("Could not check session: " + sessionError.message, true);
} else if (sessionData.session) {
  await showSignedIn(sessionData.session.user);
} else {
  showSignedOut();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    showSignedOut();
  }
});

