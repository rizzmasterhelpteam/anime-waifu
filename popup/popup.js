(function () {
  "use strict";

  const {
    DEFAULT_SETTINGS,
    DEFAULT_TIMER,
    DEFAULT_STATS,
    TAB_WATCH_APPS,
    MOTION_IDS,
    MAX_MOTION_BUBBLES,
    DEFAULT_MOTION_QUOTES,
    normalizeMotionQuotes
  } = window.WAIFU_SHARED;
  let WaifuMeshAnimator = window.WaifuMeshAnimator;
  let WaifuVrmAnimator = window.WaifuVrmAnimator;
  const WAIFU_MODEL_STORE = window.WAIFU_MODEL_STORE;

  const MOTION_LABELS = {
    idle: "Idle",
    wave: "Wave",
    think: "Think",
    celebrate: "Cheer",
    tea: "Tea"
  };

  let settings = { ...DEFAULT_SETTINGS };
  let timer = { ...DEFAULT_TIMER };
  let stats = { ...DEFAULT_STATS };
  let pendingAlerts = {};
  let activeHost = "";
  let previewAnimator = null;
  let previewRenderMode = null;
  let previewModelVersion = null;
  let previewModelSource = null;
  let previewCompanionModel = null;
  let previewWebglFailed = false;
  let timerTickInterval = null;
  let selectedQuoteMotion = "idle";
  let previewRequested = false;
  let popupClosed = false;
  let settingsRenderFrame = null;
  let saveInFlight = null;
  let inFlightPatch = {};
  let lastQuotesSignature = null;
  let lastAlertsSignature = null;
  const runtimeScripts = new Map();
  let editingQuoteIndex = -1;

  const els = {
    previewCanvas: document.getElementById("preview-canvas"),
    previewImage: document.getElementById("preview-image"),
    btnPreview: document.getElementById("btn-preview"),
    btnRetry: document.getElementById("btn-retry"),
    siteStatus: document.getElementById("site-status"),
    nameInput: document.getElementById("char-name-input"),
    toggleEnabled: document.getElementById("toggle-enabled"),
    statusSubtitle: document.getElementById("status-subtitle"),
    btnSiteToggle: document.getElementById("btn-site-toggle"),
    btnResetPos: document.getElementById("btn-reset-pos"),
    engineBtns: document.querySelectorAll(".engine-btn:not(.model-btn)"),
    modelCards: document.querySelectorAll(".model-card"),
    btnCustomCard: document.getElementById("btn-custom-card"),
    customActiveBar: document.getElementById("custom-active-bar"),
    customModelFilename: document.getElementById("custom-model-filename"),
    customCardTitle: document.getElementById("custom-card-title"),
    customCardDesc: document.getElementById("custom-card-desc"),
    vrmFileInput: document.getElementById("vrm-file-input"),
    btnResetVrm: document.getElementById("btn-reset-vrm"),
    tabs: document.querySelectorAll(".tab"),
    panels: document.querySelectorAll(".panel"),
    poseBtns: document.querySelectorAll(".pose-btn"),
    rangeSize: document.getElementById("range-size"),
    valSize: document.getElementById("val-size"),
    rangeOpacity: document.getElementById("range-opacity"),
    valOpacity: document.getElementById("val-opacity"),
    toggleMotion: document.getElementById("toggle-motion"),
    physicsControls: document.getElementById("physics-controls"),
    togglePhysics: document.getElementById("toggle-physics"),
    rangePhysics: document.getElementById("range-physics"),
    valPhysics: document.getElementById("val-physics"),
    rangeChest: document.getElementById("range-chest"),
    valChest: document.getElementById("val-chest"),
    btnPreviewPhysics: document.getElementById("btn-preview-physics"),
    toggle25D: document.getElementById("toggle-25d"),
    toggleStroll: document.getElementById("toggle-stroll"),
    toggleSmartRoles: document.getElementById("toggle-smart-roles"),
    toggleWellness: document.getElementById("toggle-wellness"),
    toggleCursor: document.getElementById("toggle-cursor"),
    toggleBubbles: document.getElementById("toggle-bubbles"),
    toggleGreet: document.getElementById("toggle-greet"),
    toggleFullscreen: document.getElementById("toggle-fullscreen"),
    phaseFocus: document.getElementById("phase-focus"),
    phaseBreak: document.getElementById("phase-break"),
    timerDisplay: document.getElementById("timer-display"),
    timerHint: document.getElementById("timer-hint"),
    btnTimerStart: document.getElementById("btn-timer-start"),
    btnTimerReset: document.getElementById("btn-timer-reset"),
    presetBtns: document.querySelectorAll(".preset-btn"),
    motionQuoteTabs: document.querySelectorAll(".motion-tab"),
    quoteMotionLabel: document.getElementById("quote-motion-label"),
    quoteCountPill: document.getElementById("quote-count-pill"),
    btnResetMotionQuotes: document.getElementById("btn-reset-motion-quotes"),
    quoteInput: document.getElementById("quote-input"),
    btnAddQuote: document.getElementById("btn-add-quote"),
    quotesList: document.getElementById("quotes-list"),
    btnTestBubble: document.getElementById("btn-test-bubble"),
    toggleTabAlerts: document.getElementById("toggle-tab-alerts"),
    alertPoseSelect: document.getElementById("alert-pose-select"),
    pendingAlertsText: document.getElementById("pending-alerts-text"),
    btnClearAlerts: document.getElementById("btn-clear-alerts"),
    alertsAppList: document.getElementById("alerts-app-list"),
    customDomainInput: document.getElementById("custom-domain-input"),
    btnAddDomain: document.getElementById("btn-add-domain"),
    customDomainsList: document.getElementById("custom-domains-list")
  };

  function normalizePopupSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    merged.interactionFrequency=merged.interactionFrequency==='quiet'?'quiet':'playful';
    const defAlerts = DEFAULT_SETTINGS.tabAlerts || { enabled: true, pose: "celebrate", apps: {}, customDomains: [] };
    merged.tabAlerts = {
      ...defAlerts,
      ...(raw?.tabAlerts || {}),
      apps: {
        ...(defAlerts.apps || {}),
        ...(raw?.tabAlerts?.apps || {})
      },
      customDomains: Array.isArray(raw?.tabAlerts?.customDomains)
        ? raw.tabAlerts.customDomains
        : (defAlerts.customDomains || [])
    };
    merged.motionQuotes = normalizeMotionQuotes(raw?.motionQuotes, raw?.customQuotes);
    delete merged.customQuotes;
    return merged;
  }

  function saveTabAlerts(partial) {
    const cur = normalizePopupSettings(settings).tabAlerts;
    saveSettings({
      tabAlerts: {
        ...cur,
        ...partial,
        apps: {
          ...cur.apps,
          ...(partial.apps || {})
        }
      }
    });
  }

  function formatMMSS(sec) {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }

  function resolvePreviewPose() {
    if (settings.poseMode && settings.poseMode !== "auto") return settings.poseMode;
    if (timer.status === "running") return timer.phase === "break" ? "tea" : "think";
    return "idle";
  }

  let saveDebounceTimer = null;
  let pendingSettings = {};
  let activeTabId = "companion";

  function scheduleSettingsRender() {
    if (settingsRenderFrame !== null || popupClosed) return;
    settingsRenderFrame = requestAnimationFrame(() => { settingsRenderFrame = null; renderSettingsUI(); });
  }

  async function flushSettings() {
    if (saveInFlight) return saveInFlight;
    if (!Object.keys(pendingSettings).length) return;
    const patch = pendingSettings;
    pendingSettings = {};
    inFlightPatch = patch;
    saveInFlight = (async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", patch });
        if (!response?.ok) throw Error("Could not save settings");
      } catch {
        // Preserve edits if the service worker restarts while the popup is open.
        const data = await chrome.storage.local.get("settings");
        await chrome.storage.local.set({ settings: { ...(data.settings || {}), ...patch } });
      }
    })();
    try { await saveInFlight; }
    finally {
      saveInFlight = null;
      inFlightPatch = {};
      if (Object.keys(pendingSettings).length) flushSettings();
    }
  }

  function saveSettings(partial, immediate = true) {
    settings = normalizePopupSettings({ ...settings, ...partial });
    pendingSettings = { ...pendingSettings, ...partial };
    scheduleSettingsRender();
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    if (immediate) flushSettings();
    else saveDebounceTimer = setTimeout(() => { saveDebounceTimer = null; flushSettings(); }, 150);
  }

  function syncPreviewImage() {
    const crimson = settings.activeModel === "gothic_red";
    const src = settings.renderMode === "2d"
      ? (crimson ? "../assets/sprites/crimson/idle.png" : "../assets/sprites/idle.png")
      : (crimson ? "../assets/previews/crimson-dashboard.png" : "../assets/previews/seraphina-dashboard.png");
    if (els.previewImage.getAttribute("src") !== src) els.previewImage.src = src;
    els.previewImage.alt = crimson ? "Crimson" : "Seraphina";
    els.btnPreview.textContent = previewRequested ? "Stop preview" : "Play preview";
    els.btnPreview.setAttribute("aria-pressed", String(previewRequested));
    if (!previewRequested) { els.previewCanvas.hidden = true; els.previewImage.hidden = false; }
  }

  function renderSettingsUI() {
    syncPreviewImage();
    if (document.activeElement !== els.nameInput) {
      els.nameInput.value = settings.name || "Seraphina";
    }
    els.toggleEnabled.checked = settings.enabled !== false;

    const curRender = (settings.renderMode || "2d") === "3d" && !previewWebglFailed ? "3d" : "2d";
    const motionLabel = settings.microMotion
      ? curRender === "3d"
        ? "3D WebGL"
        : settings.depth25D !== false
          ? "2.5D Live"
          : "2D Live"
      : "Static Eco";
    const stateLabel = settings.enabled ? "Active" : "Hidden";
    els.statusSubtitle.textContent = `${motionLabel} • ${stateLabel}`;

    els.engineBtns.forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-render") === (settings.renderMode || "2d"));
    });

    const isCustomModel = settings.modelSource === "custom" && Boolean(settings.modelName);
    const curActiveModel = settings.activeModel || "seraphina";

    if (els.statusSubtitle) {
      if (curRender === "2d") {
        const charName = curActiveModel === "gothic_red" ? "Crimson" : "Seraphina";
        els.statusSubtitle.textContent = `2D illustration · ${charName}`;
      } else if (isCustomModel) {
        els.statusSubtitle.textContent = `3D avatar · ${settings.modelName || "Custom"}`;
      } else if (curActiveModel === "gothic_red") {
        els.statusSubtitle.textContent = "3D avatar · Crimson";
      } else {
        els.statusSubtitle.textContent = "3D avatar · Seraphina";
      }
    }

    if (els.modelCards) {
      els.modelCards.forEach((card) => {
        const m = card.getAttribute("data-model");
        if (m === "custom") {
          card.classList.toggle("active", Boolean(isCustomModel));
        } else {
          card.classList.toggle("active", !isCustomModel && m === curActiveModel);
        }
      });
    }

    if (els.customActiveBar) {
      els.customActiveBar.hidden = !isCustomModel;
      if (els.customModelFilename && isCustomModel) {
        els.customModelFilename.textContent = settings.modelName || "custom.vrm";
      }
    }
    if (els.customCardDesc) {
      els.customCardDesc.textContent = isCustomModel ? (settings.modelName || "Loaded") : "Load .VRM";
    }

    const isHiddenHere = activeHost && Array.isArray(settings.hiddenDomains) && settings.hiddenDomains.includes(activeHost);
    els.btnRetry.disabled = !activeHost || settings.enabled === false || Boolean(isHiddenHere);
    if (!activeHost) {
      els.btnSiteToggle.disabled = true;
      els.btnSiteToggle.textContent = "No web page";
      els.btnSiteToggle.classList.remove("active-hidden");
    } else {
      els.btnSiteToggle.disabled = false;
      els.btnSiteToggle.textContent = isHiddenHere ? "Show here" : "Hide here";
      els.btnSiteToggle.classList.toggle("active-hidden", Boolean(isHiddenHere));
    }

    els.poseBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === (settings.poseMode==='idle'||settings.interactionFrequency==='quiet'?'calm':'playful'));
    });

    if (document.activeElement !== els.rangeSize) {
      els.rangeSize.value = settings.sizePx;
    }
    els.valSize.textContent = `${settings.sizePx}px`;
    document.querySelectorAll(".size-preset").forEach(button => {
      const selected = Number(button.dataset.size) === settings.sizePx;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    const opPct = Math.round((settings.opacity ?? 1) * 100);
    if (document.activeElement !== els.rangeOpacity) {
      els.rangeOpacity.value = opPct;
    }
    els.valOpacity.textContent = `${opPct}%`;

    if (els.toggleMotion) els.toggleMotion.checked = Boolean(settings.microMotion);
    els.physicsControls.hidden = curRender !== "3d";
    els.togglePhysics.checked = settings.bodyPhysics !== false;
    els.rangePhysics.value = settings.physicsStrength ?? 90;
    els.rangeChest.value = settings.chestBounce ?? 100;
    els.valPhysics.textContent = `${settings.physicsStrength ?? 90}%`;
    els.valChest.textContent = `${settings.chestBounce ?? 100}%`;
    const physicsOff = settings.bodyPhysics === false || !settings.microMotion;
    els.rangePhysics.disabled = els.rangeChest.disabled = els.btnPreviewPhysics.disabled = physicsOff;
    if (els.toggle25D) els.toggle25D.checked = settings.depth25D !== false;
    if (els.toggleStroll) els.toggleStroll.checked = settings.autoStroll !== false;
    if (els.toggleSmartRoles) els.toggleSmartRoles.checked = settings.smartRoles !== false;
    if (els.toggleWellness) els.toggleWellness.checked = settings.wellnessReminder !== false;
    if (els.toggleCursor) els.toggleCursor.checked = Boolean(settings.cursorFollow);
    if (els.toggleBubbles) els.toggleBubbles.checked = Boolean(settings.showBubbles);
    if (els.toggleGreet) els.toggleGreet.checked = Boolean(settings.greetOnLoad);
    if (els.toggleFullscreen) els.toggleFullscreen.checked = settings.showInFullscreen !== false;

    if (activeTabId === "quotes") {
      renderQuotesList();
    }
    if (activeTabId === "alerts") {
      renderAlertsUI();
    }

    if (previewAnimator) {
      const targetMode = (settings.renderMode || "2d") === "3d" && !previewWebglFailed ? "3d" : "2d";
      const targetVer = Number(settings.modelVersion) || 1;
      const targetSrc = settings.modelSource || "auto";
      const targetModel = settings.activeModel || "seraphina";
      if (
        targetMode !== previewRenderMode ||
        (targetVer !== previewModelVersion || targetSrc !== previewModelSource || targetModel !== previewCompanionModel)
      ) {
        ensurePreviewAnimator(true);
      } else {
        previewAnimator.setMicroMotion(Boolean(settings.microMotion));
        previewAnimator.setPhysicsOptions?.(settings.bodyPhysics !== false, (settings.physicsStrength ?? 90) / 100, (settings.chestBounce ?? 100) / 100);
        previewAnimator.setDepth25D(settings.depth25D !== false);
        previewAnimator.setPose(resolvePreviewPose(), false);
      }
    }
  }

  function renderTimerUI() {
    let remaining = timer.remainingSeconds ?? timer.focusMinutes * 60;
    if (timer.status === "running" && timer.targetEndMs) {
      remaining = Math.max(0, Math.round((timer.targetEndMs - Date.now()) / 1000));
    }

    els.timerDisplay.textContent = formatMMSS(remaining);
    els.phaseFocus.classList.toggle("active", timer.phase === "focus");
    els.phaseBreak.classList.toggle("active", timer.phase === "break");
    els.btnTimerStart.textContent = timer.status === "running" ? "Pause" : timer.status === "paused" ? "Resume" : "Start";

    els.presetBtns.forEach((btn) => {
      const f = Number(btn.getAttribute("data-focus"));
      const br = Number(btn.getAttribute("data-break"));
      btn.classList.toggle("active", f === timer.focusMinutes && br === timer.breakMinutes);
    });

    if (els.timerHint) {
      const doneCount = Number(stats?.focusSessionsToday) || 0;
      els.timerHint.textContent = doneCount > 0
        ? `Today: ${doneCount} focus session${doneCount === 1 ? "" : "s"} completed. Thinking on focus, Tea Break on rest.`
        : "She switches to Thinking while focusing and Tea Break on rest.";
    }

    if (previewAnimator && settings.poseMode === "auto" && previewAnimator.currentPose !== resolvePreviewPose()) {
      previewAnimator.setPose(resolvePreviewPose(), false);
    }
  }

  function saveMotionQuotes(motionId, nextList) {
    const normalized = normalizeMotionQuotes(settings.motionQuotes);
    normalized[motionId] = nextList
      .map((q) => (typeof q === "string" ? q.trim().slice(0, 140) : ""))
      .filter(Boolean)
      .slice(0, MAX_MOTION_BUBBLES);
    saveSettings({ motionQuotes: normalized });
  }

  function renderQuotesList() {
    if (!els.quotesList) return;
    const motionId = MOTION_IDS.includes(selectedQuoteMotion) ? selectedQuoteMotion : "idle";
    const label = MOTION_LABELS[motionId] || "Idle";
    const motionMap = normalizeMotionQuotes(settings.motionQuotes);
    const list = Array.isArray(motionMap[motionId]) ? motionMap[motionId] : [];
    const signature = JSON.stringify([motionId, list, editingQuoteIndex]);
    if (signature === lastQuotesSignature) return;
    lastQuotesSignature = signature;
    const atLimit = list.length >= MAX_MOTION_BUBBLES;

    if (els.motionQuoteTabs) {
      els.motionQuoteTabs.forEach((tab) => {
        tab.classList.toggle("active", tab.getAttribute("data-motion") === motionId);
      });
    }
    if (els.quoteMotionLabel) {
      els.quoteMotionLabel.textContent = `${label} Bubbles`;
    }
    if (els.quoteCountPill) {
      els.quoteCountPill.textContent = `${list.length} / ${MAX_MOTION_BUBBLES}`;
    }
    if (els.quoteInput) {
      els.quoteInput.disabled = atLimit;
      els.quoteInput.placeholder = atLimit
        ? `Max ${MAX_MOTION_BUBBLES} texts reached for ${label}`
        : `Add bubble text for ${label} (max ${MAX_MOTION_BUBBLES})...`;
    }
    if (els.btnAddQuote) {
      els.btnAddQuote.disabled = atLimit;
    }
    if (els.btnTestBubble) {
      els.btnTestBubble.textContent = `Say Random ${label} Text Now`;
    }

    els.quotesList.innerHTML = "";
    if (list.length === 0) {
      const empty = document.createElement("li");
      empty.className = "quote-item";
      empty.style.color = "#A9A2C7";
      empty.textContent = `No bubble texts for ${label} yet. Add up to ${MAX_MOTION_BUBBLES} above.`;
      els.quotesList.appendChild(empty);
      return;
    }

    list.forEach((q, idx) => {
      const li = document.createElement("li");
      li.className = "quote-item";

      if (editingQuoteIndex === idx) {
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 140;
        input.className = "quote-edit-input";
        input.value = q;

        const commitEdit = () => {
          const updated = input.value.trim();
          editingQuoteIndex = -1;
          if (updated) {
            const next = [...list];
            next[idx] = updated;
            saveMotionQuotes(motionId, next);
          }
          renderQuotesList();
        };
        const cancelEdit = () => {
          editingQuoteIndex = -1;
          renderQuotesList();
        };

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitEdit();
          else if (e.key === "Escape") cancelEdit();
        });

        const actions = document.createElement("div");
        actions.className = "quote-actions";

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "quote-save";
        saveBtn.textContent = "✓";
        saveBtn.title = "Save text";
        saveBtn.addEventListener("click", commitEdit);

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "quote-del";
        cancelBtn.textContent = "✕";
        cancelBtn.title = "Cancel edit";
        cancelBtn.addEventListener("click", cancelEdit);

        actions.append(saveBtn, cancelBtn);
        li.append(input, actions);
        els.quotesList.appendChild(li);
        setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
        return;
      }

      const span = document.createElement("span");
      span.className = "quote-text";
      span.textContent = q;
      span.title = "Click to edit";
      span.addEventListener("click", () => {
        editingQuoteIndex = idx;
        renderQuotesList();
      });

      const actions = document.createElement("div");
      actions.className = "quote-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "quote-edit";
      editBtn.textContent = "✎";
      editBtn.title = "Edit text";
      editBtn.addEventListener("click", () => {
        editingQuoteIndex = idx;
        renderQuotesList();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "quote-del";
      del.textContent = "✕";
      del.title = "Remove text";
      del.addEventListener("click", () => {
        editingQuoteIndex = -1;
        const next = list.filter((_, i) => i !== idx);
        saveMotionQuotes(motionId, next);
        renderQuotesList();
      });

      actions.append(editBtn, del);
      li.append(span, actions);
      els.quotesList.appendChild(li);
    });
  }

  function renderAlertsUI() {
    if (!els.toggleTabAlerts) return;
    const ta = normalizePopupSettings(settings).tabAlerts;
    const signature = JSON.stringify([ta, pendingAlerts]);
    if (signature === lastAlertsSignature) return;
    lastAlertsSignature = signature;
    els.toggleTabAlerts.checked = ta.enabled !== false;
    if (els.alertPoseSelect) {
      els.alertPoseSelect.value = ta.pose || "celebrate";
    }

    const pendingList = Object.values(pendingAlerts || {});
    if (els.pendingAlertsText && els.btnClearAlerts) {
      if (pendingList.length === 0) {
        els.pendingAlertsText.textContent = "No pending tab alerts";
        els.btnClearAlerts.disabled = true;
      } else {
        const names = [...new Set(pendingList.map((p) => p.label))];
        els.pendingAlertsText.textContent = `${pendingList.length} pending: ${names.join(", ")}`;
        els.btnClearAlerts.disabled = false;
      }
    }

    if (els.alertsAppList) {
      els.alertsAppList.innerHTML = "";
      for (const app of Object.values(TAB_WATCH_APPS || {})) {
        const labelEl = document.createElement("label");
        labelEl.className = "alert-row";

        const info = document.createElement("div");
        info.className = "alert-info";
        const title = document.createElement("span");
        title.className = "alert-title";
        title.textContent = app.label;
        const sub = document.createElement("span");
        sub.className = "alert-sub";
        sub.textContent = app.desc;
        info.append(title, sub);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = ta.apps?.[app.id] !== false;
        cb.addEventListener("change", () => {
          saveTabAlerts({ apps: { [app.id]: cb.checked } });
        });

        labelEl.append(info, cb);
        els.alertsAppList.appendChild(labelEl);
      }
    }

    if (els.customDomainsList) {
      els.customDomainsList.innerHTML = "";
      const domains = Array.isArray(ta.customDomains) ? ta.customDomains : [];
      if (domains.length === 0) {
        const empty = document.createElement("li");
        empty.className = "quote-item";
        empty.style.color = "#A9A2C7";
        empty.textContent = "No custom domains added yet.";
        els.customDomainsList.appendChild(empty);
      } else {
        domains.forEach((domain) => {
          const li = document.createElement("li");
          li.className = "quote-item";
          const span = document.createElement("span");
          span.textContent = domain;
          const del = document.createElement("button");
          del.type = "button";
          del.className = "quote-del";
          del.textContent = "✕";
          del.title = "Remove domain";
          del.addEventListener("click", () => {
            const next = domains.filter((d) => d !== domain);
            saveTabAlerts({ customDomains: next });
            renderAlertsUI();
          });
          li.append(span, del);
          els.customDomainsList.appendChild(li);
        });
      }
    }
  }

  function bindEvents() {
    els.tabs.forEach((tab, index) => {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "tab-" + tab.dataset.tab);
      tab.setAttribute("aria-selected", String(tab.classList.contains("active")));
      tab.tabIndex = tab.classList.contains("active") ? 0 : -1;
      tab.addEventListener("keydown", event => {
        const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!direction && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? els.tabs.length - 1 : (index + direction + els.tabs.length) % els.tabs.length;
        els.tabs[next].click(); els.tabs[next].focus();
      });
      tab.addEventListener("click", () => {
        const id = tab.getAttribute("data-tab");
        activeTabId = id;
        previewAnimator?.setPaused(document.hidden || id !== "companion" || !previewRequested);
        els.tabs.forEach((t) => {
          t.classList.toggle("active", t === tab);
          t.setAttribute("aria-selected", String(t === tab));
          t.tabIndex = t === tab ? 0 : -1;
        });
        els.panels.forEach((p) => p.classList.toggle("active", p.id === `tab-${id}`));
        if (id === "quotes") {
          if (settings.poseMode && MOTION_IDS.includes(settings.poseMode)) {
            selectedQuoteMotion = settings.poseMode;
          }
          editingQuoteIndex = -1;
          renderQuotesList();
        } else if (id === "alerts") {
          renderAlertsUI();
        } else if (id === "timer") {
          renderTimerUI();
        }
      });
    });

    els.btnPreview.addEventListener("click", async () => {
      previewRequested = !previewRequested;
      syncPreviewImage();
      previewAnimator?.setPaused(!previewRequested || document.hidden);
      if (previewRequested) await ensurePreviewAnimator();
    });
    els.btnRetry.addEventListener("click", async () => {
      els.btnRetry.disabled = true;
      els.siteStatus.textContent = "Reconnecting…";
      try {
        const response = await chrome.runtime.sendMessage({ type: "RETRY_COMPANION" });
        els.siteStatus.textContent = response?.ok ? "Companion restart requested" : response?.error || "Could not connect to this page";
      } catch { els.siteStatus.textContent = "Reload this website and try again"; }
      els.btnRetry.disabled = !activeHost;
    });

    els.nameInput.addEventListener("change", () => {
      const cleaned = els.nameInput.value.trim() || "Seraphina";
      els.nameInput.value = cleaned;
      saveSettings({ name: cleaned });
    });

    els.toggleEnabled.addEventListener("change", () => {
      saveSettings({ enabled: els.toggleEnabled.checked });
    });

    els.btnSiteToggle.addEventListener("click", () => {
      if (!activeHost) return;
      const list = Array.isArray(settings.hiddenDomains) ? [...settings.hiddenDomains] : [];
      const exists = list.includes(activeHost);
      const next = exists ? list.filter((d) => d !== activeHost) : [...list, activeHost];
      saveSettings({ hiddenDomains: next });
    });

    els.btnResetPos.addEventListener("click", () => {
      saveSettings({ position: { right: 24, bottom: 18 } });
    });

    els.engineBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mode = btn.getAttribute("data-render") === "2d" ? "2d" : "3d";
        saveSettings({ renderMode: mode, userChose2D: mode === "2d" });
        await ensurePreviewAnimator();
      });
    });

    if (els.modelCards) {
      els.modelCards.forEach((card) => {
        card.addEventListener("click", async () => {
          const modelKey = card.getAttribute("data-model");
          if (modelKey === "custom") {
            if (els.vrmFileInput) els.vrmFileInput.click();
            return;
          }
          if (settings.modelSource === "custom") {
            await WAIFU_MODEL_STORE.clearCustomModel();
          }
          previewWebglFailed = false;
          saveSettings({
            renderMode: settings.renderMode || "3d",
            activeModel: modelKey,
            modelSource: "auto",
            modelName: "",
            name: modelKey === "gothic_red" ? "Crimson" : "Seraphina",
            modelVersion: (Number(settings.modelVersion) || 1) + 1
          });
          await ensurePreviewAnimator(true);
        });
      });
    }

    if (els.vrmFileInput) {
      els.vrmFileInput.addEventListener("change", async () => {
        const file = els.vrmFileInput.files?.[0];
        els.vrmFileInput.value = "";
        if (!file) return;
        const lower = file.name.toLowerCase();
        if (!lower.endsWith(".vrm") && !lower.endsWith(".glb")) {
          alert("Please choose a .vrm or .glb file");
          return;
        }
        if (file.size > 42 * 1024 * 1024) {
          alert("File is too large (>42MB). Please optimize it first.");
          return;
        }
        try {
          const buf = await file.arrayBuffer();
          await WAIFU_MODEL_STORE.saveCustomModel({
            name: file.name,
            size: file.size,
            buffer: buf
          });
          previewWebglFailed = false;
          saveSettings({
            renderMode: "3d",
            modelSource: "custom",
            modelName: file.name,
            modelVersion: (Number(settings.modelVersion) || 1) + 1
          });
          await ensurePreviewAnimator(true);
        } catch (err) {
          console.error("Failed to load custom VRM:", err);
        }
      });
    }

    if (els.btnResetVrm) {
      els.btnResetVrm.addEventListener("click", async () => {
        await WAIFU_MODEL_STORE.clearCustomModel();
        saveSettings({
          modelSource: "auto",
          modelName: "",
          modelVersion: (Number(settings.modelVersion) || 1) + 1
        });
        await ensurePreviewAnimator(true);
      });
    }

    els.poseBtns.forEach(btn=>btn.addEventListener('click',async()=>{
      const mode=btn.dataset.mode;
      const feedback=document.getElementById('behavior-feedback');
      saveSettings({poseMode:'auto',interactionFrequency:mode==='calm'?'quiet':'playful',...(mode==='calm'?{}:{microMotion:true,autoStroll:true})});
      feedback.textContent=mode==='calm'?'Calm: peaceful idle. Tap her to interact.':'Playful: automatically walks, dances, gardens and reacts to you.';
      try{
        const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
        const r=tab?.id&&await chrome.tabs.sendMessage(tab.id,{type:'WAIFU_BEHAVIOR_CONTROL',action:mode});
        if(!r?.ok)throw Error();
      }catch{feedback.textContent+=' Refresh your website to connect the updated companion.';}
      if(previewAnimator){previewAnimator.behavior=null;previewAnimator.setPose(mode==='calm'?'idle':'wave',true);}
    }));

    document.querySelectorAll(".size-preset").forEach(button => {
      button.addEventListener("click", () => {
        const sizePx = Number(button.dataset.size);
        els.rangeSize.value = sizePx;
        els.valSize.textContent = `${sizePx}px`;
        saveSettings({ sizePx });
        renderSettingsUI();
      });
    });
    els.rangeSize.addEventListener("input", () => {
      const sz = Number(els.rangeSize.value);
      els.valSize.textContent = `${sz}px`;
      saveSettings({ sizePx: sz }, false);
    });
    els.rangeSize.addEventListener("change", () => {
      const sz = Number(els.rangeSize.value);
      saveSettings({ sizePx: sz }, true);
    });

    els.rangeOpacity.addEventListener("input", () => {
      const pct = Number(els.rangeOpacity.value);
      els.valOpacity.textContent = `${pct}%`;
      saveSettings({ opacity: pct / 100 }, false);
    });
    els.rangeOpacity.addEventListener("change", () => {
      const pct = Number(els.rangeOpacity.value);
      saveSettings({ opacity: pct / 100 }, true);
    });

    els.togglePhysics.addEventListener("change", () => {
      saveSettings({ bodyPhysics: els.togglePhysics.checked }); renderSettingsUI();
    });
    for (const [range, value, field] of [[els.rangePhysics, els.valPhysics, "physicsStrength"], [els.rangeChest, els.valChest, "chestBounce"]]) {
      range.addEventListener("input", () => {
        value.textContent = `${range.value}%`;
        saveSettings({ [field]: Number(range.value) }, false);
        previewAnimator?.setPhysicsOptions?.(settings.bodyPhysics !== false, (settings.physicsStrength ?? 90) / 100, (settings.chestBounce ?? 100) / 100);
      });
      range.addEventListener("change", () => saveSettings({ [field]: Number(range.value) }));
    }
    els.btnPreviewPhysics.addEventListener("click", async () => {
      previewRequested = true;
      syncPreviewImage();
      await ensurePreviewAnimator();
      previewAnimator?.triggerBounce();
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "WAIFU_PHYSICS_PULSE" });
      } catch { /* The popup preview still works without an injectable website. */ }
    });

    if (els.toggleMotion) {
      els.toggleMotion.addEventListener("change", () => {
        saveSettings({ microMotion: els.toggleMotion.checked });
        renderSettingsUI();
      });
    }
    if (els.toggle25D) {
      els.toggle25D.addEventListener("change", () => {
        saveSettings({ depth25D: els.toggle25D.checked });
      });
    }
    if (els.toggleStroll) {
      els.toggleStroll.addEventListener("change", () => {
        saveSettings({ autoStroll: els.toggleStroll.checked });
      });
    }
    if (els.toggleSmartRoles) {
      els.toggleSmartRoles.addEventListener("change", () => {
        saveSettings({ smartRoles: els.toggleSmartRoles.checked });
      });
    }
    if (els.toggleWellness) {
      els.toggleWellness.addEventListener("change", () => {
        saveSettings({ wellnessReminder: els.toggleWellness.checked });
      });
    }
    if (els.toggleCursor) {
      els.toggleCursor.addEventListener("change", () => {
        saveSettings({ cursorFollow: els.toggleCursor.checked });
      });
    }
    if (els.toggleBubbles) {
      els.toggleBubbles.addEventListener("change", () => {
        saveSettings({ showBubbles: els.toggleBubbles.checked });
      });
    }
    if (els.toggleGreet) {
      els.toggleGreet.addEventListener("change", () => {
        saveSettings({ greetOnLoad: els.toggleGreet.checked });
      });
    }
    if (els.toggleFullscreen) {
      els.toggleFullscreen.addEventListener("change", () => {
        saveSettings({ showInFullscreen: els.toggleFullscreen.checked });
      });
    }

    els.phaseFocus.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "TIMER_SET_PHASE", phase: "focus" });
      if (res?.timer) {
        timer = res.timer;
        renderTimerUI();
      }
    });

    els.phaseBreak.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "TIMER_SET_PHASE", phase: "break" });
      if (res?.timer) {
        timer = res.timer;
        renderTimerUI();
      }
    });

    els.btnTimerStart.addEventListener("click", async () => {
      const type = timer.status === "running" ? "TIMER_PAUSE" : "TIMER_START";
      const res = await chrome.runtime.sendMessage({ type });
      if (res?.timer) {
        timer = res.timer;
        renderTimerUI();
      }
    });

    els.btnTimerReset.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "TIMER_RESET" });
      if (res?.timer) {
        timer = res.timer;
        renderTimerUI();
      }
    });

    els.presetBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const focusMinutes = Number(btn.getAttribute("data-focus"));
        const breakMinutes = Number(btn.getAttribute("data-break"));
        const res = await chrome.runtime.sendMessage({
          type: "TIMER_SET_DURATIONS",
          focusMinutes,
          breakMinutes
        });
        if (res?.timer) {
          timer = res.timer;
          renderTimerUI();
        }
      });
    });

    if (els.motionQuoteTabs) {
      els.motionQuoteTabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          const motionId = tab.getAttribute("data-motion");
          if (!MOTION_IDS.includes(motionId)) return;
          selectedQuoteMotion = motionId;
          editingQuoteIndex = -1;
          renderQuotesList();
          if (previewAnimator) {
            previewAnimator.setPose(motionId, true);
          }
        });
      });
    }

    if (els.btnResetMotionQuotes) {
      els.btnResetMotionQuotes.addEventListener("click", () => {
        editingQuoteIndex = -1;
        saveMotionQuotes(selectedQuoteMotion, [...(DEFAULT_MOTION_QUOTES[selectedQuoteMotion] || [])]);
        renderQuotesList();
      });
    }

    const addQuote = () => {
      const val = els.quoteInput.value.trim();
      if (!val) return;
      const motionMap = normalizeMotionQuotes(settings.motionQuotes);
      const list = Array.isArray(motionMap[selectedQuoteMotion]) ? [...motionMap[selectedQuoteMotion]] : [];
      if (list.length >= MAX_MOTION_BUBBLES) return;
      list.push(val.slice(0, 140));
      els.quoteInput.value = "";
      editingQuoteIndex = -1;
      saveMotionQuotes(selectedQuoteMotion, list);
      renderQuotesList();
    };

    els.btnAddQuote.addEventListener("click", addQuote);
    els.quoteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addQuote();
    });

    els.btnTestBubble.addEventListener("click", async () => {
      const motionId = MOTION_IDS.includes(selectedQuoteMotion) ? selectedQuoteMotion : "idle";
      const motionMap = normalizeMotionQuotes(settings.motionQuotes);
      const list = Array.isArray(motionMap[motionId]) ? motionMap[motionId] : [];
      const line = list.length > 0
        ? list[Math.floor(Math.random() * list.length)]
        : `(${MOTION_LABELS[motionId] || motionId} has no bubble texts yet)`;
      await chrome.runtime.sendMessage({
        type: "TRIGGER_POSE_PREVIEW",
        pose: motionId,
        quote: line
      });
      if (previewAnimator) previewAnimator.setPose(motionId, true);
    });

    if (els.toggleTabAlerts) {
      els.toggleTabAlerts.addEventListener("change", () => {
        saveTabAlerts({ enabled: els.toggleTabAlerts.checked });
      });
    }
    if (els.alertPoseSelect) {
      els.alertPoseSelect.addEventListener("change", () => {
        saveTabAlerts({ pose: els.alertPoseSelect.value });
      });
    }
    if (els.btnClearAlerts) {
      els.btnClearAlerts.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ type: "CLEAR_ALL_TAB_ALERTS" }).catch(() => { });
        pendingAlerts = {};
        renderAlertsUI();
      });
    }

    const addCustomDomain = () => {
      if (!els.customDomainInput) return;
      const clean = els.customDomainInput.value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .split("?")[0];
      if (!clean || !clean.includes(".")) return;
      const cur = normalizePopupSettings(settings).tabAlerts.customDomains;
      if (!cur.includes(clean)) {
        saveTabAlerts({ customDomains: [...cur, clean] });
        renderAlertsUI();
      }
      els.customDomainInput.value = "";
    };

    if (els.btnAddDomain) {
      els.btnAddDomain.addEventListener("click", addCustomDomain);
    }
    if (els.customDomainInput) {
      els.customDomainInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addCustomDomain();
      });
    }
  }

  let previewLoadPromise = null;
  function loadRuntimeScript(path) {
    if (!runtimeScripts.has(path)) runtimeScripts.set(path, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(path);
      script.onload = resolve;
      script.onerror = () => { runtimeScripts.delete(path); script.remove(); reject(Error("Preview could not load")); };
      document.head.append(script);
    }));
    return runtimeScripts.get(path);
  }
  async function ensurePreviewAnimator() {
    if (!previewRequested || popupClosed) return;
    if (previewLoadPromise) return previewLoadPromise;
    const requestedKey = JSON.stringify([settings.renderMode, settings.modelVersion, settings.modelSource, settings.activeModel]);
    previewLoadPromise = (async () => {
      await loadRuntimeScript("shared/dance-player.js");
      await loadRuntimeScript("content/animator.js");
      if (settings.renderMode === "3d" && !previewWebglFailed) {
        for (const file of ["vendor/vrm-bundle.js", "content/secondary-motion.js", "content/vrm-animator.js"]) await loadRuntimeScript(file);
      }
      if (!previewRequested || popupClosed) return;
      WaifuMeshAnimator = window.WaifuMeshAnimator;
      WaifuVrmAnimator = window.WaifuVrmAnimator;
      await buildPreviewAnimator();
    })().catch(() => {
      previewRequested = false;
      syncPreviewImage();
      els.siteStatus.textContent = "Preview unavailable. Your settings still work.";
    });
    try { await previewLoadPromise; }
    finally {
      previewLoadPromise = null;
      if (!popupClosed && previewRequested && requestedKey !== JSON.stringify([settings.renderMode, settings.modelVersion, settings.modelSource, settings.activeModel])) ensurePreviewAnimator();
    }
  }

  async function buildPreviewAnimator() {
    const want3D =
      (settings.renderMode || "2d") === "3d" &&
      typeof WaifuVrmAnimator === "function" &&
      !previewWebglFailed;
    const nextMode = want3D ? "3d" : "2d";
    const nextVer = Number(settings.modelVersion) || 1;
    const nextSrc = settings.modelSource || "auto";
    const nextModel = settings.activeModel || "seraphina";

    if (
      previewAnimator &&
      nextMode === previewRenderMode &&
      (nextVer === previewModelVersion && nextSrc === previewModelSource && nextModel === previewCompanionModel)
    ) {
      previewAnimator.setPaused(document.hidden || activeTabId !== "companion" || !previewRequested);
      els.previewCanvas.hidden = !previewRequested;
      els.previewImage.hidden = previewRequested;
      return;
    }

    // If only model changed inside 3D mode, reload cleanly in place
    if (previewAnimator && nextMode === "3d" && previewRenderMode === "3d") {
      previewModelVersion = nextVer;
      previewModelSource = nextSrc;
      previewCompanionModel = nextModel;
      els.previewImage.hidden = false;
      els.previewCanvas.hidden = true;
      previewAnimator.modelKey = nextModel;
      previewAnimator.modelSource = nextSrc;
      await previewAnimator.reloadModel();
      if (popupClosed) return;
      els.previewImage.hidden = previewRequested;
      els.previewCanvas.hidden = !previewRequested;
      previewAnimator.setPose(resolvePreviewPose(), false);
      return;
    }

    // If only model changed inside 2D mode, reload cleanly in place
    if (previewAnimator && nextMode === "2d" && previewRenderMode === "2d") {
      previewModelVersion = nextVer;
      previewModelSource = nextSrc;
      previewCompanionModel = nextModel;
      if (typeof previewAnimator.setModelKey === "function") {
        await previewAnimator.setModelKey(nextModel);
        previewAnimator.setPose(resolvePreviewPose(), false);
        return;
      }
    }

    if (previewAnimator) {
      previewAnimator.destroy();
      previewAnimator = null;
    }

    // Replace canvas element cleanly because a canvas cannot switch 2D <-> WebGL context
    const stage = els.previewCanvas.parentElement;
    const freshCanvas = document.createElement("canvas");
    freshCanvas.id = "preview-canvas";
    freshCanvas.hidden = true;
    stage.replaceChild(freshCanvas, els.previewCanvas);
    els.previewCanvas = freshCanvas;

    previewRenderMode = nextMode;
    previewModelVersion = nextVer;
    previewModelSource = nextSrc;
    previewCompanionModel = nextModel;

    const Ctor = want3D ? WaifuVrmAnimator : WaifuMeshAnimator;
    previewAnimator = new Ctor(els.previewCanvas, {
      height: 94,
      cols: 10,
      rows: 14,
      microMotion: Boolean(settings.microMotion),
      physicsEnabled: settings.bodyPhysics !== false,
      physicsStrength: (settings.physicsStrength ?? 90) / 100,
      chestBounce: (settings.chestBounce ?? 100) / 100,
      depth25D: settings.depth25D !== false,
      modelKey: nextModel,
      modelSource: nextSrc,
      onFallback2D: () => {
        if (!previewWebglFailed) {
          previewWebglFailed = true;
          ensurePreviewAnimator(true);
        }
      }
    });
    const instance = previewAnimator;
    const loaded = await instance.preloadAll();
    if (popupClosed || previewAnimator !== instance) return;
    if (want3D && (previewAnimator.webglFailed || loaded === false)) {
      previewWebglFailed = true;
      await buildPreviewAnimator(true);
      return;
    }
    previewAnimator.setPose(resolvePreviewPose(), false);
    previewAnimator.setPaused(document.hidden || activeTabId !== "companion" || !previewRequested);
    previewAnimator.start();
    els.previewImage.hidden = previewRequested;
    els.previewCanvas.hidden = !previewRequested;
  }

  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        activeHost = new URL(tab.url).hostname.toLowerCase();
      }
    } catch {
      activeHost = "";
    }

    // Read local state directly: controls must not wait for the worker or a 3D model.
    const state = await chrome.storage.local.get(["settings", "timer", "stats", "pendingAlerts"]).catch(() => ({}));
    if (state?.settings) settings = normalizePopupSettings(state.settings);
    if (settings.poseMode && MOTION_IDS.includes(settings.poseMode)) {
      selectedQuoteMotion = settings.poseMode;
    }
    if (state?.timer) timer = { ...DEFAULT_TIMER, ...state.timer };
    if (state?.stats) stats = { ...DEFAULT_STATS, ...state.stats };
    if (state?.pendingAlerts) pendingAlerts = state.pendingAlerts;

    syncPreviewImage();
    els.btnRetry.disabled = !activeHost;
    if (!activeHost) els.siteStatus.textContent = "Companions run on ordinary web pages";

    document.addEventListener("visibilitychange", () => previewAnimator?.setPaused(document.hidden || activeTabId !== "companion" || !previewRequested));
    window.addEventListener("pagehide", () => {
      popupClosed = true;
      if (settingsRenderFrame !== null) cancelAnimationFrame(settingsRenderFrame);
      clearTimeout(saveDebounceTimer);
      if (Object.keys(pendingSettings).length) chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", patch: pendingSettings }).catch(() => {});
      clearInterval(timerTickInterval);
      previewAnimator?.destroy();
    }, { once: true });

    document.addEventListener("mousemove", (e) => {
      if (!previewAnimator || !settings.cursorFollow) return;
      const rect = els.previewCanvas.getBoundingClientRect();
      previewAnimator.setPointerLook(
        (e.clientX - (rect.left + rect.width * 0.5)) / 150,
        (e.clientY - (rect.top + rect.height * 0.35)) / 150
      );
    });

    bindEvents();
    renderSettingsUI();
    renderTimerUI();
    document.documentElement.dataset.dashboardReady = "true";

    timerTickInterval = setInterval(() => {
      if (timer.status === "running" && activeTabId === "timer" && !document.hidden) {
        renderTimerUI();
      }
    }, 1000);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings?.newValue) {
        settings = normalizePopupSettings({ ...changes.settings.newValue, ...inFlightPatch, ...pendingSettings });
        scheduleSettingsRender();
      }
      if (changes.timer?.newValue) {
        timer = { ...DEFAULT_TIMER, ...changes.timer.newValue };
        renderTimerUI();
      }
      if (changes.stats?.newValue) {
        stats = { ...DEFAULT_STATS, ...changes.stats.newValue };
        renderTimerUI();
      }
      if (changes.pendingAlerts) {
        pendingAlerts = changes.pendingAlerts.newValue || {};
        renderAlertsUI();
      }
    });

    window.addEventListener("unload", () => {
      if (timerTickInterval) clearInterval(timerTickInterval);
      if (previewAnimator) previewAnimator.destroy();
    });
  }

  init();
})();

