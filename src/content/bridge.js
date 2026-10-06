// Content script (ISOLATED world): есть chrome.runtime, нет window.socket.
// Мост popup <-> MAIN world скрипт через window.postMessage.

const TAG = "px-exporter";

// MAIN -> popup
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.[TAG] !== true || e.data.dir !== "page") return;
  try {
    chrome.runtime.sendMessage(e.data.msg);
  } catch {
    // popup закрыт — прогресс некому слушать, экспорт продолжается
  }
});

// popup -> MAIN
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ping") {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onPong);
      sendResponse(null); // MAIN-скрипт не ответил
    }, 3000);
    function onPong(e) {
      if (e.source !== window || e.data?.[TAG] !== true || e.data.dir !== "page") return;
      if (e.data.msg?.type !== "pong") return;
      clearTimeout(timer);
      window.removeEventListener("message", onPong);
      sendResponse(e.data.msg);
    }
    window.addEventListener("message", onPong);
    window.postMessage({ [TAG]: true, dir: "ext", msg: { type: "ping" } }, "*");
    return true; // async sendResponse
  }
  if (msg?.type === "export") {
    window.postMessage({ [TAG]: true, dir: "ext", msg }, "*");
    sendResponse({ started: true });
    return false;
  }
});
