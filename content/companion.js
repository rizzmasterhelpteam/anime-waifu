(function () {
  "use strict";

  if (window.__waifuCompanionMounted) return;
  window.__waifuCompanionMounted = true;

  const {
    DEFAULT_SETTINGS,
    DEFAULT_TIMER,
    DEFAULT_QUOTES,
    MOTION_IDS,
    DEFAULT_MOTION_QUOTES,
    normalizeMotionQuotes,
    classifyDomain,
    getTimePeriodCategory
  } = window.WAIFU_SHARED;
  const WaifuMeshAnimator = window.WaifuMeshAnimator;
  let WaifuVrmAnimator = window.WaifuVrmAnimator;

  const brain = new window.WAIFU_SHARED.CompanionBrain();
  let lastPageActivity = Date.now();
  let nextStrollAt = performance.now()+45000;
  let behaviorProp = null;
  let behaviorPropTimer = null;
  const HOST_ID = "seraphina-waifu-companion-host";

  let settings = { ...DEFAULT_SETTINGS };
  let timer = { ...DEFAULT_TIMER };
  let hostEl = null;
  let shadow = null;
  let wrapEl = null;
  let canvasEl = null;
  let bubbleEl = null;
  let bubbleTextEl = null;
  let toolbarEl = null;
  let animator = null;
  let activeRenderMode = "3d";
  let activeModelVersion = 1;
  let activeModelSource = "auto";
  let activeCompanionModel = "seraphina";
  let pageWebglDisabled = false;
  let attachmentObserver = null;
  let observedRoot = null;

  const MOTION_CHATTER_INTERVAL_MS = 10000;
  let bubbleTimer = null;
  let temporaryPoseTimer = null;
  let autoBehaviorTimer = null;
  let motionChatterTimer = null;
  let dragWalkStopTimer = null;
  let strollRafId = null;
  let isStrolling = false;
  let isHovered = false;
  let temporaryPose = null;
  let isDragging = false;
  let pointerMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startRight = 24;
  let startBottom = 18;
  let lastMoveX = 0;
  let lastMoveY = 0;
  let smoothDragVy = 0;
  let lastMoveTime = 0;
  let smoothDragVx = 0;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragMode = "move";
  let orbitModeEnabled = false;
  let lastOrbitX = 0;
  let lastOrbitY = 0;
  let orbitBtnEl = null;
  let strollOffsetX = 0;
  let lastQuoteIdx = -1;
  let lastBubbleShownAt = 0;
  const lastMotionQuoteIdx = {};

  // 100% offline smart role signals (zero API / zero keylogging)
  let lastTypeAt = 0;
  let typingIdleCheckTimer = null;
  let hiddenAt = 0;
  let readCelebratedOnPage = false;
  let lastScrollCheckAt = 0;

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isFullscreenActive() {
    return Boolean(getFullscreenElement());
  }

  function isFullscreenBlocked() {
    return isFullscreenActive() && settings.showInFullscreen === false;
  }

  function isUserTypingNow() {
    return settings.smartRoles !== false && lastTypeAt > 0 && (Date.now() - lastTypeAt) < 10000;
  }

  function getCurrentHostname() {
    try {
      return (window.location.hostname || "").toLowerCase();
    } catch {
      return "";
    }
  }

  function isDomainHidden(list) {
    const host = getCurrentHostname();
    if (!host || !Array.isArray(list)) return false;
    return list.some((d) => String(d).toLowerCase() === host);
  }

  function displaySize(requested = settings.sizePx) {
    return Math.max(90, Math.min(Number(requested) || 280, 1000, window.innerHeight - 56, (window.innerWidth - 24) * 600 / 460));
  }

  function resizeCompanion() {
    animator?.resize(displaySize());
    applyPosition();
    alignToolbarInViewport();
  }

  function clampPosition(right, bottom, sizePx, roundResult = true) {
    sizePx = displaySize(sizePx);
    const spriteW = Math.round((sizePx || 175) * (460 / 600));
    const spriteH = sizePx || 175;
    const maxRight = Math.max(8, window.innerWidth - spriteW - 8);
    const maxBottom = Math.max(8, window.innerHeight - spriteH - 8);
    const r = Math.min(Math.max(8, right), maxRight);
    const b = Math.min(Math.max(8, bottom), maxBottom);
    return {
      right: roundResult ? Math.round(r) : r,
      bottom: roundResult ? Math.round(b) : b
    };
  }

  function applyPosition() {
    if (!wrapEl) return;
    const pos = clampPosition(settings.position?.right ?? 24, settings.position?.bottom ?? 18, settings.sizePx);
    wrapEl.style.right = `${pos.right}px`;
    wrapEl.style.bottom = `${pos.bottom}px`;
    if (wrapEl.style.transform) {
      wrapEl.style.transform = "";
    }
    strollOffsetX = 0;
    dragOffsetX = 0;
    dragOffsetY = 0;

    // Flip speech bubble side if near left/top edges
    if (bubbleEl) {
      const nearLeft = pos.right > window.innerWidth * 0.62;
      bubbleEl.classList.toggle("flip-right", nearLeft);
    }
  }

  function resolveEffectivePose() {
    if (temporaryPose) return temporaryPose;
    if (settings.poseMode && settings.poseMode !== "auto") {
      return settings.poseMode;
    }
    if (timer && timer.status === "running") {
      return timer.phase === "break" ? "tea" : "think";
    }
    if (timer && timer.phase === "break" && timer.status !== "idle") {
      return "tea";
    }
    if (settings.smartRoles !== false && lastTypeAt > 0 && (Date.now() - lastTypeAt) < 15000) {
      return "think";
    }
    return "idle";
  }

  function syncPose() {
    if (!animator) return;
    if(timer?.status==='running' || (settings.interactionFrequency==='quiet' && !animator.behavior?.manual)){
      animator.behavior=null;
      if(behaviorProp)behaviorProp.hidden=true;
      if(temporaryPoseTimer)clearTimeout(temporaryPoseTimer);
      temporaryPose=null;
    }
    const pose = resolveEffectivePose();
    animator.setPose(pose, false);
    updateToolbarActiveState(pose);
  }

  function updateToolbarActiveState(activePose) {
    if (!toolbarEl) return;
    const btns = toolbarEl.querySelectorAll("[data-pose]");
    btns.forEach((btn) => {
      const id = btn.getAttribute("data-pose");
      const quiet=settings.interactionFrequency==='quiet';
      const selected=quiet||settings.poseMode==='idle'?'calm':settings.interactionFrequency==='playful'?'playful':'auto';
      const isActive=id===selected;
      btn.classList.toggle("active", isActive);
    });
  }

  function getMotionQuotesList(motionId) {
    const id = MOTION_IDS.includes(motionId) ? motionId : "idle";
    const configured = settings.motionQuotes?.[id];
    if (Array.isArray(configured)) {
      return configured.map((q) => (typeof q === "string" ? q.trim() : "")).filter(Boolean);
    }
    return [...(DEFAULT_MOTION_QUOTES[id] || [])];
  }

  function pickMotionQuote(motionId) {
    const id = MOTION_IDS.includes(motionId) ? motionId : "idle";
    const pool = getMotionQuotesList(id);
    if (pool.length === 0) return null;
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === lastMotionQuoteIdx[id]) {
      idx = (idx + 1) % pool.length;
    }
    lastMotionQuoteIdx[id] = idx;
    return pool[idx];
  }

  function pickQuote(category) {
    if (MOTION_IDS.includes(category)) {
      return pickMotionQuote(category);
    }
    const pool = [...(DEFAULT_QUOTES[category] || DEFAULT_QUOTES.idle)];
    if (pool.length === 0) return "Always here for you~";
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === lastQuoteIdx) {
      idx = (idx + 1) % pool.length;
    }
    lastQuoteIdx = idx;
    return pool[idx];
  }

  function scheduleMotionChatter() {
    if(motionChatterTimer)clearTimeout(motionChatterTimer);
    motionChatterTimer=null;
  }

  function showBubble(text, durationMs = 4500) {
    if (!text || !bubbleEl || !bubbleTextEl || !settings.showBubbles || isFullscreenBlocked()) return;
    promoteTopLayer();
    if (bubbleTimer) clearTimeout(bubbleTimer);
    lastBubbleShownAt = Date.now();
    bubbleTextEl.textContent = text;
    bubbleEl.classList.add("visible");
    bubbleTimer = setTimeout(() => {
      if (bubbleEl) bubbleEl.classList.remove("visible");
    }, durationMs);
    scheduleMotionChatter(MOTION_CHATTER_INTERVAL_MS);
  }

  function triggerTemporaryPose(poseId, durationMs = 3600, quote = null) {
    if (temporaryPoseTimer) clearTimeout(temporaryPoseTimer);
    temporaryPose = poseId;
    if (animator) {
      animator.setPose(poseId, true);
      updateToolbarActiveState(poseId);
    }
    if (quote) {
      showBubble(quote, durationMs);
    }
    temporaryPoseTimer = setTimeout(() => {
      temporaryPose = null;
      syncPose();
    }, durationMs);
  }

  function stopStroll() {
    if (strollRafId !== null) {
      cancelAnimationFrame(strollRafId);
      strollRafId = null;
    }
    if (isStrolling) {
      isStrolling = false;
      settings.position = clampPosition(settings.position?.right ?? 24, settings.position?.bottom ?? 18, settings.sizePx);
      applyPosition();
      if (animator) {
        animator.setWalking(false);
      }
      syncPose();
    }
  }

  // GPU sub-pixel translate3d glide shared by autonomous stroll & notification walks (zero per-frame layout reflow)
  function runSmoothStroll(deltaR, durationMs, options = {}) {
    const startR = settings.position?.right ?? 24;
    const startB = settings.position?.bottom ?? 18;
    const moveDirX = -deltaR;
    const startTs = performance.now();

    applyPosition();
    closeToolbar();
    isStrolling = true;
    animator.setWalking(true, moveDirX, 0);
    if (options.markIdle) {
      updateToolbarActiveState("idle");
    }

    const step = (now) => {
      if (
        !isStrolling ||
        isDragging ||
        document.hidden ||
        (options.respectAutoMode && (isHovered || settings.poseMode !== "auto" || !settings.autoStroll))
      ) {
        stopStroll();
        if (typeof options.onInterrupt === "function") options.onInterrupt();
        return;
      }
      const p = Math.min(1, (now - startTs) / durationMs);
      // A short acceleration ramp leaves a steady walking pace through the middle of the trip.
      const ramp = 0.16;
      let ease, velocity;
      const edge = Math.min(p, 1 - p);
      if (edge < ramp) {
        const distance = (edge * 0.5 - ramp * Math.sin(Math.PI * edge / ramp) / (2 * Math.PI)) / (1 - ramp);
        ease = p < 0.5 ? distance : 1 - distance;
        velocity = (1 - Math.cos(Math.PI * edge / ramp)) * 0.5 / (1 - ramp);
      } else {
        ease = (p - ramp * 0.5) / (1 - ramp);
        velocity = 1 / (1 - ramp);
      }
      const speed = Math.abs(deltaR) * velocity / (durationMs * 0.001);
      animator?.setWalking(true, moveDirX, speed);
      const nextPos = clampPosition(startR + deltaR * ease, startB, settings.sizePx, false);
      strollOffsetX = -(nextPos.right - startR);
      settings.position = nextPos;
      if (wrapEl) {
        wrapEl.style.transform = `translate3d(${strollOffsetX.toFixed(2)}px, 0, 0)`;
      }

      if (p < 1) {
        strollRafId = requestAnimationFrame(step);
      } else {
        strollRafId = null;
        isStrolling = false;
        settings.position = clampPosition(startR + deltaR, startB, settings.sizePx, true);
        applyPosition();
        if (animator) {
          animator.setWalking(false);
        }
        if (typeof options.onComplete === "function") {
          options.onComplete();
        } else {
          syncPose();
        }
      }
    };

    strollRafId = requestAnimationFrame(step);
  }

  function startStroll() {
    if (!animator || !wrapEl || isDragging || isHovered || document.hidden) return;
    if (settings.poseMode !== "auto" || !settings.autoStroll || !settings.microMotion) return;
    if (timer && timer.status === "running") return;

    stopStroll();

    const startR = settings.position?.right ?? 24;
    const startB = settings.position?.bottom ?? 18;
    const delta = (Math.random() < 0.5 ? -1 : 1) * (displaySize() * (0.45 + Math.random() * 0.45));
    const target = clampPosition(startR + delta, startB, settings.sizePx);
    const actualDeltaR = target.right - startR;
    if (Math.abs(actualDeltaR) < 25) return;

    const durationMs = Math.max(900, Math.abs(actualDeltaR) / (displaySize() * 0.42) * 1000);
    runSmoothStroll(actualDeltaR, durationMs, { markIdle: true, respectAutoMode: true });
  }

  function getDesiredMountRoot() {
    const fsEl = getFullscreenElement();
    if (fsEl && settings.showInFullscreen !== false && fsEl.tagName !== "VIDEO" && fsEl.tagName !== "IFRAME") {
      return fsEl;
    }
    return document.documentElement || document.body;
  }

  function promoteTopLayer() {
    if (!hostEl || !hostEl.isConnected || isFullscreenBlocked()) return;
    if (typeof hostEl.showPopover === "function") {
      try {
        if (!hostEl.matches || !hostEl.matches(":popover-open")) {
          hostEl.showPopover();
        }
      } catch {
        hostEl.removeAttribute("popover");
      }
    } else {
      hostEl.removeAttribute("popover");
    }
  }

  function ensureAttached() {
    if (!hostEl) return;
    const targetRoot = getDesiredMountRoot();
    if (targetRoot && (!hostEl.isConnected || hostEl.parentNode !== targetRoot)) {
      targetRoot.appendChild(hostEl);
      promoteTopLayer();
    }
    if (attachmentObserver && observedRoot !== targetRoot) {
      attachmentObserver.disconnect();
      attachmentObserver.observe(document, { childList: true });
      if (document.documentElement) attachmentObserver.observe(document.documentElement, { childList: true });
      if (targetRoot && targetRoot !== document.documentElement) attachmentObserver.observe(targetRoot, { childList: true });
      observedRoot = targetRoot;
    }
  }

  function syncFullscreenState() {
    if (!hostEl) return;
    ensureAttached();
    const blocked = isFullscreenBlocked();
    hostEl.style.display = blocked ? "none" : "";
    if (blocked) {
      stopStroll();
      if (bubbleEl) bubbleEl.classList.remove("visible");
      if (typeof hostEl.hidePopover === "function") {
        try {
          if (!hostEl.matches || hostEl.matches(":popover-open")) {
            hostEl.hidePopover();
          }
        } catch {
          // Ignore
        }
      }
      if (animator) animator.setPaused(true);
    } else {
      promoteTopLayer();
      applyPosition();
      if (animator) animator.setPaused(document.hidden);
    }
  }

  function walkAndPerform(poseId, durationMs, quote) {
    if (!animator || !wrapEl || isDragging || isHovered || document.hidden || isFullscreenActive() || !settings.autoStroll || !settings.microMotion) {
      triggerTemporaryPose(poseId, durationMs, quote);
      return;
    }

    stopStroll();
    const startR = settings.position?.right ?? 24;
    const startB = settings.position?.bottom ?? 18;
    const towardCenter = startR < window.innerWidth * 0.4 ? 54 : -54;
    const target = clampPosition(startR + towardCenter, startB, settings.sizePx);
    const deltaR = target.right - startR;

    if (Math.abs(deltaR) < 18) {
      triggerTemporaryPose(poseId, durationMs, quote);
      return;
    }

    const triggerFn = () => triggerTemporaryPose(poseId, durationMs, quote);
    runSmoothStroll(deltaR, 950, {
      onInterrupt: triggerFn,
      onComplete: triggerFn
    });
  }

  function scheduleAutoBehavior(immediateSoon = false) {
    if (autoBehaviorTimer) {
      clearTimeout(autoBehaviorTimer);
      autoBehaviorTimer = null;
    }
    if (!hostEl || settings.poseMode !== "auto") return;

    autoBehaviorTimer = setTimeout(() => {
      autoBehaviorTimer=null;
      if(!hostEl) return;
      const paused=document.hidden || !document.hasFocus() || Date.now()-lastPageActivity>300000 || isDragging || isStrolling || temporaryPose || isFullscreenBlocked() || timer?.status==='running' || !settings.microMotion;
      const action=brain.tick(performance.now(),paused,settings.interactionFrequency);
      if(action) performBehavior(action);
      else if(!paused && settings.interactionFrequency!=='quiet' && settings.autoStroll && brain.stage!==3 && !isUserTypingNow() && performance.now()>nextStrollAt){
        nextStrollAt=performance.now()+60000+Math.random()*30000;
        startStroll();
      }
      scheduleAutoBehavior();
    }, 2000);
  }

  const personalityLines={
    seraphina:{garden:["A little patience, a little sunshine. Rather like you.","I'm tending my little garden. You keep doing your thing."],dance:["A little intermission. You may admire quietly.","Careful, I might catch you watching."],pout:["Oh, now I'm part of the scenery? How charming."],rest:["I'll enjoy a little quiet time."],sidestep:["Oh, now you noticed?"],showPlant:["Look what I've been growing."],greet:["There you are. I was perfectly entertained, of course.","You have my attention. Use it wisely."]},
    gothic_red:{garden:["This little plant is getting the royal treatment!","Grow, little one! I'll supervise."],dance:["Hey! You're missing my best moves!","Look at me! I practiced this one!"],pout:["Hmph. I'm being dramatically unbothered."],rest:["Fine, little break. I'll entertain myself."],sidestep:["Hmph! Give me a second…"],showPlant:["Look! My plant! Isn't it doing great?"],greet:["There you are! What shall we do?","Aha! You noticed me!"]}
  };
  function performBehavior(id, manual=false) {
    if(!animator || document.hidden || (!manual && timer?.status==='running')) return;
    if(manual){animator.setMicroMotion(true);animator.setPaused(false);}

    const crimson=settings.activeModel==='gothic_red';
    const duration={garden:20000,dance:11000,pout:8500,rest:16000,sidestep:6000,showPlant:6500,greet:3200,relax:6500}[id]||6000;
    const pose=id==='greet'?'wave':id==='dance'?'celebrate':id==='rest'?'tea':id==='pout'?'think':'idle';
    const lines=personalityLines[crimson?'gothic_red':'seraphina'][id];
    triggerTemporaryPose(pose,duration,lines && (manual || !isUserTypingNow())?lines[Math.floor(Math.random()*lines.length)]:null);
    animator.behavior={id,start:performance.now(),until:performance.now()+duration,crimson,manual};
    if(behaviorPropTimer)clearTimeout(behaviorPropTimer);
    if(behaviorProp){
      behaviorProp.hidden=!(id==='garden'||id==='showPlant');
      behaviorProp.animate?.([{transform:'translateY(3px) rotate(-2deg)'},{transform:'translateY(0) rotate(2deg)'}],{duration:1800,iterations:Math.ceil(duration/1800),direction:'alternate',easing:'ease-in-out'});
    }
    behaviorPropTimer=setTimeout(()=>{
      if(behaviorProp)behaviorProp.hidden=true;
      if(id==='pout' && brain.stage===3){brain.stage=4;brain.elapsed=0;brain.next=240000+Math.random()*120000;}
    },duration);
    if(id==='sidestep' && settings.autoStroll && settings.microMotion){
      const right=settings.position?.right??24;
      const candidate=clampPosition(right+65,settings.position?.bottom??18,settings.sizePx,false);
      runSmoothStroll(Math.abs(candidate.right-right)>20?candidate.right-right:-55,850,{onComplete:()=>{if(animator)animator.setPose('idle',false);}});
    }
  }

  let toolbarOpenTimer = null;
  function openToolbar(durationMs = 6000) {
    if (!wrapEl) return;
    wrapEl.classList.add("toolbar-open");
    alignToolbarInViewport();
    if (toolbarOpenTimer) clearTimeout(toolbarOpenTimer);
    toolbarOpenTimer = setTimeout(() => {
      toolbarOpenTimer = null;
      if (wrapEl && !isHovered) {
        wrapEl.classList.remove("toolbar-open");
      }
    }, durationMs);
  }

  function closeToolbar() {
    if (toolbarOpenTimer) {
      clearTimeout(toolbarOpenTimer);
      toolbarOpenTimer = null;
    }
    if (wrapEl) wrapEl.classList.remove("toolbar-open");
  }

  function createShadowUI() {
    if (!document.documentElement) { document.addEventListener("DOMContentLoaded", syncMountState, { once: true }); return; }
    const orphan = document.getElementById(HOST_ID);
    if (orphan && orphan !== hostEl) orphan.remove();
    if (hostEl) return;

    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.dataset.state = "loading";
    if (typeof hostEl.setAttribute === "function") {
      hostEl.setAttribute("popover", "manual");
    }
    hostEl.style.cssText = "all: initial; position: fixed; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: transparent; pointer-events: none; overflow: visible; z-index: 2147483647;";
    for (const key of ["all", "position", "inset", "width", "height", "margin", "padding", "border", "background", "pointer-events", "overflow", "z-index"]) {
      hostEl.style.setProperty(key, hostEl.style.getPropertyValue(key), "important");
    }

    shadow = hostEl.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }
      .waifu-wrap {
        position: fixed;
        right: 24px;
        bottom: 18px;
        display: flex;
        flex-direction: column;
        align-items: center;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        will-change: transform;
        transition: opacity 0.25s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .waifu-wrap.dragging {
        cursor: grabbing !important;
      }
      .waifu-canvas {
        display: block;
        cursor: grab;
        will-change: transform;
        filter: drop-shadow(0 8px 16px rgba(10, 8, 24, 0.35));
      }
      .waifu-wrap.dragging .waifu-canvas {
        cursor: grabbing;
      }
      .waifu-toolbar {
        position: absolute;
        bottom: calc(100% + 10px);
        top: auto;
        left: 50%;
        transform: translateX(calc(-50% + var(--tb-shift-x, 0px))) translateY(6px);
        display: inline-flex;
        flex-wrap: nowrap;
        white-space: nowrap;
        justify-content: center;
        align-items: center;
        max-width: calc(100vw - 24px);
        gap: 2px 3px;
        padding: 4px 6px;
        border-radius: 999px;
        background: rgba(18, 16, 36, 0.96);
        border: 1px solid rgba(201, 164, 92, 0.65);
        box-shadow: 0 8px 24px rgba(8, 6, 20, 0.55);
        backdrop-filter: blur(10px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.18s ease, transform 0.18s ease;
        z-index: 100;
        touch-action: manipulation;
      }
      .waifu-toolbar::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 100%;
        height: 16px;
      }
      .waifu-wrap.toolbar-below .waifu-toolbar {
        bottom: auto;
        top: calc(100% + 10px);
        transform: translateX(calc(-50% + var(--tb-shift-x, 0px))) translateY(-6px);
      }
      .waifu-wrap.toolbar-below .waifu-toolbar::after {
        top: auto;
        bottom: 100%;
        height: 16px;
      }
      .waifu-view-controls {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .waifu-wrap:hover .waifu-toolbar,
      .waifu-wrap.toolbar-open .waifu-toolbar,
      .waifu-toolbar:hover,
      .waifu-toolbar:focus-within {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(calc(-50% + var(--tb-shift-x, 0px))) translateY(0);
      }
      .waifu-wrap.dragging .waifu-toolbar {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .waifu-btn {
        appearance: none;
        border: none;
        background: transparent;
        color: #E7E2F7;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        padding: 5px 7px;
        min-height: 24px;
        min-width: 24px;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }
      .waifu-btn:hover {
        background: rgba(168, 139, 250, 0.25);
        color: #FFFFFF;
      }
      .waifu-btn.active {
        background: linear-gradient(135deg, #6E46D9, #9B4D76);
        color: #FFFFFF;
      }
      .waifu-btn.close-btn {
        color: #D9A7B0;
        padding: 6px 8px;
      }
      .waifu-toolbar-sep {
        width: 1px;
        height: 14px;
        background: rgba(201, 164, 92, 0.40);
        margin: 0 2px;
      }
      .waifu-btn.view-ctrl {
        padding: 6px 7px;
      }
      .waifu-btn.close-btn:hover {
        background: rgba(220, 68, 92, 0.28);
        color: #FFD6DD;
      }
      .waifu-bubble {
        position: absolute;
        bottom: calc(100% + 10px);
        right: 8px;
        max-width: 220px;
        min-width: 120px;
        padding: 9px 12px;
        border-radius: 14px 14px 4px 14px;
        background: rgba(20, 19, 42, 0.94);
        border: 1px solid rgba(201, 164, 92, 0.65);
        color: #F4F0FF;
        font-size: 12px;
        line-height: 1.4;
        box-shadow: 0 10px 24px rgba(10, 8, 28, 0.42);
        pointer-events: none;
        opacity: 0;
        transform: translateY(8px) scale(0.96);
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 2;
      }
      .waifu-wrap:hover .waifu-bubble.visible,
      .waifu-wrap.toolbar-open .waifu-bubble.visible {
        bottom: calc(100% + var(--tb-bubble-offset, 52px));
      }
      .waifu-wrap.toolbar-below:hover .waifu-bubble.visible,
      .waifu-wrap.toolbar-below.toolbar-open .waifu-bubble.visible {
        bottom: calc(100% + 12px);
      }
      .waifu-bubble.flip-right {
        right: auto;
        left: 8px;
        border-radius: 14px 14px 14px 4px;
      }
      .waifu-bubble.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .waifu-bubble-name {
        display: block;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #DFC07C;
        margin-bottom: 2px;
      }
    `;

    wrapEl = document.createElement("div");
    wrapEl.className = "waifu-wrap";

    bubbleEl = document.createElement("div");
    bubbleEl.className = "waifu-bubble";
    const nameEl = document.createElement("span");
    nameEl.className = "waifu-bubble-name";
    nameEl.textContent = settings.name || "Seraphina";
    bubbleTextEl = document.createElement("span");
    bubbleEl.append(nameEl, bubbleTextEl);

    toolbarEl = document.createElement("div");
    toolbarEl.className = "waifu-toolbar";
    toolbarEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      openToolbar(8000);
    });
    toolbarEl.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      openToolbar(8000);
    }, { passive: true });

    const quickPoses = [{id:'auto',label:'Auto'},{id:'calm',label:'Calm'},{id:'playful',label:'Playful'},{id:'dance',label:'Dance'},{id:'walk',label:'Walk'}];
    for (const p of quickPoses) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "waifu-btn";
      b.setAttribute("data-pose", p.id);
      b.textContent = p.label;
      b.title = p.id === "auto" ? "Enable autonomous behaviors" : `Switch to ${p.label}`;
      b.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      b.addEventListener("touchstart", (e) => {
        e.stopPropagation();
      }, { passive: true });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openToolbar(750);
        stopStroll();
        if(['interact','dance','garden','walk'].includes(p.id)){requestBehavior(p.id);return;}
        requestBehavior(p.id);
        chrome.storage.local.set({settings});
      });
      toolbarEl.appendChild(b);
    }

    const viewControlsEl = document.createElement("span");
    viewControlsEl.style.cssText = "display:inline-flex;align-items:center;gap:2px;";

    const sepEl = document.createElement("span");
    sepEl.className = "waifu-toolbar-sep";

    orbitBtnEl = document.createElement("button");
    orbitBtnEl.type = "button";
    orbitBtnEl.className = "waifu-btn view-ctrl";
    orbitBtnEl.textContent = "360°";
    orbitBtnEl.title = "Toggle 360° orbit drag (or right-click / Shift+drag anytime)";
    orbitBtnEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    orbitBtnEl.addEventListener("touchstart", (e) => { e.stopPropagation(); }, { passive: true });
    orbitBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openToolbar(8000);
      orbitModeEnabled = !orbitModeEnabled;
      orbitBtnEl.classList.toggle("active", orbitModeEnabled);
      if (canvasEl) {
        canvasEl.style.cursor = orbitModeEnabled ? "ew-resize" : "grab";
        canvasEl.title = orbitModeEnabled
          ? `${settings.name || "Seraphina"} — 360° Orbit ON (drag to rotate, click to interact)`
          : `${settings.name || "Seraphina"} — Click to interact or drag to move`;
      }
    });

    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.type = "button";
    zoomOutBtn.className = "waifu-btn view-ctrl";
    zoomOutBtn.textContent = "−";
    zoomOutBtn.title = "Zoom out (3D camera)";
    zoomOutBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    zoomOutBtn.addEventListener("touchstart", (e) => { e.stopPropagation(); }, { passive: true });
    zoomOutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openToolbar(8000);
      animator?.adjustZoom?.(0.82);
    });

    const zoomInBtn = document.createElement("button");
    zoomInBtn.type = "button";
    zoomInBtn.className = "waifu-btn view-ctrl";
    zoomInBtn.textContent = "+";
    zoomInBtn.title = "Zoom in (or scroll wheel over Seraphina)";
    zoomInBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    zoomInBtn.addEventListener("touchstart", (e) => { e.stopPropagation(); }, { passive: true });
    zoomInBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openToolbar(8000);
      animator?.adjustZoom?.(1.22, 0.28);
    });

    const resetViewBtn = document.createElement("button");
    resetViewBtn.type = "button";
    resetViewBtn.className = "waifu-btn view-ctrl";
    resetViewBtn.textContent = "⟲";
    resetViewBtn.title = "Reset 360° angle & zoom";
    resetViewBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    resetViewBtn.addEventListener("touchstart", (e) => { e.stopPropagation(); }, { passive: true });
    resetViewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openToolbar(8000);
      animator?.resetView?.();
    });

    viewControlsEl.append(sepEl, orbitBtnEl, zoomOutBtn, zoomInBtn, resetViewBtn);
    toolbarEl.appendChild(viewControlsEl);

    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.className = "waifu-btn close-btn";
    hideBtn.textContent = "✕";
    hideBtn.title = "Hide on this website";
    hideBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    hideBtn.addEventListener("touchstart", (e) => { e.stopPropagation(); }, { passive: true });
    hideBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const host = getCurrentHostname();
      if (host) {
        const list = Array.isArray(settings.hiddenDomains) ? [...settings.hiddenDomains] : [];
        if (!list.includes(host)) list.push(host);
        settings.hiddenDomains = list;
        chrome.storage.local.set({ settings });
      }
      unmountUI();
    });
    toolbarEl.appendChild(hideBtn);

    canvasEl = document.createElement("canvas");
    canvasEl.className = "waifu-canvas";
    canvasEl.title = `${settings.name || "Seraphina"} — Click to interact or drag to move`;

    behaviorProp=document.createElement('div');
    behaviorProp.hidden=true;
    behaviorProp.setAttribute('aria-hidden','true');
    behaviorProp.style.cssText='position:absolute;bottom:3%;left:3%;width:22%;pointer-events:none;filter:drop-shadow(0 3px 3px #0003)';
    behaviorProp.innerHTML='<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg"><path d="M50 84V30" stroke="#437b49" stroke-width="6"/><path d="M50 61Q10 62 19 33Q45 30 50 61M50 47Q82 49 84 18Q57 17 50 47" fill="#71ad65" stroke="#437b49" stroke-width="3"/><path d="M20 81H80L72 121H28Z" fill="#b76c52" stroke="#744839" stroke-width="3"/><rect x="16" y="76" width="68" height="13" rx="4" fill="#d48768"/><path d="M6 15l3 7m4-15 2 7M89 60l3 8" stroke="#7bbfe3" stroke-width="4" stroke-linecap="round"/></svg>';
    wrapEl.append(bubbleEl, toolbarEl, canvasEl,behaviorProp);
    const loadingImage = document.createElement("img");
    loadingImage.alt = "";
    loadingImage.src = chrome.runtime.getURL(`assets/previews/${settings.activeModel === "gothic_red" ? "crimson" : "seraphina"}-dashboard.png`);
    loadingImage.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none";
    wrapEl.append(loadingImage);
    shadow.append(style, wrapEl);
    const mountRoot = getDesiredMountRoot() || document.documentElement || document.body;
    mountRoot.appendChild(hostEl);

    const want3D =
      (settings.renderMode || "2d") === "3d" &&
      typeof WaifuVrmAnimator === "function" &&
      !pageWebglDisabled;
    activeRenderMode = want3D ? "3d" : "2d";
    hostEl.dataset.mode = activeRenderMode;
    activeModelVersion = Number(settings.modelVersion) || 1;
    activeModelSource = settings.modelSource || "auto";
    activeCompanionModel = settings.activeModel || "seraphina";
    if (viewControlsEl) {
      viewControlsEl.style.display = want3D ? "inline-flex" : "none";
    }
    if (want3D) {
      canvasEl.title = `${settings.name || "Seraphina"} — Click to interact • Scroll to zoom • Right-drag or 360° to rotate`;
    }

    const AnimatorCtor = want3D ? WaifuVrmAnimator : WaifuMeshAnimator;
    animator = new AnimatorCtor(canvasEl, {
      height: displaySize(),
      microMotion: settings.microMotion,
      physicsEnabled: settings.bodyPhysics !== false,
      physicsStrength: (settings.physicsStrength ?? 90) / 100,
      chestBounce: (settings.chestBounce ?? 100) / 100,
      depth25D: settings.depth25D !== false,
      modelKey: settings.activeModel || "seraphina",
      modelSource: settings.modelSource || "auto",
      onFallback2D: () => {
        if (activeRenderMode === "3d" && !pageWebglDisabled) {
          pageWebglDisabled = true;
          unmountUI();
          createShadowUI();
        }
      }
    });

    const instance = animator;
    const mountedHost = hostEl;
    attachmentObserver = new MutationObserver(() => {
      if (hostEl && (!hostEl.isConnected || observedRoot !== getDesiredMountRoot())) ensureAttached();
    });
    ensureAttached();
    bindInteractions();
    applyVisualSettings();
    syncFullscreenState();
    animator.preloadAll().then((ok) => {
      if (animator !== instance || hostEl !== mountedHost) return;
      if (want3D && (animator.webglFailed || ok === false)) {
        pageWebglDisabled = true;
        unmountUI();
        createShadowUI();
        return;
      }
      if (settings.greetOnLoad && settings.poseMode === "auto" && !isFullscreenBlocked() && (!timer || timer.status !== "running")) {
        const greetCat = settings.smartRoles !== false && Math.random() < 0.65
          ? getTimePeriodCategory()
          : "greeting";
        triggerTemporaryPose("wave", 3200, pickQuote(greetCat));
      } else {
        syncPose();
      }
      animator.setPaused(document.hidden || isFullscreenBlocked());
      loadingImage.remove();
      hostEl.dataset.state = "ready";
      animator.start();
      scheduleAutoBehavior(true);
      scheduleMotionChatter(MOTION_CHATTER_INTERVAL_MS);
    }).catch(() => {
      if (want3D && !pageWebglDisabled && hostEl === mountedHost && animator === instance) {
        pageWebglDisabled = true;
        unmountUI();
        createShadowUI();
      }
    });
  }

  function bindInteractions() {
    canvasEl.addEventListener("contextmenu", (e) => {
      if (activeRenderMode === "3d") e.preventDefault();
    });

    canvasEl.addEventListener("wheel", (e) => {
      if (activeRenderMode !== "3d" || !animator || typeof animator.adjustZoom !== "function") return;
      e.preventDefault();
      e.stopPropagation();
      const rect = canvasEl.getBoundingClientRect();
      const normY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
      if (e.shiftKey) {
        animator.adjustPanY(e.deltaY > 0 ? -0.05 : 0.05);
      } else {
        const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
        animator.adjustZoom(factor, normY);
      }
    }, { passive: false });

    canvasEl.addEventListener("pointerdown", (e) => {
      const canOrbit = activeRenderMode === "3d" && typeof animator?.adjustOrbit === "function";
      const wantOrbit = canOrbit && (e.button === 2 || (e.button === 0 && (e.shiftKey || orbitModeEnabled)));
      if (!wantOrbit && e.button !== 0) return;

      stopStroll();
      closeToolbar();
      isDragging = true;
      wrapEl?.classList.add("dragging");
      pointerMoved = false;
      dragMode = wantOrbit ? "orbit" : "move";
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      lastMoveX = e.clientX;
      lastMoveY = e.clientY;
      lastOrbitX = e.clientX;
      lastOrbitY = e.clientY;
      lastMoveTime = performance.now();
      smoothDragVx = 0;
      smoothDragVy = 0;
      startRight = settings.position?.right ?? 24;
      startBottom = settings.position?.bottom ?? 18;
      dragOffsetX = 0;
      dragOffsetY = 0;
      try {
        canvasEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture unavailable
      }
    });

    canvasEl.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!pointerMoved && Math.hypot(dx, dy) >= 8) {
        pointerMoved = true;
        wrapEl.classList.add("dragging");
      }
      if (!pointerMoved) return;

      if (dragMode === "orbit") {
        const stepX = e.clientX - lastOrbitX;
        const stepY = e.clientY - lastOrbitY;
        lastOrbitX = e.clientX;
        lastOrbitY = e.clientY;
        animator?.adjustOrbit?.(stepX * 0.013, stepY * 0.008);
        return;
      }

      const now = performance.now();
      const dtScale = 16.67 / Math.max(4, now - lastMoveTime);
      const vx = (e.clientX - lastMoveX) * dtScale;
      const vy = (e.clientY - lastMoveY) * dtScale;
      lastMoveY = e.clientY;
      lastMoveX = e.clientX;
      lastMoveTime = now;
      smoothDragVx = smoothDragVx * 0.65 + vx * 0.35;
      smoothDragVy = smoothDragVy * 0.65 + vy * 0.35;
      animator.setDragVelocity(smoothDragVx, smoothDragVy);
      animator.setWalking(Math.abs(smoothDragVx) > 0.4, smoothDragVx, Math.min(Math.abs(smoothDragVx) * 60, displaySize() * 1.2));
      if (dragWalkStopTimer) clearTimeout(dragWalkStopTimer);
      dragWalkStopTimer = setTimeout(() => {
        if (animator && isDragging) {
          animator.setWalking(false);
        }
      }, 160);
      const clamped = clampPosition(startRight - dx, startBottom - dy, settings.sizePx, false);
      settings.position = clamped;
      dragOffsetX = -(clamped.right - startRight);
      dragOffsetY = -(clamped.bottom - startBottom);
      if (wrapEl) {
        wrapEl.style.transform = `translate3d(${dragOffsetX.toFixed(2)}px, ${dragOffsetY.toFixed(2)}px, 0)`;
      }
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      wrapEl.classList.remove("dragging");
      if (dragWalkStopTimer) {
        clearTimeout(dragWalkStopTimer);
        dragWalkStopTimer = null;
      }
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      const totalMoved = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
      const wasDrag = pointerMoved || totalMoved >= 8;
      if (wasDrag) {
        brain.elapsed=0;brain.stage=0;brain.lastTouch=performance.now();
        if (dragMode === "move") {
          settings.position = clampPosition(settings.position?.right ?? startRight, settings.position?.bottom ?? startBottom, settings.sizePx, true);
          applyPosition();
          if (animator) {
            animator.setWalking(false);
          }
          syncPose();
          chrome.storage.local.set({ settings });
        }
      } else if (e.button === 0) {
        if (activeRenderMode === "3d") animator?.triggerBounce?.();
        handleTapInteraction();
        if (wrapEl?.classList.contains("toolbar-open")) {
          closeToolbar();
        } else {
          openToolbar(5000);
        }
      } else if (e.button === 2 && activeRenderMode === "3d") {
        animator?.triggerBounce?.();
      }
    };

    canvasEl.addEventListener("pointerup", endDrag);
    canvasEl.addEventListener("pointercancel", endDrag);

    document.addEventListener("pointerdown", handleOutsidePointer, { passive: true });

    wrapEl.addEventListener("mouseenter", () => {
      isHovered = true;
      stopStroll();
      alignToolbarInViewport();
      if (animator) animator.setHover(true);
    });
    wrapEl.addEventListener("mouseleave", () => {
      isHovered = false;
      if (animator) {
        animator.setHover(false);
      }
    });

    window.addEventListener("mousemove", handleCursorLook, { passive: true });
    document.addEventListener("mouseleave", handleViewportMouseLeave, { passive: true });
    window.addEventListener("resize", resizeCompanion, { passive: true });
    window.addEventListener("scroll", handleScrollReadFinish, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility, { passive: true });
    document.addEventListener("keydown", handleKeyActivity, { passive: true });
    document.addEventListener("fullscreenchange", handleFullscreenChange, { passive: true });
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange, { passive: true });
  }

  function handleOutsidePointer(e) {
    if (hostEl && !hostEl.contains(e.target)) closeToolbar();
  }

  function handleKeyActivity() {
    lastPageActivity=Date.now();
    if (settings.smartRoles === false || !hostEl) return;
    lastTypeAt = Date.now();
    if (isStrolling) stopStroll();

    if (settings.poseMode === "auto" && !temporaryPose && (!timer || timer.status !== "running")) {
      syncPose();
    }
    if (typingIdleCheckTimer) clearTimeout(typingIdleCheckTimer);
    typingIdleCheckTimer = setTimeout(() => {
      typingIdleCheckTimer = null;
      if (hostEl && settings.poseMode === "auto" && !temporaryPose) {
        syncPose();
      }
    }, 15500);
  }

  function handleFullscreenChange() {
    syncFullscreenState();
  }

  function handleScrollReadFinish() {
    if (readCelebratedOnPage || settings.smartRoles === false || settings.poseMode !== "auto") return;
    if (!hostEl || document.hidden || isFullscreenActive() || isUserTypingNow() || temporaryPose) return;
    if (timer && timer.status === "running") return;

    const now = Date.now();
    if (now - lastScrollCheckAt < 500) return;
    lastScrollCheckAt = now;

    const docEl = document.documentElement;
    const scrollHeight = docEl ? docEl.scrollHeight : 0;
    const viewH = window.innerHeight || 720;
    if (scrollHeight < viewH * 2.4) return;

    const scrolledBottom = (window.scrollY || docEl.scrollTop || 0) + viewH;
    if (scrolledBottom / scrollHeight >= 0.94) {
      readCelebratedOnPage = true;
      triggerTemporaryPose("celebrate", 2800, pickQuote("readFinish"));
    }
  }

  function handleViewportMouseLeave() {
    if (animator) {
      animator.setPointerLook(0, 0, 0, 0);
    }
  }

  function handleCursorLook(e) {
    lastPageActivity=Date.now();
    if(performance.now()<brain.ignoreUntil)return;
    if (!animator || !settings.cursorFollow || !wrapEl || document.hidden) return;
    const sizeH = displaySize();
    const sizeW = Math.round(sizeH * (460 / 600));
    const rightPx = settings.position?.right ?? 24;
    const bottomPx = settings.position?.bottom ?? 18;
    const cx = window.innerWidth - rightPx - sizeW * 0.5;
    const cy = window.innerHeight - bottomPx - sizeH * 0.72;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      animator.setPointerLook(0, 0, 0, 0);
      return;
    }
    const maxSpan = Math.max(460, Math.hypot(window.innerWidth || 1280, window.innerHeight || 720) * 0.56);
    const normDist = Math.min(1, dist / maxSpan);
    const ux = dx / dist;
    const uy = dy / dist;
    // Near cursor = gentler movement; far cursor = higher eyeball sensitivity while body stays slight
    const eyeGain = Math.pow(normDist, 1.55);
    const bodyGain = Math.pow(normDist, 1.25) * 0.7;
    animator.setPointerLook(ux * bodyGain, uy * bodyGain, ux * eyeGain, uy * eyeGain);
  }

  function handleVisibility() {
    brain.last=performance.now();
    lastPageActivity=Date.now();
    if (document.hidden) {
      hiddenAt = Date.now();
      stopStroll();
    } else if (hiddenAt > 0) {
      const awayMs = Date.now() - hiddenAt;
      hiddenAt = 0;
      if (
        settings.smartRoles !== false &&
        awayMs >= 10 * 60 * 1000 &&
        hostEl &&
        !isFullscreenBlocked() &&
        (!timer || timer.status !== "running")
      ) {
        triggerTemporaryPose("wave", 3000, pickQuote("returnTab"));
      }
    }
    if (animator) {
      animator.setPaused(document.hidden || isFullscreenBlocked());
    }
  }

  function handleTapInteraction() {
    if (!animator) return;
    handleClickReaction();
  }

  function handleClickReaction() {
    if (!animator) return;
    if (timer && timer.status === "running") {
      const mins = Math.max(1, Math.ceil((timer.targetEndMs ? Math.max(0, timer.targetEndMs - Date.now()) : timer.remainingSeconds * 1000) / 60000));
      const label = timer.phase === "focus" ? "focus" : "break";
      animator.triggerBounce();
      showBubble(`${mins} min left on your ${label} session~`, 3200);
      return;
    }

    const reaction=brain.touch(performance.now(),settings.activeModel==='gothic_red');
    if(reaction){
      performBehavior(reaction,true);
    }
    return;
  }

  function applyVisualSettings() {
    if (!wrapEl || !animator) return;
    wrapEl.style.opacity = String(Math.min(1, Math.max(0.35, Number(settings.opacity) || 1)));
    animator.resize(displaySize());
    animator.setMicroMotion(settings.microMotion);
    animator.setPhysicsOptions?.(settings.bodyPhysics !== false, (settings.physicsStrength ?? 90) / 100, (settings.chestBounce ?? 100) / 100);
    animator.setDepth25D(settings.depth25D !== false);
    if (bubbleEl) {
      const nEl = bubbleEl.querySelector(".waifu-bubble-name");
      if (nEl) nEl.textContent = settings.name || "Seraphina";
    }
    if (canvasEl) {
      canvasEl.title = orbitModeEnabled
        ? `${settings.name || "Seraphina"} — 360° Orbit ON (drag to rotate, click to interact)`
        : `${settings.name || "Seraphina"} — Click to interact or drag to move`;
    }
    applyPosition();
    alignToolbarInViewport();
  }

  function alignToolbarInViewport() {
    if (!wrapEl || !toolbarEl) return;
    const rect = wrapEl.getBoundingClientRect();
    const tbW = toolbarEl.offsetWidth || 300;
    const tbH = toolbarEl.offsetHeight || 34;
    const centerX = rect.left + rect.width * 0.5;
    let shiftX = 0;
    if (centerX + tbW * 0.5 > window.innerWidth - 8) {
      shiftX = (window.innerWidth - 8) - (centerX + tbW * 0.5);
    } else if (centerX - tbW * 0.5 < 8) {
      shiftX = 8 - (centerX - tbW * 0.5);
    }
    toolbarEl.style.setProperty("--tb-shift-x", `${shiftX.toFixed(1)}px`);

    // If near top of viewport, flip toolbar below companion so it never clips or overlaps her head
    const isNearTop = rect.top < tbH + 18;
    wrapEl.classList.toggle("toolbar-below", isNearTop);
    wrapEl.style.setProperty("--tb-bubble-offset", `${tbH + 16}px`);
  }

  function unmountUI() {
    clearTimeout(behaviorPropTimer); behaviorProp=null;
    brain.last=0;
    clearTimeout(bubbleTimer);
    clearTimeout(temporaryPoseTimer);
    bubbleTimer = null;
    temporaryPoseTimer = null;
    temporaryPose = null;
    isDragging = false;
    isHovered = false;
    attachmentObserver?.disconnect();
    attachmentObserver = null;
    observedRoot = null;
    closeToolbar();
    stopStroll();
    orbitModeEnabled = false;
    orbitBtnEl = null;
    if (wrapEl) wrapEl.classList.remove("dragging");
    if (autoBehaviorTimer) {
      clearTimeout(autoBehaviorTimer);
      autoBehaviorTimer = null;
    }
    if (motionChatterTimer) {
      clearTimeout(motionChatterTimer);
      motionChatterTimer = null;
    }
    if (dragWalkStopTimer) {
      clearTimeout(dragWalkStopTimer);
      dragWalkStopTimer = null;
    }
    if (typingIdleCheckTimer) {
      clearTimeout(typingIdleCheckTimer);
      typingIdleCheckTimer = null;
    }
    document.removeEventListener("pointerdown", handleOutsidePointer);
    window.removeEventListener("mousemove", handleCursorLook);
    document.removeEventListener("mouseleave", handleViewportMouseLeave);
    window.removeEventListener("resize", resizeCompanion);
    window.removeEventListener("scroll", handleScrollReadFinish);
    document.removeEventListener("visibilitychange", handleVisibility);
    document.removeEventListener("keydown", handleKeyActivity);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    if (animator) {
      animator.destroy();
      animator = null;
    }
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadow = null;
    wrapEl = null;
    canvasEl = null;
    bubbleEl = null;
    toolbarEl = null;
  }

  function syncMountState() {
    const shouldShow = settings.enabled !== false && !isDomainHidden(settings.hiddenDomains);
    const wantMode =
      (settings.renderMode || "2d") === "3d" &&
      typeof WaifuVrmAnimator === "function" &&
      !pageWebglDisabled
        ? "3d"
        : "2d";

    if (shouldShow && !hostEl) {
      if (document.hidden) return;
      createShadowUI();
    } else if (!shouldShow && hostEl) {
      unmountUI();
    } else if (shouldShow && hostEl) {
      if (document.hidden) { animator?.setPaused(true); return; }
      if (wantMode !== activeRenderMode) {
        unmountUI();
        createShadowUI();
        return;
      }
      const nextVer = Number(settings.modelVersion) || 1;
      const nextSrc = settings.modelSource || "auto";
      const nextModel = settings.activeModel || "seraphina";
      if(nextModel!==activeCompanionModel){brain.stage=0;brain.elapsed=0;brain.last=0;animator.behavior=null;}
      if (wantMode === "3d" && (nextVer !== activeModelVersion || nextSrc !== activeModelSource || nextModel !== activeCompanionModel)) {
        activeModelVersion = nextVer;
        activeModelSource = nextSrc;
        activeCompanionModel = nextModel;
        if (animator && typeof animator.reloadModel === "function") {
          animator.modelKey = nextModel;
          animator.modelSource = nextSrc;
          animator.reloadModel().catch(() => null);
        }
      } else if (wantMode === "2d" && nextModel !== activeCompanionModel) {
        activeCompanionModel = nextModel;
        if (animator && typeof animator.setModelKey === "function") {
          animator.setModelKey(nextModel).catch(() => null);
        }
      }
      syncFullscreenState();
      applyVisualSettings();
      syncPose();
      if (settings.poseMode === "auto") {
        scheduleAutoBehavior();
      } else if (autoBehaviorTimer) {
        clearTimeout(autoBehaviorTimer);
        autoBehaviorTimer = null;
      }
      if (!motionChatterTimer) {
        scheduleMotionChatter(MOTION_CHATTER_INTERVAL_MS);
      }
    }
  }

  function normalizeSettingsObj(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
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
    if(!['auto','idle'].includes(merged.poseMode))merged.poseMode='auto';
    merged.motionQuotes = normalizeMotionQuotes(raw?.motionQuotes, raw?.customQuotes);
    delete merged.customQuotes;
    return merged;
  }

  function formatTabAlertBubble(msg) {
    const list = Array.isArray(msg.pendingList) ? msg.pendingList : [];
    const latest = msg.latest || list[0];
    if (!latest) return settings.activeModel==='gothic_red'?"Hey! A background tab is ready!":"Your background tab is ready when you are.";

    const tabCount = Number(msg.tabCount) || list.length || 1;
    const totalCount = Number(msg.totalCount) || tabCount;
    if (tabCount === 1) {
      if (latest.mode === "title_count") {
        return `${latest.count} new on ${latest.label}!`;
      }
      return `${latest.label} finished! (1 ready)`;
    }

    const labels = [...new Set(list.map((x) => x.label))];
    const head = labels.slice(0, 2).join(" & ");
    const extra = labels.length > 2 ? ` +${labels.length - 2}` : "";
    const countLabel = totalCount > tabCount ? `${totalCount} items` : `${tabCount} ready`;
    return `${head}${extra} updated! (${countLabel})`;
  }

  function requestBehavior(action) {
    if(!animator || !hostEl)return {ok:false,error:'Companion is still loading. Retry in a moment.'};
    if(document.hidden || isFullscreenBlocked())return {ok:false,error:'Open the visible page containing your companion first.'};
    if(!['auto','calm','playful','interact','dance','garden','walk'].includes(action))return {ok:false,error:'Unknown activity'};
    lastPageActivity=Date.now();stopStroll();
    animator.setMicroMotion(true);animator.setPaused(false);
    if(action==='calm'){
      settings.poseMode='auto';settings.interactionFrequency='quiet';
      animator.behavior=null;temporaryPose=null;clearTimeout(temporaryPoseTimer);
      if(behaviorProp)behaviorProp.hidden=true;
      syncPose();scheduleAutoBehavior();
    }else if(action==='auto'||action==='playful'){
      settings.poseMode='auto';settings.interactionFrequency=action==='playful'?'playful':'balanced';
      settings.microMotion=true;settings.autoStroll=true;
      brain.stage=0;brain.elapsed=0;brain.last=performance.now();nextStrollAt=performance.now()+15000;
      performBehavior('greet',true);scheduleAutoBehavior();
    }else if(action==='walk'){
      const right=settings.position?.right??24;
      const candidate=clampPosition(right+120,settings.position?.bottom??18,settings.sizePx,false);
      const delta=Math.abs(candidate.right-right)>35?candidate.right-right:-120;
      animator.behavior=null;
      runSmoothStroll(delta,1700,{onComplete:()=>syncPose()});
    }else if(action==='interact')handleClickReaction();
    else performBehavior(action,true);
    return {ok:true,action};
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "WAIFU_PHYSICS_PULSE" && hostEl) {
      animator?.triggerBounce();
    } else if (msg.type === "WAIFU_TIMER_EVENT") {
      if (msg.timer) timer = msg.timer;
      if (hostEl) {
        animator.behavior=null;
        if (msg.event === "focus_complete") {
          const streak = Number(msg.stats?.focusSessionsToday) || 0;
          brain.elapsed=0;
          const baseQuote = settings.activeModel==='gothic_red'?"You did it! That deserves a little dance!":"Nicely done. You've earned a proper break.";
          const fullQuote = streak > 0 ? `${baseQuote} (Session #${streak} today~)` : baseQuote;
          walkAndPerform("celebrate", 6000, fullQuote);
        } else if (msg.event === "break_complete") {
          walkAndPerform("wave", 5000, "Break's over—ready when you are!");
        }
      }
    } else if (msg.type === "WAIFU_TAB_ALERT_EVENT" && msg.event === "triggered" && hostEl) {
      if (settings.tabAlerts?.enabled !== false && !isFullscreenBlocked()) {
        const alertPose = settings.tabAlerts?.pose || "celebrate";
        const info=formatTabAlertBubble(msg);
        const bubbleText = settings.activeModel==='gothic_red'?`Hey, look! ${info}`:`A little update for you: ${info}`;
        animator.behavior=null;
        if (isUserTypingNow()) {
          triggerTemporaryPose(alertPose, 5500, bubbleText);
        } else {
          walkAndPerform(alertPose, 6500, bubbleText);
        }
      }
    } else if (msg.type === "WAIFU_WELLNESS_REMINDER" && hostEl) {
      if (settings.wellnessReminder !== false && !isFullscreenBlocked() && !isUserTypingNow()) {
        walkAndPerform("tea", 8500, pickQuote("wellness"));
      }
    } else if (msg.type === "WAIFU_PULSE_POSE" && hostEl) {
      triggerTemporaryPose(msg.pose || "wave", 3600, msg.quote || pickQuote(msg.pose === "wave" ? "greeting" : msg.pose));
    } else if (msg.type === "WAIFU_BEHAVIOR_CONTROL") {
      sendResponse(requestBehavior(msg.action));
    } else if (msg.type === "WAIFU_AI_ACTION" && hostEl && animator) {
      if (typeof msg.expression === "string" && typeof animator.setExpression === "function") {
        animator.setExpression(msg.expression, msg.expressionWeight ?? 0.9);
      }
      if (typeof msg.mouthOpen === "number" && typeof animator.setMouthOpen === "function") {
        animator.setMouthOpen(msg.mouthOpen);
      }
      if (msg.pose) {
        triggerTemporaryPose(msg.pose, msg.durationMs || 4200, msg.bubble || null);
      } else if (msg.bubble) {
        showBubble(msg.bubble, msg.durationMs || 4200);
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings?.newValue) {
      settings = normalizeSettingsObj(changes.settings.newValue);
      syncMountState();
    }
    if (changes.timer?.newValue) {
      timer = { ...DEFAULT_TIMER, ...changes.timer.newValue };
      if (hostEl) syncPose();
    }
  });

  window.WAIFU_REFRESH_RENDERER = (retry = false) => {
    if (retry) {
      pageWebglDisabled = false;
      if (hostEl) unmountUI();
    }
    WaifuVrmAnimator = window.WaifuVrmAnimator;
    syncMountState();
  };
  chrome.storage.local.get(["settings", "timer"]).then((data) => {
    settings = normalizeSettingsObj(data.settings);
    timer = { ...DEFAULT_TIMER, ...(data.timer || {}) };
    syncMountState();
  });
})();

