import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  output: "static",
  integrations: [react()],
  devToolbar: {
    enabled: false,
  },
  vite: {
    clearScreen: false,
    define: {
      'process.env': '{}',
    },
    optimizeDeps: {
      include: [
        "@tauri-apps/api/window",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/api/path",
        "@tauri-apps/plugin-fs",
        "@tauri-apps/plugin-dialog",
      ],
    },
  },
});
