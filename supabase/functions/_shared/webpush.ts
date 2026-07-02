// Web Push via npm:web-push — VAPID keys must be set as Supabase secrets:
//   VAPID_PUBLIC_KEY   (base64url-encoded P-256 public key)
//   VAPID_PRIVATE_KEY  (base64url-encoded P-256 private key)
//   VAPID_SUBJECT      e.g. "mailto:kundeservice@leieplattform.no"
import webpush from "npm:web-push@3";

let _initialised = false;

function init() {
  if (_initialised) return;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subj = Deno.env.get("VAPID_SUBJECT") ?? "mailto:kundeservice@leieplattform.no";
  if (!pub || !priv) {
    console.warn("[webpush] VAPID keys not set — push disabled");
    return;
  }
  webpush.setVapidDetails(subj, pub, priv);
  _initialised = true;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function sendWebPush(
  subscription: PushSubscription,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<"ok" | "gone" | "error"> {
  init();
  if (!_initialised) return "error";
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return "ok";
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) return "gone";
    console.error("[webpush] send error:", err);
    return "error";
  }
}
