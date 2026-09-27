import type { CapacitorConfig } from "@capacitor/cli";

// server.url makes the native app load index.html (and, via its
// iframe, /app.html) live from leieplattform.no on every launch,
// instead of Capacitor's default behavior of bundling webDir's files
// into the app at build time and serving that frozen local copy
// forever after. Found during this session's bug sweep: with no
// server.url, EVERY fix shipped to src/app.html today (including a
// real overcharge bug -- length-of-stay discounts never applied at
// payment) would never reach a real device build unless someone
// rebuilt and resubmitted the app through App Store review, while the
// live web site kept the fix instantly. No iOS app is published yet,
// so nothing was actually affected -- fixed now, before that gap could
// ever bite a real user, so every future web deploy reaches the native
// app the same way it reaches the browser: immediately, no rebuild.
//
// webDir/dist is left in place as Capacitor's offline fallback bundle
// (used automatically if the device has no network on launch) --
// removing it would make a first launch with no connectivity show a
// blank native shell instead of a stale-but-working cached copy.
const config: CapacitorConfig = {
  appId: "no.leieplattform.app",
  appName: "Leieplattform",
  webDir: "dist",
  server: {
    url: "https://leieplattform.no",
    allowNavigation: ["*.supabase.co", "*.stripe.com", "*.leieplattform.no"],
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
