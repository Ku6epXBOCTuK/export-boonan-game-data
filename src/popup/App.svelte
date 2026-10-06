<script>
  import { onMount } from "svelte";

  let phase = $state("init"); // init | ready | running | done | error | wrong-page
  let page = $state("");
  let socketOk = $state(false);
  let includeBuild = $state(false);
  let includeAssets = $state(true);
  let progress = $state({ done: 0, total: 0, file: "", phase: "" });
  let result = $state(null);
  let errorMsg = $state("");
  let tabId = null;

  const phaseLabel = {
    tree: "дерево проекта",
    files: "файлы",
    assets: "ассеты",
  };

  onMount(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("/project/")) {
      phase = "wrong-page";
      return;
    }
    tabId = tab.id;
    page = new URL(tab.url).pathname;
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "ping" });
      if (!pong) {
        errorMsg = "Скрипт на странице не отвечает — обнови вкладку (F5)";
        phase = "error";
        return;
      }
      socketOk = Boolean(pong.socket);
      phase = "ready";
    } catch {
      phase = "wrong-page";
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "progress") {
      progress = msg;
    } else if (msg?.type === "done") {
      result = msg;
      phase = "done";
    } else if (msg?.type === "error") {
      errorMsg = msg.message;
      phase = "error";
    }
  });

  function start() {
    phase = "running";
    progress = { done: 0, total: 0, file: "", phase: "tree" };
    chrome.tabs.sendMessage(tabId, {
      type: "export",
      options: { includeBuild, includeAssets },
    });
  }
</script>

<main>
  <h1>Project Exporter</h1>

  {#if phase === "init"}
    <p class="muted">Проверяю страницу…</p>
  {:else if phase === "wrong-page"}
    <p class="warn">Открой страницу проекта в редакторе (<code>/project/…</code>) и повтори.</p>
  {:else}
    <p class="muted path">{page}</p>
    {#if !socketOk}
      <p class="warn">Сокет страницы ещё не подключен — экспорт подождёт его.</p>
    {/if}

    <label><input type="checkbox" bind:checked={includeBuild} /> включить build/ (собранная копия)</label>
    <label><input type="checkbox" bind:checked={includeAssets} /> скачивать ассеты (картинки/звуки)</label>

    <button disabled={phase === "running"} onclick={start}>
      {phase === "running" ? "Экспорт…" : "Экспортировать в zip"}
    </button>

    {#if phase === "running"}
      <div class="bar">
        <div
          class="fill"
          style:width={progress.total ? `${(100 * progress.done) / progress.total}%` : "10%"}
        ></div>
      </div>
      <p class="muted">
        {phaseLabel[progress.phase] ?? progress.phase}
        {progress.total ? `${progress.done}/${progress.total}` : ""}
      </p>
      <p class="muted file">{progress.file}</p>
    {:else if phase === "done"}
      <p class="ok">
        Готово: {result.filename}<br />
        файлов: {result.files}, ассетов: {result.assets}
      </p>
    {:else if phase === "error"}
      <p class="warn">Ошибка: {errorMsg}</p>
    {/if}
  {/if}
</main>

<style>
  main {
    width: 300px;
    padding: 14px;
    font: 13px/1.45 system-ui, sans-serif;
    color: #1d1f2a;
  }
  h1 {
    font-size: 15px;
    margin: 0 0 10px;
  }
  label {
    display: block;
    margin: 6px 0;
    cursor: pointer;
  }
  button {
    width: 100%;
    margin: 10px 0;
    padding: 8px;
    border: 0;
    border-radius: 6px;
    background: #4a5fd9;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .muted {
    color: #6b7280;
    margin: 4px 0;
  }
  .path {
    word-break: break-all;
  }
  .file {
    word-break: break-all;
    font-size: 11px;
  }
  .warn {
    color: #b45309;
  }
  .ok {
    color: #15803d;
  }
  .bar {
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
    margin: 8px 0 4px;
  }
  .fill {
    height: 100%;
    background: #4a5fd9;
    transition: width 0.2s;
  }
</style>
