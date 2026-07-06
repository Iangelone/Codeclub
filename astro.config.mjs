import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  devToolbar: {
    enabled: false,
  },
  vite: {
    clearScreen: false,
    optimizeDeps: {
      include: ["@tauri-apps/api/window"],
    },
  },
});
