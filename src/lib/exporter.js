// Ядро экспорта. Работает в MAIN world страницы проекта, пользуется
// страничным window.socket (socket.io). Протокол — docs/websocket-export.md.

export const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".mp3", ".ogg", ".wav", ".m4a", ".flac",
]);

const ASSET_URL_RE =
  /(?:https?:\/\/[^\s"']+|\/[^\s"']+|[^\s"':/]+\/[^\s"']+)\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|wav|m4a|flac)/gi;

export function ext(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

// Дерево folder-contents-project -> плоский список файлов.
// folderName: путь родителя через "/", у корня ".".
export function walkFiles(tree) {
  const out = [];
  (function walk(nodes, prefix) {
    for (const n of nodes || []) {
      if (n.isDirectory) {
        const p = prefix ? `${prefix}/${n.name}` : n.name;
        walk(n.contents, p);
      } else {
        out.push({
          folderName: prefix || ".",
          fileName: n.name,
          path: prefix ? `${prefix}/${n.name}` : n.name,
          size: n.size,
        });
      }
    }
  })(tree, "");
  return out;
}

export function waitSocket(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const s = window.socket;
      if (s && s.connected) return resolve(s);
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error("window.socket не появился/не подключен"));
      }
      setTimeout(poll, 200);
    })();
  });
}

// emit + ожидание ответного события (сервер шлёт ответ отдельным событием,
// не ack — см. дампы). match фильтрует чужие/параллельные ответы.
export function emitAndWait(socket, reqEvent, reqArg, resEvent, match, timeoutMs = 30000, errEvent = null) {
  return new Promise((resolve, reject) => {
    const seen = [];
    function onAny(event) {
      seen.push(event);
    }
    socket.onAny(onAny);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(resEvent, onRes);
      socket.offAny(onAny);
      if (errEvent) socket.off(errEvent, onErr);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `timeout ${resEvent} (${reqEvent} ${reqArg ? JSON.stringify(reqArg) : ""}). ` +
            `События за время ожидания: ${seen.length ? seen.join(", ") : "нет"} ` +
            `(подробности в консоли, строки [px])`,
        ),
      );
    }, timeoutMs);
    function onRes(payload) {
      if (match && !match(payload)) return;
      cleanup();
      resolve(payload);
    }
    function onErr(payload) {
      if (match && !match(payload)) return;
      cleanup();
      resolve({ __error: payload });
    }
    socket.on(resEvent, onRes);
    if (errEvent) socket.on(errEvent, onErr);
    if (reqArg === null) socket.emit(reqEvent);
    else socket.emit(reqEvent, reqArg);
  });
}

async function sha1hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const B64_RE = /^[A-Za-z0-9+/\s]+={0,2}$/;
function tryBase64(content) {
  if (typeof content !== "string" || content.length < 8) return null;
  if (content.startsWith("data:")) {
    const i = content.indexOf("base64,");
    if (i < 0) return null;
    content = content.slice(i + 7);
  }
  if (!B64_RE.test(content) || content.length % 4 !== 0) return null;
  try {
    return base64ToBytes(content);
  } catch {
    return null;
  }
}

// Простой пул параллельности.
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        results[k] = await fn(items[k], k);
      }
    }),
  );
  return results;
}

export async function readAllFiles(socket, files, onProgress) {
  let done = 0;
  return pool(files, 4, async (f) => {
    const msg = await emitAndWait(
      socket,
      "read-file-project",
      { folderName: f.folderName, fileName: f.fileName },
      "file-contents-project",
      (p) => p && p.folderName === f.folderName && p.fileName === f.fileName,
      30000,
      "file-read-error",
    );
    // Сервер отклонил чтение (бинарный файл и т.п.) — событие file-read-error
    if (msg.__error) {
      done++;
      onProgress?.({ done, total: files.length, file: f.path });
      return { ...f, content: null, bytes: null, readError: msg.__error.reason || "unknown" };
    }
    let bytes = null;
    let hashOk = null;
    if (BINARY_EXTS.has(ext(f.fileName))) {
      bytes = tryBase64(msg.content);
    } else {
      hashOk = (await sha1hex(msg.content ?? "")) === msg.version;
    }
    done++;
    onProgress?.({ done, total: files.length, file: f.path });
    return { ...f, content: bytes === null && !BINARY_EXTS.has(ext(f.fileName)) ? msg.content : null, bytes, version: msg.version, hashOk };
  });
}

// Рекурсивно собирает URL/пути ассетов из реестров assets/*.json.
export function collectAssetUrls(registries) {
  const urls = new Set();
  const scan = (v) => {
    if (typeof v === "string") {
      ASSET_URL_RE.lastIndex = 0;
      let m;
      while ((m = ASSET_URL_RE.exec(v))) urls.add(m[0]);
      if (/\.(png|jpe?g|gif|webp|svg|mp3|ogg|wav|m4a|flac)$/i.test(v) && !v.includes("://")) {
        urls.add(v);
      }
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  for (const r of registries) {
    try {
      scan(JSON.parse(r));
    } catch {
      scan(r);
    }
  }
  return [...urls];
}

export async function fetchAsset(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function assetZipPath(url) {
  let p;
  try {
    p = new URL(url, location.origin).pathname;
  } catch {
    p = url;
  }
  // /project_url/img/x.png -> img/x.png (префикс-заглушка, не папка проекта)
  return p.replace(/^\/+/, "").replace(/^project_url\//, "");
}
