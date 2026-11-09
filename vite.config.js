import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // GitHub repository name
base: "/",
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      manifest: {
        name: "Living Room Glazing App",
        short_name: "Glazing App",
        description:
          "A decision-support application for selecting suitable glazing.",
        theme_color: "#0f766e",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
  {
    src: "/icon-192.png",
    sizes: "192x192",
    type: "image/png",
  },
  {
    src: "/icon-512.png",
    sizes: "512x512",
    type: "image/png",
  },
],
        start_url: "/",
        scope: "/",
      },
    }),
  ],
});
