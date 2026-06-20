import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "no.leieplattform.app",
  appName: "Leieplattform",
  webDir: "dist",
  server: {
    allowNavigation: ["*.supabase.co", "*.stripe.com"],
  },
  ios: {
    contentInset: "automatic",
    scrollEnabled: false,
  },
};

export default config;
