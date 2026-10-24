
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

// Each frame represents 6 metres of fabric.
function updateFabricLength() {
  const frames = Number($("workCount").value);
  const metres = Number.isFinite(frames) && frames >= 0 ? frames * 6 : 0;

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

// Convert an image to a data URL for secure AI photo checking.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read a photo. Please select it again."));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(new Error("Could not read a photo. Please select it again."));
    };

    reader.readAsDataURL(file);
  });
}

// Validate the photos before inserting any database record.
async function validateMachinePhotos(files, workCount, stitchCount) {
  showMessage(
    "workMessage",
    "AI is checking the machine photos. Please wait…"
  );

  // The current deployed function allows a maximum of 12 photos.
  if (files.length > 12) {
    throw new Error(
      "एक बार में अधिकतम 12 फोटो जाँच सकते हैं। कृपया 12 या उससे कम फोटो चुनें।"
    );
  }

  const photos = await Promise.all(files.map(fileToDataUrl));

  const { data, error } = await supabase.functions.invoke(
    "check-machine-photos",
    {
      body: {
        workCount,
        stitchCount,
        photos
      }
    }
  );

  if (error) {
    console.error("AI photo-check error:", error);
    throw new Error(
      "फोटो की जाँच नहीं हो सकी। कृपया इंटरनेट और लॉगिन जाँचकर फिर कोशिश करें।"
    );
  }

  if (!data || data.valid !== true) {
    throw new Error(
      data?.error ||
      "फोटो के नंबर स्पष्ट नहीं हैं। कृपया मशीन स्क्रीन की साफ़ फोटो अपलोड करें।"
    );
  }

  return data;
}

$("workForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveWorkButton");
  const files = Array.from($("machinePhotos").files || []);

  if (files.length < 2) {
    showMessage(
      "workMessage",
      "कृपया मशीन स्क्रीन की कम से कम 2 फोटो अपलोड करें।",
      true
    );
    return;
  }

  if (files.some((file) => !file.type.startsWith("image/"))) {
    showMessage(
      "workMessage",
      "कृपया केवल image files अपलोड करें।",
      true
    );
    return;
  }

  const workCount = Number($("workCount").value);
  const stitchCount = Number($("stitchCount").value);

  if (!Number.isInteger(workCount) || workCount < 0) {
    showMessage(
      "workMessage",
      "कृपया सही Work count भरें।",
      true
    );
    return;
  }

  if (!Number.isInteger(stitchCount) || stitchCount < 0) {
    showMessage(
      "workMessage",
      "कृपया सही Machine stitch count भरें।",
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
      throw new Error("आपका लॉगिन समाप्त हो गया है। कृपया फिर से लॉगिन करें।");
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

    // IMPORTANT: Do not save anything until the AI approves the photos.
    await validateMachinePhotos(files, workCount, stitchCount);

    showMessage(
      "workMessage",
      "फोटो सही हैं। अब रिकॉर्ड सेव हो रहा है…"
    );

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
      `रिकॉर्ड सफलतापूर्वक सेव हो गया! ${files.length} फोटो अपलोड हुईं। कुल कपड़ा: ${fabricLength} मीटर।`
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

    showMessage(
      "workMessage",
      error.message ||
        "रिकॉर्ड सेव नहीं हो सका। कृपया फिर कोशिश करें।" +
        (recordId
          ? ` Record ID: ${recordId}. कृपया दोबारा सेव करने से पहले जाँचें।`
          : ""),
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
