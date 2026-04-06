import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { normalizePath } from "vite";
import path from "path";

const excalidrawAssetsDir = normalizePath(
  path.resolve(__dirname, "node_modules/@excalidraw/excalidraw/dist/prod")
);

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: excalidrawAssetsDir + "/**/*",
          dest: "excalidraw-assets",
        },
      ],
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
});
