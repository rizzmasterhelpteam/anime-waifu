(function () {
  "use strict";
  if (window.__waifuTabWatcher) return;
  window.__waifuTabWatcher = true;
  const { DEFAULT_SETTINGS } = window.WAIFU_SHARED;
  let settings = DEFAULT_SETTINGS;
  function readSettings(raw = {}) {
    settings = { ...DEFAULT_SETTINGS, ...raw, tabAlerts: {
      ...DEFAULT_SETTINGS.tabAlerts, ...(raw.tabAlerts || {}),
      apps: { ...DEFAULT_SETTINGS.tabAlerts.apps, ...(raw.tabAlerts?.apps || {}) }
    } };
    syncTabWatcher();
  }
  const AI_STOP_SELECTOR = '[data-testid*="stop"], button[aria-label*="Stop" i], button[title*="Stop" i], [data-is-streaming="true"], .result-streaming';
  let tabWatchKey = "";
  let aiPollTimer = null;
  let titleObserver = null;
  let titlePollTimer = null;
  let wasAiStreaming = false;
  let lastUnreadTitleCount = 0;
  let tabAlertSent = false;

  function stopTabWatcher(clearPending) {
    if (aiPollTimer) {
      clearInterval(aiPollTimer);
      aiPollTimer = null;
    }
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }
    if (titlePollTimer) {
      clearInterval(titlePollTimer);
      titlePollTimer = null;
    }
    wasAiStreaming = false;
    tabWatchKey = "";
    if (clearPending && tabAlertSent) {
      tabAlertSent = false;
      chrome.runtime.sendMessage({ type: "TAB_ALERT_CLEARED" }).catch(() => {});
    }
  }

  function syncTabWatcher() {
    if (settings.enabled === false || settings.tabAlerts?.enabled === false) {
      stopTabWatcher(true);
      return;
    }
    const matchFn = window.WAIFU_SHARED?.matchWatchApp;
    const parseTitleFn = window.WAIFU_SHARED?.parseTitleUnreadCount;
    if (typeof matchFn !== "function" || typeof parseTitleFn !== "function") return;

    const app = matchFn(window.location.hostname, settings.tabAlerts?.customDomains);
    if (!app) {
      stopTabWatcher(true);
      return;
    }
    if (!app.isCustom && settings.tabAlerts?.apps?.[app.id] === false) {
      stopTabWatcher(true);
      return;
    }

    const nextKey = `${app.id}:${app.mode}`;
    if (tabWatchKey === nextKey) return;
    stopTabWatcher(false);
    tabWatchKey = nextKey;

    if (app.mode === "ai_stream") {
      wasAiStreaming = Boolean(document.querySelector(AI_STOP_SELECTOR));
      aiPollTimer = setInterval(() => {
        const isStreaming = Boolean(document.querySelector(AI_STOP_SELECTOR));
        if (isStreaming) {
          wasAiStreaming = true;
        } else if (wasAiStreaming) {
          wasAiStreaming = false;
          if (document.hidden) {
            tabAlertSent = true;
            chrome.runtime.sendMessage({
              type: "TAB_ALERT_DONE",
              appId: app.id,
              label: app.label,
              mode: app.mode,
              count: 1
            }).catch(() => {});
          }
        }
      }, 1200);
      return;
    }

    lastUnreadTitleCount = parseTitleFn(document.title);
    const checkTitleCount = () => {
      const nextCount = parseTitleFn(document.title);
      if (document.hidden && nextCount > 0 && nextCount > lastUnreadTitleCount) {
        tabAlertSent = true;
        chrome.runtime.sendMessage({
          type: "TAB_ALERT_DONE",
          appId: app.id,
          label: app.label,
          mode: app.mode,
          count: nextCount
        }).catch(() => {});
      } else if (nextCount === 0 && tabAlertSent) {
        tabAlertSent = false;
        chrome.runtime.sendMessage({ type: "TAB_ALERT_CLEARED" }).catch(() => {});
      }
      lastUnreadTitleCount = nextCount;
    };

    const titleEl = typeof document.querySelector === "function" ? document.querySelector("title") : null;
    if (titleEl && typeof MutationObserver === "function") {
      titleObserver = new MutationObserver(checkTitleCount);
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    } else {
      titlePollTimer = setInterval(checkTitleCount, 1800);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && tabAlertSent) {
      tabAlertSent = false;
      wasAiStreaming = false;
      chrome.runtime.sendMessage({ type: "TAB_ALERT_CLEARED" }).catch(() => {});
    }
  });


  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) readSettings(changes.settings.newValue);
  });
  chrome.storage.local.get("settings").then(data => readSettings(data.settings)).catch(() => {});
  // Title may not exist at document_start; attach its observer once parsing finishes.
  document.addEventListener("DOMContentLoaded", () => {
    if (titlePollTimer) { stopTabWatcher(false); syncTabWatcher(); }
  }, { once: true });
})();
