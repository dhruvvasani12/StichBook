```javascript
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
  $("loginPanel")?.classList.remove("hidden");
  $("appPanel")?.classList.add("hidden");
  $("workerPanel")?.classList.add("hidden");
  $("adminPanel")?.classList.add("hidden");
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

  $("loginPanel")?.classList.add("hidden");
  $("appPanel")?.classList.remove("hidden");

  const welcomeHeading = $("welcomeHeading");
  if (welcomeHeading) {
    welcomeHeading.textContent =
      `Welcome, ${profile.full_name || profile.worker_code || user.email}`;
  }

  const roleMessage = $("roleMessage");

  if (profile.role === "admin") {
    if (roleMessage) {
      roleMessage.textContent = "Administrator account";
    }

    $("adminPanel")?.classList.remove("hidden");
    $("workerPanel")?.classList.add("hidden");
  } else {
    if (profile.role !== "worker") {
      showSignedOut();
      showMessage("message", "Your account role is not recognized.", true);
      return;
    }

    if (roleMessage) {
      roleMessage.textContent = "Worker account";
    }

    $("workerPanel")?.classList.remove("hidden");
    $("adminPanel")?.classList.add("hidden");

    if ($("workerName")) {
      $("workerName").value = profile.full_name || "";
    }

    if ($("workDate")) {
      $("workDate").value = new Date().toLocaleDateString("en-CA");
    }
  }
}

// Login
$("loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("loginButton");
  if (button) button.disabled = true;

  showMessage("message", "Signing in…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("email")?.value.trim(),
      password: $("password")?.value
    });

    if (error) throw error;

    await showSignedIn(data.user);
  } catch (error) {
    console.error("Sign-in error:", error);
    showMessage("message", `Sign-in failed: ${error.message}`, true);
  } finally {
    if (button) button.disabled = false;
  }
});

// Logout
$("logoutButton")?.addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage("message", `Sign-out failed: ${error.message}`, true);
    return;
  }

  showSignedOut();
  showMessage("message", "You have signed out.");
});

// One frame equals 6 metres of fabric.
function updateFabricLength() {
  const frames = Number($("workCount")?.value);
  const metres =
    Number.isFinite(frames) && frames >= 0 ? frames * 6 : 0;

  if ($("fabricLengthPreview")) {
    $("fabricLengthPreview").textContent =
      `${metres.toLocaleString()} metres`;
  }

  return metres;
}

$("workCount")?.addEventListener("input", updateFabricLength);

let previewUrls = [];

$("machinePhotos")?.addEventListener("change", () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];

  const files = Array.from($("machinePhotos")?.files || []);

  if ($("photoCount")) {
    $("photoCount").textContent =
      `${files.length} photo(s) selected. Minimum: 2.`;
  }

  const preview = $("photoPreview");
  if (!preview) return;

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

// Read and verify machine totals before saving.
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

    const result = await window.Tesseract.recognize(file, "eng", {
      logger: (message) => {
        if (message.status === "recognizing text") {
          console.log(
            `Reading photo ${index + 1}: ${Math.round(
              (message.progress || 0) * 100
            )}%`
          );
        }
      }
    });

    const text = (result.data?.text || "").trim();
    console.log(`OCR text from photo ${index + 1}:`, text);

    if (text) recognizedTexts.push(text);
  }

  const normalized = recognizedTexts
    .join("\n")
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
      "Could not clearly read All Works and Overall from the photos. " +
      "Please upload clear photos showing both totals. No record was saved."
    );
  }

  const detectedWorks = Number(allWorksMatch[1]);
  const detectedOverall = Number(overallMatch[1]);

  if (detectedWorks !== workCount) {
    throw new Error(
      `The photo shows All Works = ${detectedWorks}, but you entered ` +
      `${workCount}. Please correct the Work count. No record was saved.`
    );
  }

  if (detectedOverall !== stitchCount) {
    throw new Error(
      `The photo shows Overall = ${detectedOverall}, but you entered ` +
      `${stitchCount}. Please correct the Machine stitch count. ` +
      "No record was saved."
    );
  }

  showMessage(
    "workMessage",
    "Machine totals verified. Saving your record…"
  );
}

// Submit daily work
$("workForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveWorkButton");
  const files = Array.from($("machinePhotos")?.files || []);

  if (!button) {
    showMessage("workMessage", "Save button was not found.", true);
    return;
  }

  if (files.length < 2 || files.length > 12) {
    showMessage(
      "workMessage",
      "Please upload between 2 and 12 machine-screen photos.",
      true
    );
    return;
  }

  if (files.some((file) => !file.type.startsWith("image/"))) {
    showMessage("workMessage", "Please select image files only.", true);
    return;
  }

  const workCount = Number($("workCount")?.value);
  const stitchCount = Number($("stitchCount")?.value);

  if (!Number.isInteger(workCount) || workCount < 0) {
    showMessage("workMessage", "Please enter a valid Work count.", true);
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

    const workerName = $("workerName")?.value.trim() || "";
    const workerMobile = $("workerMobile")?.value.trim() || "";
    const machineNumber = $("machineNumber")?.value.trim() || "";
    const fabricLength = workCount * 6;

    // Do not create a record until the photos pass validation.
    await validateMachinePhotos(files, workCount, stitchCount);

    const { data: record, error: recordError } = await supabase
      .from("daily_work_records")
      .insert({
        worker_id: user.id,
        worker_name: workerName,
        worker_mobile: workerMobile,
        machine_number: machineNumber,
        work_date: $("workDate")?.value,
        work_count: workCount,
        machine_stitch_count: stitchCount,
        machine_time: $("machineTime")?.value.trim() || null,
        estimated_fabric_length: fabricLength,
        placement: $("placement")?.value.trim() || null
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
      `Record saved successfully! ${files.length} photos uploaded. ` +
      `Total fabric: ${fabricLength} metres.`
    );

    $("workForm")?.reset();

    if ($("workDate")) {
      $("workDate").value = new Date().toLocaleDateString("en-CA");
    }

    if ($("workerName")) {
      $("workerName").value = profile.full_name || "";
    }

    if ($("fabricLengthPreview")) {
      $("fabricLengthPreview").textContent = "0 metres";
    }

    if ($("photoCount")) {
      $("photoCount").textContent = "0 photos selected. Minimum: 2.";
    }

    $("photoPreview")?.replaceChildren();

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

// Restore an existing login session on page load.
try {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    showMessage("message", sessionError.message, true);
    showSignedOut();
  } else if (sessionData.session) {
    await showSignedIn(sessionData.session.user);
  } else {
    showSignedOut();
  }
} catch (error) {
  console.error("Session initialization error:", error);
  showMessage("message", "Could not initialize login. Please refresh.", true);
  showSignedOut();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    showSignedOut();
  }
});
```
