import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.MEDIPULSE_API_URL ?? "http://127.0.0.1:5055",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", () => {
            // Flask backend may be offline — components degrade gracefully to "AI unavailable".
          });
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@firebase") || id.includes("node_modules/firebase")) return "firebase";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
