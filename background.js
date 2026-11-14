"use strict";

importScripts("shared/defaults.js", "shared/model-store.js", "shared/cloud-config.js", "vendor/auth-bundle.js", "shared/cloud-service.js");

const { DEFAULT_SETTINGS, DEFAULT_TIMER, DEFAULT_STATS, ALL_SPRITE_FILES, normalizeMotionQuotes } = globalThis.WAIFU_SHARED;
const WAIFU_MODEL_STORE = globalThis.WAIFU_MODEL_STORE;

let spriteCaches = {};
let modelCache = { key: null, promise: null };
let settingsWrites = Promise.resolve();
const runtimeLoads = new Map();

function updateSettings(patch) {
  const task = settingsWrites.then(async () => {
    const data = await chrome.storage.local.get("settings");
    const settings = mergeSettings({ ...(data.settings || {}), ...patch });
    await chrome.storage.local.set({ settings });
    return settings;
  });
  settingsWrites = task.catch(() => {});
  return task;
}

async function ensureCompanion(tabId, documentId, mode, retry = false) {
  const target = documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] };
  const key = `${tabId}:${documentId || "main"}:${mode}`;
  if (runtimeLoads.has(key)) return runtimeLoads.get(key);
  const task = (async () => {
    const [probe] = await chrome.scripting.executeScript({ target, func: () => ({
      mounted: Boolean(window.__waifuCompanionMounted), vrm: Boolean(window.WaifuVrmAnimator),
      shared: Boolean(window.WAIFU_SHARED), sprites: Boolean(window.WaifuMeshAnimator)
    }) });
    const state = probe.result || {};
    const files = [];
    if (!state.shared) files.push("shared/defaults.js");
    if (!state.sprites) files.push("shared/dance-player.js", "content/animator.js");
    if (mode === "3d" && !state.vrm) files.push("vendor/vrm-bundle.js", "content/secondary-motion.js", "content/vrm-animator.js");
    if (!state.mounted) files.push("content/companion.js");
    if (files.length) await chrome.scripting.executeScript({ target, files, injectImmediately: true });
    if (state.mounted) await chrome.scripting.executeScript({ target, func: retry => window.WAIFU_REFRESH_RENDERER?.(retry), args: [retry] });
    return { ok: true };
  })();
  runtimeLoads.set(key, task);
  try { return await task; } finally { runtimeLoads.delete(key); }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(""));
}

async function getEncodedSprites(modelKey = "seraphina") {
  const isCrimson = modelKey === "gothic_red" || modelKey === "crimson";
  const cacheKey = isCrimson ? "gothic_red" : "seraphina";
  if (!spriteCaches[cacheKey]) {
    spriteCaches[cacheKey] = (async () => {
      const spriteFiles = globalThis.WAIFU_SHARED?.getSpriteFiles
        ? globalThis.WAIFU_SHARED.getSpriteFiles(cacheKey)
        : ALL_SPRITE_FILES;
      const entries = await Promise.all(
        Object.entries(spriteFiles || {}).map(async ([key, relPath]) => {
          const url = chrome.runtime.getURL(relPath);
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`Failed to fetch sprite ${relPath}: ${resp.status}`);
          const buf = await resp.arrayBuffer();
          return [key, arrayBufferToBase64(buf)];
        })
      );
      return Object.fromEntries(entries);
    })().catch((err) => {
      delete spriteCaches[cacheKey];
      throw err;
    });
  }
  return spriteCaches[cacheKey];
}

const ALARM_END = "waifu_timer_end";
const ALARM_BADGE = "waifu_timer_badge";
const ALARM_WELLNESS = "waifu_wellness_tick";

function todayDateKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function normalizeStats(raw) {
  const today = todayDateKey();
  if (!raw || raw.dateKey !== today) {
    return {
      ...DEFAULT_STATS,
      dateKey: today,
      cheerCount: Number(raw?.cheerCount) || 0
    };
  }
  return {
    ...DEFAULT_STATS,
    ...raw,
    dateKey: today
  };
}

async function syncWellnessAlarm(settings) {
  await chrome.alarms.clear(ALARM_WELLNESS);
  if (settings && settings.enabled !== false && settings.wellnessReminder !== false) {
    await chrome.alarms.create(ALARM_WELLNESS, { periodInMinutes: 30 });
  }
}

function mergeDefaults(defaults, existing) {
  const out = { ...defaults };
  if (existing && typeof existing === "object") {
    for (const key of Object.keys(existing)) {
      if (
        existing[key] &&
        typeof existing[key] === "object" &&
        !Array.isArray(existing[key]) &&
        defaults[key] &&
        typeof defaults[key] === "object" &&
        !Array.isArray(defaults[key])
      ) {
        out[key] = mergeDefaults(defaults[key], existing[key]);
      } else {
        out[key] = existing[key];
      }
    }
  }
  return out;
}

function normalizePendingAlerts(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const label = String(entry.label || "").trim();
    if (!label) continue;
    out[String(k)] = {
      tabId: entry.tabId ?? Number(k),
      appId: String(entry.appId || "custom"),
      label,
      mode: entry.mode === "ai_stream" ? "ai_stream" : "title_count",
      count: Math.max(1, Number(entry.count) || 1),
      updatedAt: Number(entry.updatedAt) || Date.now()
    };
  }
  return out;
}

function summarizePendingAlerts(pendingObj) {
  const list = Object.values(pendingObj || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let totalItems = 0;
  for (const item of list) {
    totalItems += item.mode === "title_count" ? Math.max(1, Number(item.count) || 1) : 1;
  }
  return {
    pendingList: list,
    tabCount: list.length,
    totalCount: totalItems
  };
}

async function syncAlertBadge(timer, pendingObj) {
  if (!chrome.action?.setBadgeText) return;
  if (timer && timer.status !== "idle") return;
  const { tabCount } = summarizePendingAlerts(pendingObj);
  if (tabCount > 0) {
    await chrome.action.setBadgeText({ text: tabCount > 99 ? "99+" : String(tabCount) }).catch(() => {});
    if (chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: "#ec4899" }).catch(() => {});
    }
  } else {
    await chrome.action.setBadgeText({ text: "" }).catch(() => {});
  }
}

function mergeSettings(existing) {
  const out = mergeDefaults(DEFAULT_SETTINGS, existing);
  out.interactionFrequency=out.interactionFrequency==='quiet'?'quiet':'playful';
  out.motionQuotes = normalizeMotionQuotes(out.motionQuotes, existing?.customQuotes);
  delete out.customQuotes;
  return out;
}

async function ensureInitialized() {
  const data = await chrome.storage.local.get(["settings", "timer", "stats"]);
  const settings = mergeSettings(data.settings);
  // Built-in assets ship with this package. Do not download a whole VRM at startup.
  if (!data.settings?.userChose2D && settings.renderMode !== "3d") settings.renderMode = "3d";
  const timer = mergeDefaults(DEFAULT_TIMER, data.timer);
  const stats = normalizeStats(data.stats);
  await chrome.storage.local.set({ settings, timer, stats });
  await syncBadgeAndAlarms(timer);
  await syncWellnessAlarm(settings);
  return { settings, timer, stats };
}

async function syncBadgeAndAlarms(timer) {
  await chrome.alarms.clear(ALARM_END);
  await chrome.alarms.clear(ALARM_BADGE);

  if (timer.status === "running" && timer.targetEndMs) {
    const msLeft = Math.max(0, timer.targetEndMs - Date.now());
    if (msLeft <= 500) {
      await handleTimerFinish();
      return;
    }
    await chrome.alarms.create(ALARM_END, { when: timer.targetEndMs });
    await chrome.alarms.create(ALARM_BADGE, { periodInMinutes: 1 });

    const minsLeft = Math.max(1, Math.ceil(msLeft / 60000));
    await chrome.action.setBadgeText({ text: `${minsLeft}m` });
    await chrome.action.setBadgeBackgroundColor({
      color: timer.phase === "focus" ? "#7C5CFF" : "#C9A45C"
    });
  } else if (timer.status === "paused") {
    const minsLeft = Math.max(1, Math.ceil((timer.remainingSeconds || 0) / 60));
    await chrome.action.setBadgeText({ text: `${minsLeft}p` });
    await chrome.action.setBadgeBackgroundColor({ color: "#5E1D39" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function broadcastToTabs(payload) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch {
    // Ignore tabs without active receiver
  }
}

async function sendToActiveTab(payload) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs) {
      if (tab.id && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch {
    // Ignore restricted tabs
  }
}

async function handleTimerFinish() {
  const data = await chrome.storage.local.get(["timer", "stats"]);
  const timer = data.timer;
  if (!timer || timer.status !== "running") return;

  const finishedPhase = timer.phase;
  const nextPhase = finishedPhase === "focus" ? "break" : "focus";
  const nextMinutes = nextPhase === "focus" ? timer.focusMinutes : timer.breakMinutes;

  const updated = {
    ...timer,
    status: "idle",
    phase: nextPhase,
    remainingSeconds: nextMinutes * 60,
    targetEndMs: null
  };

  let stats = normalizeStats(data.stats);
  if (finishedPhase === "focus") {
    stats = {
      ...stats,
      focusSessionsToday: (Number(stats.focusSessionsToday) || 0) + 1
    };
  }

  await chrome.storage.local.set({ timer: updated, stats });
  await syncBadgeAndAlarms(updated);

  await chrome.action.setBadgeText({ text: finishedPhase === "focus" ? "DONE" : "GO" });
  await chrome.action.setBadgeBackgroundColor({ color: "#C9A45C" });

  await broadcastToTabs({
    type: "WAIFU_TIMER_EVENT",
    event: finishedPhase === "focus" ? "focus_complete" : "break_complete",
    timer: updated,
    stats
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureInitialized();
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitialized();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_END) {
    await handleTimerFinish();
  } else if (alarm.name === ALARM_BADGE) {
    const { timer } = await chrome.storage.local.get(["timer"]);
    if (timer && timer.status === "running" && timer.targetEndMs) {
      const msLeft = timer.targetEndMs - Date.now();
      if (msLeft <= 0) {
        await handleTimerFinish();
      } else {
        const minsLeft = Math.max(1, Math.ceil(msLeft / 60000));
        await chrome.action.setBadgeText({ text: `${minsLeft}m` });
      }
    }
  } else if (alarm.name === ALARM_WELLNESS) {
    const data = await chrome.storage.local.get(["settings", "timer"]);
    const settings = mergeSettings(data.settings);
    const timer = mergeDefaults(DEFAULT_TIMER, data.timer);
    if (settings.enabled !== false && settings.wellnessReminder !== false && timer.status !== "running") {
      await sendToActiveTab({ type: "WAIFU_WELLNESS_REMINDER" });
    }
  }
});

if (chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings?.newValue) {
      const old = mergeSettings(changes.settings.oldValue);
      const next = mergeSettings(changes.settings.newValue);
      if (old.enabled !== next.enabled || old.wellnessReminder !== next.wellnessReminder) syncWellnessAlarm(next);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  (async () => {
    if (typeof msg.type === 'string' && msg.type.startsWith('CLOUD_')) {
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('popup/'))) {
        sendResponse({ok:false,error:'Open the extension dashboard to use account features'});return;
      }
      try {
        if (!globalThis.WAIFU_CLOUD) importScripts('shared/cloud-config.js','vendor/auth-bundle.js','shared/cloud-service.js');
        sendResponse(await WAIFU_CLOUD.handle(msg));
      } catch (err) { sendResponse({ok:false,error:String(err?.message || 'Cloud request failed')}); }
      return;
    }
    if (msg.type === "UPDATE_SETTINGS") {
      try { sendResponse({ ok: true, settings: await updateSettings(msg.patch || {}) }); }
      catch (err) { sendResponse({ ok: false, error: String(err) }); }
      return;
    }
    if (msg.type === "ENSURE_COMPANION" || msg.type === "RETRY_COMPANION") {
      try {
        let tabId = sender.tab?.id;
        let documentId = sender.documentId;
        if (msg.type === "RETRY_COMPANION") {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id || !/^https?:/.test(tab.url || "")) throw Error("This browser page does not allow companions");
          tabId = tab.id; documentId = null;
          await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/bootstrap.js"] });
          sendResponse({ ok: true });
          return;
        } else if (tabId == null || sender.frameId !== 0) throw Error("Only the top-level page can start a companion");
        sendResponse(await ensureCompanion(tabId, documentId, msg.mode === "2d" ? "2d" : "3d", Boolean(msg.retry)));
      } catch (err) { sendResponse({ ok: false, error: String(err?.message || err) }); }
      return;
    }
    if (msg.type === "GET_SPRITES") {
      try {
        const stored = await chrome.storage.local.get("settings");
        const curSettings = mergeSettings(stored?.settings);
        const modelKey = msg.model || curSettings.activeModel || "seraphina";
        const allSprites = await getEncodedSprites(modelKey);
        if (Array.isArray(msg.keys) && msg.keys.length > 0) {
          const subset = {};
          for (const k of msg.keys) {
            if (Object.prototype.hasOwnProperty.call(allSprites, k)) {
              subset[k] = allSprites[k];
            }
          }
          sendResponse({ ok: true, sprites: subset });
        } else {
          sendResponse({ ok: true, sprites: allSprites });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (msg.type === "GET_3D_MODEL") {
      try {
        const stored = await chrome.storage.local.get("settings");
        const curSettings = mergeSettings(stored.settings);
        if (["seraphina", "gothic_red"].includes(msg.model)) curSettings.activeModel = msg.model;
        if (["auto", "custom", "starter"].includes(msg.source)) curSettings.modelSource = msg.source;
        if (msg.preferUrl && curSettings.modelSource !== "custom" && !curSettings.modelName) {
          const name = curSettings.modelSource === "starter" ? "seraphina_starter.glb" :
            curSettings.activeModel === "gothic_red" ? "companion_alt.vrm" : "seraphina.vrm";
          sendResponse({ ok: true, name, source: curSettings.modelSource === "starter" ? "starter" : "bundled_vrm",
            url: chrome.runtime.getURL(`assets/models/${name}`) });
          return;
        }
        let customRec = null;
        if (curSettings.modelSource !== "starter" && WAIFU_MODEL_STORE?.loadCustomModel) {
          customRec = await WAIFU_MODEL_STORE.loadCustomModel();
        }
        const customSig = customRec?.buffer
          ? `${customRec.name || ""}:${customRec.size || customRec.buffer.byteLength}:${customRec.updatedAt || 0}`
          : "none";
        const activeChoice = curSettings.activeModel || "seraphina";
        const cacheKey = `${curSettings.modelSource}|${activeChoice}|${curSettings.modelVersion || 0}|${customSig}`;

        if (!modelCache.promise || modelCache.key !== cacheKey) {
          const loadPromise = (async () => {
            if (customRec?.buffer) {
              return {
                ok: true,
                source: "custom",
                name: customRec.name || curSettings.modelName || "custom.vrm",
                bytes: customRec.size || customRec.buffer.byteLength,
                base64: arrayBufferToBase64(customRec.buffer)
              };
            }

            if (curSettings.modelSource !== "starter") {
              const targetVrm = activeChoice === "gothic_red" ? "companion_alt.vrm" : "seraphina.vrm";
              try {
                const vrmUrl = chrome.runtime.getURL(`assets/models/${targetVrm}`);
                const vrmResp = await fetch(vrmUrl);
                if (vrmResp.ok) {
                  const buf = await vrmResp.arrayBuffer();
                  return {
                    ok: true,
                    source: "bundled_vrm",
                    name: targetVrm,
                    bytes: buf.byteLength,
                    base64: arrayBufferToBase64(buf)
                  };
                }
              } catch {
                // Fall through cleanly to bundled starter GLB
              }
            }

            const starterUrl = chrome.runtime.getURL("assets/models/seraphina_starter.glb");
            const starterResp = await fetch(starterUrl);
            if (!starterResp.ok) throw new Error(`Starter model fetch failed: ${starterResp.status}`);
            const starterBuf = await starterResp.arrayBuffer();
            return {
              ok: true,
              source: "starter",
              name: "seraphina_starter.glb",
              bytes: starterBuf.byteLength,
              base64: arrayBufferToBase64(starterBuf)
            };
          })();

          modelCache = { key: cacheKey, promise: loadPromise };
          loadPromise.catch(() => {
            if (modelCache.promise === loadPromise) {
              modelCache = { key: null, promise: null };
            }
          });
        }

        const payload = await modelCache.promise;
        sendResponse(payload);
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    const data = await chrome.storage.local.get(["settings", "timer", "stats", "pendingAlerts"]);
    const settings = mergeSettings(data.settings);
    let timer = mergeDefaults(DEFAULT_TIMER, data.timer);
    let stats = normalizeStats(data.stats);
    let pendingAlerts = normalizePendingAlerts(data.pendingAlerts);

    if (msg.type === "GET_STATE") {
      if (timer.status === "running" && timer.targetEndMs) {
        const left = Math.max(0, Math.round((timer.targetEndMs - Date.now()) / 1000));
        if (left === 0) {
          await handleTimerFinish();
          const refreshed = await chrome.storage.local.get(["timer", "stats"]);
          timer = refreshed.timer || timer;
          stats = normalizeStats(refreshed.stats);
        } else {
          timer = { ...timer, remainingSeconds: left };
        }
      }
      sendResponse({ settings, timer, stats, pendingAlerts });
      return;
    }

    if (msg.type === "TIMER_START") {
      const secs = Math.max(10, timer.remainingSeconds || (timer.phase === "focus" ? timer.focusMinutes : timer.breakMinutes) * 60);
      timer = {
        ...timer,
        status: "running",
        remainingSeconds: secs,
        targetEndMs: Date.now() + secs * 1000
      };
      await chrome.storage.local.set({ timer });
      await syncBadgeAndAlarms(timer);
      sendResponse({ timer });
      return;
    }

    if (msg.type === "TIMER_PAUSE") {
      const left = timer.targetEndMs
        ? Math.max(1, Math.round((timer.targetEndMs - Date.now()) / 1000))
        : timer.remainingSeconds;
      timer = {
        ...timer,
        status: "paused",
        remainingSeconds: left,
        targetEndMs: null
      };
      await chrome.storage.local.set({ timer });
      await syncBadgeAndAlarms(timer);
      sendResponse({ timer });
      return;
    }

    if (msg.type === "TIMER_RESET") {
      const mins = timer.phase === "focus" ? timer.focusMinutes : timer.breakMinutes;
      timer = {
        ...timer,
        status: "idle",
        remainingSeconds: mins * 60,
        targetEndMs: null
      };
      await chrome.storage.local.set({ timer });
      await syncBadgeAndAlarms(timer);
      await syncAlertBadge(timer, pendingAlerts);
      sendResponse({ timer });
      return;
    }

    if (msg.type === "TIMER_SET_PHASE") {
      const phase = msg.phase === "break" ? "break" : "focus";
      const mins = phase === "focus" ? timer.focusMinutes : timer.breakMinutes;
      timer = {
        ...timer,
        status: "idle",
        phase,
        remainingSeconds: mins * 60,
        targetEndMs: null
      };
      await chrome.storage.local.set({ timer });
      await syncBadgeAndAlarms(timer);
      await syncAlertBadge(timer, pendingAlerts);
      sendResponse({ timer });
      return;
    }

    if (msg.type === "TIMER_SET_DURATIONS") {
      const focusMinutes = Math.min(120, Math.max(1, Number(msg.focusMinutes) || 25));
      const breakMinutes = Math.min(60, Math.max(1, Number(msg.breakMinutes) || 5));
      const nextRemaining =
        timer.status === "idle"
          ? (timer.phase === "focus" ? focusMinutes : breakMinutes) * 60
          : timer.remainingSeconds;
      timer = {
        ...timer,
        focusMinutes,
        breakMinutes,
        remainingSeconds: nextRemaining
      };
      await chrome.storage.local.set({ timer });
      await syncBadgeAndAlarms(timer);
      sendResponse({ timer });
      return;
    }

    if (msg.type === "TRIGGER_POSE_PREVIEW") {
      await broadcastToTabs({ type: "WAIFU_PULSE_POSE", pose: msg.pose, quote: msg.quote });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "TAB_ALERT_DONE") {
      const tabId = sender?.tab?.id;
      if (tabId == null) {
        sendResponse({ ok: false });
        return;
      }
      if (settings.tabAlerts?.enabled === false) {
        sendResponse({ ok: true, pendingAlerts });
        return;
      }
      const appId = String(msg.appId || "custom");
      const isCustom = appId.startsWith("custom:");
      if (!isCustom && settings.tabAlerts?.apps?.[appId] === false) {
        sendResponse({ ok: true, pendingAlerts });
        return;
      }
      pendingAlerts[String(tabId)] = {
        tabId,
        appId,
        label: String(msg.label || "Tab"),
        mode: msg.mode === "ai_stream" ? "ai_stream" : "title_count",
        count: Math.max(1, Number(msg.count) || 1),
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ pendingAlerts });
      await syncAlertBadge(timer, pendingAlerts);
      const summary = summarizePendingAlerts(pendingAlerts);
      await sendToActiveTab({
        type: "WAIFU_TAB_ALERT_EVENT",
        event: "triggered",
        latest: pendingAlerts[String(tabId)],
        pendingList: summary.pendingList,
        tabCount: summary.tabCount,
        totalCount: summary.totalCount
      });
      sendResponse({ ok: true, pendingAlerts, ...summary });
      return;
    }

    if (msg.type === "TAB_ALERT_CLEARED") {
      const tabId = sender?.tab?.id ?? msg.tabId;
      if (tabId != null && pendingAlerts[String(tabId)]) {
        delete pendingAlerts[String(tabId)];
        await chrome.storage.local.set({ pendingAlerts });
        await syncAlertBadge(timer, pendingAlerts);
      }
      sendResponse({ ok: true, pendingAlerts, ...summarizePendingAlerts(pendingAlerts) });
      return;
    }

    if (msg.type === "CLEAR_ALL_TAB_ALERTS") {
      pendingAlerts = {};
      await chrome.storage.local.set({ pendingAlerts });
      await syncAlertBadge(timer, pendingAlerts);
      sendResponse({ ok: true, pendingAlerts, pendingList: [], tabCount: 0, totalCount: 0 });
      return;
    }

    sendResponse({ ok: false });
  })();

  return true;
});

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get(["timer", "pendingAlerts"]);
    const pendingAlerts = normalizePendingAlerts(data.pendingAlerts);
    if (!pendingAlerts[String(tabId)]) return;
    delete pendingAlerts[String(tabId)];
    await chrome.storage.local.set({ pendingAlerts });
    const timer = mergeDefaults(DEFAULT_TIMER, data.timer);
    await syncAlertBadge(timer, pendingAlerts);
  });
}
