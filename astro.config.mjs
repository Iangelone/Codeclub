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
      include: ["@tauri-apps/api/window"],
    },
  },
});
