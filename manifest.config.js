import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Project Exporter",
  version: pkg.version,
  description:
    "Экспорт проекта из редактора: все файлы по websocket + ассеты, одним zip.",
  action: { default_popup: "index.html" },
  permissions: ["activeTab"],
  host_permissions: ["https://boonan.io/*"],
  content_scripts: [
    {
      matches: ["https://boonan.io/project/*"],
      js: ["src/content/bridge.js"],
      run_at: "document_idle",
    },
    {
      matches: ["https://boonan.io/project/*"],
      js: ["src/content/main.js"],
      world: "MAIN",
      run_at: "document_idle",
    },
  ],
});
