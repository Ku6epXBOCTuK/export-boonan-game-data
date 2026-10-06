import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import zipPack from "vite-plugin-zip-pack";
import manifest from "./manifest.config.js";

export default defineConfig({
  plugins: [
    svelte(),
    crx({ manifest }),
    zipPack({ inDir: "dist", outDir: "release", outFileName: "release.zip" }),
  ],
  build: {
    rollupOptions: {
      input: { popup: "index.html" },
    },
  },
});
