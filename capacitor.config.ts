import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.versta.ride",
  appName: "Versta",
  webDir: "dist",
  android: {
    // The background geolocation plugin needs this so location updates do not halt after five minutes in the background.
    useLegacyBridge: true,
    // The app only loads packs from its own assets and map tiles over https.
    allowMixedContent: false,
  },
};

export default config;
