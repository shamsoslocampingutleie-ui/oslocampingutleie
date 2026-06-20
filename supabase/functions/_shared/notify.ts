import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function insertNotification(
  supabase: SupabaseClient,
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
    data: data ?? null,
  });
  if (error) console.error("[notify] insert error:", error.message);
}
