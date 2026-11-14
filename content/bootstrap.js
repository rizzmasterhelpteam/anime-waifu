(function () {
  "use strict";
  if (window.__waifuBootstrap) { window.__waifuBootstrap(); return; }
  let settings = null;
  let loading = null;
  let loadedMode = null;
  let retryTimer = null;
  let retries = 0;
  let forceRetry = false;
  const eligible = () => settings && settings.enabled !== false &&
    !(settings.hiddenDomains || []).some(d => String(d).toLowerCase() === location.hostname.toLowerCase());
  async function ensureRuntime() {
    if (!eligible() || document.hidden || loading) return;
    const mode = settings.renderMode === "2d" ? "2d" : "3d";
    if (loadedMode === "3d" || loadedMode === mode) return;
    loading = chrome.runtime.sendMessage({ type: "ENSURE_COMPANION", mode, retry: forceRetry });
    try {
      const result = await loading;
      if (!result?.ok) throw Error(result?.error || "Companion could not start");
      loadedMode = mode;
      retries = 0;
      forceRetry = false;
    } catch {
      if (++retries <= 3 && !document.hidden) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(ensureRuntime, retries * 1000);
      }
    } finally {
      loading = null;
      if (loadedMode === "2d" && settings.renderMode === "3d") ensureRuntime();
    }
  }
  window.__waifuBootstrap = () => { loadedMode = null; retries = 0; forceRetry = true; return ensureRuntime(); };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && loadedMode) window.WAIFU_REFRESH_RENDERER?.();
    ensureRuntime();
  }, { passive: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settings = changes.settings.newValue || {};
    ensureRuntime();
  });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.type === "WAIFU_PING") reply({ ok: true, loading: Boolean(loading), mode: loadedMode, enabled: eligible() });
  });
  chrome.storage.local.get("settings").then(data => {
    settings = data.settings || {};
    ensureRuntime();
  }).catch(() => { settings = {}; ensureRuntime(); });
})();
