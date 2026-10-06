// Content script (MAIN world): доступ к window.socket страницы, но НЕТ
// chrome.* API — связь с popup идёт через window.postMessage мост
// (src/content/bridge.js в isolated world).
// Вся работа и скачивание zip — здесь, в popup уходят только события
// прогресса (файлы по messaging не гоняем).

import JSZip from "jszip";
import {
  walkFiles,
  waitSocket,
  emitAndWait,
  readAllFiles,
  collectAssetUrls,
  fetchAsset,
  assetZipPath,
} from "../lib/exporter.js";

const TAG = "px-exporter";

function notify(msg) {
  window.postMessage({ [TAG]: true, dir: "page", msg }, "*");
}

async function runExport(options = {}) {
  const { includeBuild = false, includeAssets = true } = options;
  const socket = await waitSocket();

  socket.onAny((event, a) => {
    console.log(
      "[px]",
      event,
      a && typeof a === "object"
        ? `${a.folderName ?? ""}/${a.fileName ?? ""} ${Object.keys(a).join(",")}`.slice(0, 200)
        : String(a).slice(0, 200),
    );
  });

  notify({ type: "progress", phase: "tree", done: 0, total: 0, file: "" });
  const tree = await emitAndWait(
    socket,
    "read-folder-project",
    null,
    "folder-contents-project",
    (p) => Array.isArray(p),
  );

  let files = walkFiles(tree);
  if (!includeBuild) files = files.filter((f) => f.path !== "build" && !f.path.startsWith("build/"));

  // Ассеты (медиа-папки) сервер не отдаёт по WS (file-read-error) — сразу по HTTP
  const isAssetPath = (p) => /(^|\/)(img|audio)(\/|$)/.test(p);
  const directAssets = files.filter((f) => isAssetPath(f.path));
  files = files.filter((f) => !isAssetPath(f.path));

  const read = await readAllFiles(socket, files, (p) =>
    notify({ type: "progress", phase: "files", ...p }),
  );

  const zip = new JSZip();
  const report = {
    exportedAt: new Date().toISOString(),
    page: location.href,
    filesTotal: read.length,
    hashMismatch: [],
    readErrors: [],
    unresolvedBinary: [],
    assetsFetched: [],
    assetsFailed: [],
  };

  const uuid = (location.pathname.match(/\/project\/([^/]+)/) || [])[1];
  for (const f of read) {
    if (f.bytes) zip.file(f.path, f.bytes);
    else if (f.content != null) zip.file(f.path, f.content);
    else if (f.readError) {
      // read-file-project отклонён (file-read-error) — бинарный файл,
      // пробуем забрать по HTTP
      report.readErrors.push(`${f.path}: ${f.readError}`);
      try {
        zip.file(f.path, await fetchAsset(`/project_url/${f.path}`));
        report.assetsFetched.push(f.path);
      } catch (e) {
        report.assetsFailed.push(`${f.path}: ${e.message}`);
      }
    } else report.unresolvedBinary.push(f.path);
    if (f.hashOk === false) report.hashMismatch.push(f.path);
  }

  // Медиа из img/, audio/ — напрямую по HTTP, без WS.
  // Файлы проекта отдаются с /project_url/<path> (проект — из сессии).
  let assetDone = 0;
  for (const f of directAssets) {
    assetDone++;
    notify({ type: "progress", phase: "assets", done: assetDone, total: directAssets.length, file: f.path });
    try {
      zip.file(f.path, await fetchAsset(`/project_url/${f.path}`));
      report.assetsFetched.push(f.path);
    } catch (e) {
      report.assetsFailed.push(`${f.path}: ${e.message}`);
    }
  }

  // Ассеты: регистры assets/*.json -> URL -> HTTP fetch (base64 в content
  // для бинарных файлов дерева уже обработан выше в readAllFiles).
  if (includeAssets) {
    const registries = read
      .filter((f) => f.content && /^assets\//.test(f.path))
      .map((f) => f.content);
    const treePaths = new Set([...read, ...directAssets].map((f) => f.path));
    const urls = collectAssetUrls(registries).filter(
      (u) => !treePaths.has(assetZipPath(u)),
    );
    let done = 0;
    for (const u of urls) {
      done++;
      notify({ type: "progress", phase: "assets", done, total: urls.length, file: u });
      try {
        zip.file(assetZipPath(u), await fetchAsset(u));
        report.assetsFetched.push(u);
      } catch (e) {
        report.assetsFailed.push(`${u}: ${e.message}`);
      }
    }
  }

  zip.file("_export-report.json", JSON.stringify(report, null, 2));

  const name = uuid || "project";
  const filename = `${name}-export-${new Date().toISOString().slice(0, 10)}.zip`;
  const blob = await zip.generateAsync({ type: "blob" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: filename,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);

  return { filename, files: read.length, assets: report.assetsFetched.length };
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.[TAG] !== true || e.data.dir !== "ext") return;
  const msg = e.data.msg;
  if (msg?.type === "ping") {
    notify({
      type: "pong",
      ok: true,
      page: location.pathname,
      socket: Boolean(window.socket?.connected),
    });
    return;
  }
  if (msg?.type === "export") {
    runExport(msg.options).then(
      (r) => notify({ type: "done", ...r }),
      (err) => notify({ type: "error", message: String(err?.message || err) }),
    );
  }
});
