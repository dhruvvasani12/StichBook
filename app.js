
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

// One frame equals 6 metres of fabric.
function updateFabricLength() {
  const frames = Number($("workCount").value);
  const metres =
    Number.isFinite(frames) && frames >= 0 ? frames * 6 : 0;

  $("fabricLengthPreview").textContent =
    `${metres.toLocaleString()} metres`;

  return metres;
}

$("workCount").addEventListener("input", updateFabricLength);

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

// Free OCR using Tesseract.js.
// This test reads the text but does not approve records for saving.
async function validateMachinePhotos(files, workCount, stitchCount) {
  showMessage("workMessage", "Reading machine photos…");

  if (files.length < 2 || files.length > 12) {
    throw new Error("Please upload between 2 and 12 machine photos.");
  }

  if (!window.Tesseract) {
    throw new Error(
      "Photo reader did not load. Check your internet connection and refresh."
    );
  }

  const recognizedTexts = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];

    if (!file.type.startsWith("image/")) {
      throw new Error("Please select image files only.");
    }

    showMessage(
      "workMessage",
      `Reading photo ${index + 1} of ${files.length}…`
    );

    const result = await window.Tesseract.recognize(file, "eng");
    const text = (result.data.text || "").trim();

    console.log("Machine photo OCR text:", text);

    if (text) {
      recognizedTexts.push(text);
    }
  }

  const machineText = recognizedTexts.join("\n");
  const normalized = machineText
    .replace(/[,，]/g, "")
    .replace(/：/g, ":");

  const allWorksMatch = normalized.match(
    /all\s*works?\s*[:=\-]?\s*(\d+)/i
  );

  const overallMatch = normalized.match(
    /overall\s*[:=\-]?\s*(\d+)/i
  );

  if (!allWorksMatch || !overallMatch) {
    throw new Error(
      "Could not clearly read All Works and Overall from your photos. Please upload clear photos showing both totals. No record was saved."
    );
  }

  const detectedWorks = Number(allWorksMatch[1]);
  const detectedOverall = Number(overallMatch[1]);

  if (detectedWorks !== Number(workCount)) {
    throw new Error(
      `The photo shows All Works = ${detectedWorks}, but you entered ${workCount}. Please correct the Work count. No record was saved.`
    );
  }

  if (detectedOverall !== Number(stitchCount)) {
    throw new Error(
      `The photo shows Overall = ${detectedOverall}, but you entered ${stitchCount}. Please correct the Machine stitch count. No record was saved.`
    );
  }

  showMessage(
    "workMessage",
    "Machine totals verified. Saving your record…"
  );
}
$("workForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveWorkButton");
  const files = Array.from($("machinePhotos").files || []);

  if (files.length < 2 || files.length > 12) {
    showMessage(
      "workMessage",
      "Please upload between 2 and 12 machine-screen photos.",
      true
    );
    return;
  }

  if (files.some((file) => !file.type.startsWith("image/"))) {
    showMessage(
      "workMessage",
      "Please select image files only.",
      true
    );
    return;
  }

  const workCount = Number($("workCount").value);
  const stitchCount = Number($("stitchCount").value);

  if (!Number.isInteger(workCount) || workCount < 0) {
    showMessage(
      "workMessage",
      "Please enter a valid Work count.",
      true
    );
    return;
  }

  if (!Number.isInteger(stitchCount) || stitchCount < 0) {
    showMessage(
      "workMessage",
      "Please enter a valid Machine stitch count.",
      true
    );
    return;
  }

  button.disabled = true;
  let recordId = null;
  const uploadedPaths = [];

  try {
    const { data: userResult, error: userError } =
      await supabase.auth.getUser();

    if (userError) throw userError;

    const user = userResult.user;

    if (!user) {
      throw new Error("Your session has expired. Please sign in again.");
    }

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

    // Safety: stop before inserting any database record until
    // the machine-screen values can be verified reliably.
    await validateMachinePhotos(files, workCount, stitchCount);

    // The code below runs only after photo validation approves.
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
      `Record saved successfully! ${files.length} photos uploaded. Total fabric: ${fabricLength} metres.`
    );

    $("workForm").reset();
    $("workDate").value = new Date().toLocaleDateString("en-CA");
    $("workerName").value = profile.full_name || "";
    $("fabricLengthPreview").textContent = "0 metres";
    $("photoCount").textContent = "0 photos selected. Minimum: 2.";
    $("photoPreview").replaceChildren();

    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  } catch (error) {
    console.error("Work submission error:", error);

    let message =
      error.message || "Could not save the record. Please try again.";

    if (recordId) {
      message +=
        ` Record ID: ${recordId}. Check the record before retrying.`;
    }

    showMessage("workMessage", message, true);
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
