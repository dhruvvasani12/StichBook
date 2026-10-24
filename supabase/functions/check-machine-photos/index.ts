
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reply({ error: "Only POST requests are allowed." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!authHeader) {
      return reply({ error: "कृपया पहले लॉगिन करें।" }, 401);
    }

    // Verify that the caller is an authenticated StitchBook user.
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
      },
    });

    if (!userResponse.ok) {
      return reply({ error: "कृपया फिर से लॉगिन करें।" }, 401);
    }

    const body = await req.json();
    const workCount = Number(body.workCount);
    const stitchCount = Number(body.stitchCount);
    const photos = body.photos;

    if (
      !Number.isInteger(workCount) || workCount < 0 ||
      !Number.isInteger(stitchCount) || stitchCount < 0
    ) {
      return reply({ error: "कृपया सही Work count और Machine stitch count भरें।" }, 400);
    }

    if (!Array.isArray(photos) || photos.length < 2) {
      return reply({ error: "कृपया मशीन स्क्रीन की कम से कम 2 फोटो अपलोड करें।" }, 400);
    }

    if (photos.length > 12) {
      return reply({ error: "एक बार में अधिकतम 12 फोटो जाँचें।" }, 400);
    }

    const imageParts = [];

    for (const photo of photos) {
      if (
        typeof photo !== "string" ||
        !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(photo) ||
        photo.length > 8_000_000
      ) {
        return reply({ error: "फोटो सही फ़ॉर्मेट में नहीं है। कृपया JPG, PNG या WebP फोटो अपलोड करें।" }, 400);
      }

      imageParts.push({
        type: "image_url",
        image_url: { url: photo, detail: "high" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return reply({ error: "AI सेवा कॉन्फ़िगर नहीं है। कृपया एडमिन से संपर्क करें।" }, 500);
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You inspect stitching machine screen photos. Read the value next to the exact label 'All Work' and the value next to the exact label 'Overall'. Examine every supplied image. Do not guess or infer unreadable digits. If any required label or number is unclear, return readable=false. Return only JSON with keys readable (boolean), all_work (integer or null), overall (integer or null), reason (short string). The All Work number is the frame count. The Overall number is the machine stitch count.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Compare every photo with these entered values: Work count (frames)=${workCount}; Machine stitch count=${stitchCount}. All Work must equal ${workCount}; Overall must equal ${stitchCount}. If photos disagree or any value is unclear, set readable=false. Return JSON only.`,
              },
              ...imageParts,
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI request failed:", aiResponse.status);
      return reply({ error: "फोटो जाँच अभी नहीं हो सकी। कृपया थोड़ी देर बाद फिर कोशिश करें।" }, 502);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      return reply({ error: "फोटो पढ़ी नहीं जा सकी। कृपया साफ़ फोटो अपलोड करें।" }, 422);
    }

    let result;
    try {
      const cleaned = content.replace(/```json|```/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      return reply({ error: "फोटो के नंबर स्पष्ट नहीं हैं। कृपया साफ़ फोटो अपलोड करें।" }, 422);
    }

    if (
      result.readable !== true ||
      !Number.isInteger(result.all_work) ||
      !Number.isInteger(result.overall)
    ) {
      return reply({
        valid: false,
        error: "फोटो में नंबर साफ़ नहीं दिख रहे हैं। कृपया मशीन स्क्रीन की साफ़ फोटो अपलोड करें।",
      }, 422);
    }

    if (
      result.all_work !== workCount ||
      result.overall !== stitchCount
    ) {
      return reply({
        valid: false,
        error:
          `फोटो के नंबर और भरी गई जानकारी मेल नहीं खाते। ` +
          `All Work: ${result.all_work}, भरा गया Work count: ${workCount}; ` +
          `Overall: ${result.overall}, भरा गया Machine stitch count: ${stitchCount}। ` +
          `कृपया सही जानकारी भरें।`,
        detected: {
          all_work: result.all_work,
          overall: result.overall,
        },
      }, 422);
    }

    return reply({
      valid: true,
      message: "फोटो जाँच सफल रही।",
      detected: {
        all_work: result.all_work,
        overall: result.overall,
      },
    });
  } catch (error) {
    console.error("Photo validation error:", error);
    return reply({ error: "जाँच में समस्या आई। कृपया फिर कोशिश करें।" }, 500);
  }
});
