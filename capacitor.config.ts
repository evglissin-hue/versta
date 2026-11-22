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
  plugins: {
    // the status bar icon of the ride and places notifications (white on transparent), tinted chart magenta (--mark)
    LocalNotifications: { smallIcon: "ic_stat_versta", iconColor: "#A61C6E" },
  },
};

export default config;
