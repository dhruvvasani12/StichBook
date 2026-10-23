
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

function showMessage(id, message, isError = false) {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.className = isError ? "message error" : "message";
}

function showSignedOut() {
  $("loginPanel").classList.remove("hidden");
  $("appPanel").classList.add("hidden");
  $("workerPanel").classList.add("hidden");
  $("adminPanel").classList.add("hidden");
}

async function showSignedIn(user) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, worker_code, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    showSignedOut();
    showMessage(
      "message",
      error ? error.message : "No StitchBook profile found.",
      true
    );
    return;
  }

  $("loginPanel").classList.add("hidden");
  $("appPanel").classList.remove("hidden");
  $("welcomeHeading").textContent =
    `Welcome, ${profile.full_name || profile.worker_code || user.email}`;

  if (profile.role === "admin") {
    $("roleMessage").textContent = "Administrator account";
    $("adminPanel").classList.remove("hidden");
    $("workerPanel").classList.add("hidden");
  } else {
    $("roleMessage").textContent = "Worker account";
    $("workerPanel").classList.remove("hidden");
    $("adminPanel").classList.add("hidden");

    // Use the worker's registered profile details when available.
    $("workerName").value = profile.full_name || "";
    $("workDate").value = new Date().toLocaleDateString("en-CA");
  }
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("loginButton");
  button.disabled = true;
  showMessage("message", "Signing in…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) throw error;
    await showSignedIn(data.user);
  } catch (error) {
    showMessage("message", "Sign-in failed: " + error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("logoutButton").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage("message", "Sign-out failed: " + error.message, true);
    return;
  }

  showSignedOut();
  showMessage("message", "You have signed out.");
});

// Fabric calculation: each frame represents 6 metres.
function updateFabricLength() {
  const frames = Number($("workCount").value);
  const metres = Number.isFinite(frames) && frames >= 0 ? frames * 6 : 0;

  $("fabricLengthPreview").textContent =
    `${metres.toLocaleString()} metres`;
  return metres;
}

$("workCount").addEventListener("input", updateFabricLength);

// Show photo previews and enforce the minimum of two.
let previewUrls = [];

$("machinePhotos").addEventListener("change", () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];

  const files = Array.from($("machinePhotos").files || []);
  $("photoCount").textContent =
    `${files.length} photo(s) selected. Minimum: 2.`;

  const preview = $("photoPreview");
  preview.replaceChildren();

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Selected machine-screen photo";
    preview.appendChild(img);
  }
});

$("workForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveWorkButton");
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;

  if (userResult.error || !user) {
    showMessage("workMessage", "Your session expired. Please log in again.", true);
    return;
  }

  const files = Array.from($("machinePhotos").files || []);

  if (files.length < 2) {
    showMessage("workMessage", "Please select at least 2 machine photos.", true);
    return;
  }

  if (files.some((file) => !file.type.startsWith("image/"))) {
    showMessage("workMessage", "Please select image files only.", true);
    return;
  }

  const workCount = Number($("workCount").value);
  const stitchCount = Number($("stitchCount").value);

  if (!Number.isInteger(workCount) || workCount < 0) {
    showMessage("workMessage", "Work count must be a whole number of 0 or more.", true);
    return;
  }

  if (!Number.isInteger(stitchCount) || stitchCount < 0) {
    showMessage("workMessage", "Stitch count must be a whole number of 0 or more.", true);
    return;
  }

  button.disabled = true;
  showMessage("workMessage", "Saving work record…");

  const uploadedPaths = [];
  let recordId = null;

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, worker_code, role")
      .eq("id", user.id)
      .single();

    if (profileError) throw profileError;

    if (profile.role !== "worker") {
      throw new Error("Only worker accounts can submit daily work.");
    }

    const workerName = $("workerName").value.trim();
    const workerMobile = $("workerMobile").value.trim();
    const machineNumber = $("machineNumber").value.trim();
    const fabricLength = workCount * 6;

    // Save the work record first.
    const { data: record, error: recordError } = await supabase
      .from("daily_work_records")
      .insert({
        worker_id: user.id,
        worker_name: workerName,
        worker_mobile: workerMobile,
        machine_number: machineNumber,
        work_date: $("workDate").value,
        work_count: workCount,
        machine_stitch_count: stitchCount,
        machine_time: $("machineTime").value.trim() || null,
        estimated_fabric_length: fabricLength,
        placement: $("placement").value.trim() || null
      })
      .select("id")
      .single();

    if (recordError) throw recordError;
    recordId = record.id;

    // Upload every selected photo to the worker's private folder.
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path =
        `${user.id}/${recordId}/${Date.now()}_${index}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("machine-photos")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type
        });

      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
    }

    // Save photo paths for the admin and worker record.
    const photoRows = uploadedPaths.map((photoPath) => ({
      record_id: recordId,
      photo_path: photoPath
    }));

    const { error: photosError } = await supabase
      .from("daily_work_photos")
      .insert(photoRows);

    if (photosError) throw photosError;

    showMessage(
      "workMessage",
      `Saved successfully! ${files.length} photos uploaded. Fabric length: ${fabricLength} metres.`
    );

    $("workForm").reset();
    $("workDate").value = new Date().toLocaleDateString("en-CA");
    $("workerName").value = profile.full_name || "";
    $("fabricLengthPreview").textContent = "0 metres";
    $("photoCount").textContent = "0 photos selected. Minimum: 2.";
    $("photoPreview").replaceChildren();
  } catch (error) {
    // If an upload or photo-path save fails, keep a useful error message.
    // The record may already exist if the failure occurred after insertion.
    showMessage(
      "workMessage",
      `Could not finish saving: ${error.message}` +
        (recordId ? ` Record ID: ${recordId}. Please check before retrying.` : ""),
      true
    );
  } finally {
    button.disabled = false;
  }
});

const { data: sessionData, error: sessionError } =
  await supabase.auth.getSession();

if (sessionError) {
  showMessage("message", sessionError.message, true);
} else if (sessionData.session) {
  await showSignedIn(sessionData.session.user);
} else {
  showSignedOut();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    showSignedOut();
  }
});
