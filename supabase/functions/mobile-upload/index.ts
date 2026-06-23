import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, imageData, mimeType } = await req.json();

    if (!token || !imageData) {
      return new Response(JSON.stringify({ error: "token og imageData er påkrevd" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sess, error: sessErr } = await supabase
      .from("upload_sessions")
      .select("*")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      return new Response(JSON.stringify({ error: "Ugyldig eller utløpt token" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (sess.image_url) {
      return new Response(JSON.stringify({ error: "Token er allerede brukt" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base64 = imageData.replace(/^data:[^;]+;base64,/, "");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const ext = (mimeType || "image/jpeg").includes("png") ? "png" : "jpg";
    const path = `${sess.user_id}/front.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("drivers-license")
      .upload(path, bytes, { upsert: true, contentType: mimeType || "image/jpeg" });

    if (upErr) throw upErr;

    const { data: pu } = supabase.storage.from("drivers-license").getPublicUrl(path);
    const imageUrl = pu.publicUrl;

    await supabase
      .from("upload_sessions")
      .update({ image_url: imageUrl })
      .eq("id", sess.id);

    return new Response(JSON.stringify({ success: true, imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[mobile-upload]", err);
    return new Response(JSON.stringify({ error: "Intern feil, prøv igjen" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
