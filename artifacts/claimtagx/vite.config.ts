import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const isBuild = process.argv.includes("build");

const rawPort = process.env.PORT;

if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 5173;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

if (!process.env.BASE_PATH && !isBuild) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/pages/admin/") || id.includes("\\pages\\admin\\")) return "admin";
          if (id.includes("/pages/legal/") || id.includes("\\pages\\legal\\")) return "legal";
          if (id.includes("/pages/Solution") || id.includes("\\pages\\Solution")) return "solution";
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    host: process.env.VITE_LISTEN_HOST ?? "127.0.0.1",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Local admin/Contact E2E: forward /api to isolated API (CRM_E2E_API / 18080).
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:18080",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ["@clerk/react", "@clerk/shared"],
  },
  preview: {
    port,
    host: process.env.VITE_LISTEN_HOST ?? "127.0.0.1",
    allowedHosts: true,
  },
});
