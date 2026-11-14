(function (root) {
  "use strict";

  const {
    SPRITE_POSES,
    WALK_SPRITES = {},
    EXTRA_SPRITES = {},
    ALL_SPRITE_FILES = {}
  } = root.WAIFU_SHARED;

  const SPRITE_FILE_MAP = Object.keys(ALL_SPRITE_FILES).length > 0
    ? ALL_SPRITE_FILES
    : Object.assign(
        {},
        Object.fromEntries(Object.entries(SPRITE_POSES).map(([k, v]) => [k, v.file])),
        WALK_SPRITES,
        EXTRA_SPRITES
      );

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  const EYE_ROIS = [
    { x0: 148, y0: 130, w: 64, h: 62 },
    { x0: 224, y0: 128, w: 74, h: 62 }
  ];

  function createOffscreenCanvas(w, h) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function extractEyeRegion(roiData, w, h) {
    const px = roiData.data;
    const n = w * h;
    const irisSeeds = [];
    const irisMask = new Uint8Array(n);
    const scleraMask = new Uint8Array(n);
    const darkMask = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      const r = px[idx];
      const g = px[idx + 1];
      const b = px[idx + 2];
      const a = px[idx + 3];
      const lum = (r + g + b) / 3;
      if (lum < 120) darkMask[i] = 1;
      if (a > 180 && lum >= 120 && b >= r - 2 && b - r < 16 && g >= r - 6 && lum > 180) {
        scleraMask[i] = 1;
      }
      if (a > 200 && b - g > 44 && b - r > 22 && r < 168 && g < 132 && b > 110) {
        irisMask[i] = 1;
        irisSeeds.push(i % w, (i / w) | 0);
      }
    }

    const seedCount = irisSeeds.length >> 1;
    if (seedCount < 60) return null;

    // Median filter rejects any stray hair/accessory pixel far from iris centroid
    const xs = [];
    const ys = [];
    for (let i = 0; i < irisSeeds.length; i += 2) {
      xs.push(irisSeeds[i]);
      ys.push(irisSeeds[i + 1]);
    }
    const sx = [...xs].sort((a, b) => a - b);
    const sy = [...ys].sort((a, b) => a - b);
    const mx = sx[sx.length >> 1];
    const my = sy[sy.length >> 1];

    let minX = w, maxX = 0, minY = h, maxY = 0, validSeeds = 0;
    const seedQueue = [];
    for (let i = 0; i < xs.length; i++) {
      if (Math.abs(xs[i] - mx) <= 17 && Math.abs(ys[i] - my) <= 17) {
        validSeeds++;
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
        if (ys[i] < minY) minY = ys[i];
        if (ys[i] > maxY) maxY = ys[i];
        seedQueue.push(ys[i] * w + xs[i]);
      }
    }
    if (validSeeds < 60) return null;

    const ix = 0.5 * (minX + maxX);
    const iy = 0.5 * (minY + maxY) + 1.0;
    const rx = clamp((maxX - minX) * 0.5 + 0.9, 11.5, 15.0);
    const ry = clamp((maxY - minY) * 0.5 + 1.4, 12.5, 16.0);
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);

    const sockMask = new Uint8Array(n);
    const ellArr = new Float32Array(n);
    const passable = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const dy = y - iy;
      const inY = y >= iy - ry - 2 && y <= iy + ry + 3;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const dx = x - ix;
        const ell = dx * dx * invRx2 + dy * dy * invRy2;
        ellArr[i] = ell;
        if (inY && Math.abs(dx) <= rx + 12) {
          if ((irisMask[i] || scleraMask[i] || ell <= 0.85) && (!darkMask[i] || ell <= 0.65)) {
            passable[i] = 1;
          }
        }
      }
    }

    const q = new Int32Array(n);
    let qHead = 0, qTail = 0;
    for (let i = 0; i < seedQueue.length; i++) {
      const idx = seedQueue[i];
      if (!sockMask[idx]) {
        sockMask[idx] = 1;
        q[qTail++] = idx;
      }
    }
    while (qHead < qTail) {
      const cur = q[qHead++];
      const cx = cur % w;
      const cy = (cur / w) | 0;
      if (cx > 0) { const ni = cur - 1; if (!sockMask[ni] && passable[ni]) { sockMask[ni] = 1; q[qTail++] = ni; } }
      if (cx + 1 < w) { const ni = cur + 1; if (!sockMask[ni] && passable[ni]) { sockMask[ni] = 1; q[qTail++] = ni; } }
      if (cy > 0) { const ni = cur - w; if (!sockMask[ni] && passable[ni]) { sockMask[ni] = 1; q[qTail++] = ni; } }
      if (cy + 1 < h) { const ni = cur + w; if (!sockMask[ni] && passable[ni]) { sockMask[ni] = 1; q[qTail++] = ni; } }
    }

    const pureScleraIdx = [];
    for (let i = 0; i < n; i++) {
      if (sockMask[i] && ellArr[i] > 1.04 && scleraMask[i]) {
        pureScleraIdx.push(i);
      }
    }

    const scleraCanvas = createOffscreenCanvas(w, h);
    const irisCanvas = createOffscreenCanvas(w, h);
    const clipCanvas = createOffscreenCanvas(w, h);
    if (!scleraCanvas || !irisCanvas || !clipCanvas) return null;

    const sCtx = scleraCanvas.getContext("2d");
    const iCtx = irisCanvas.getContext("2d");
    const cCtx = clipCanvas.getContext("2d");
    const sImg = sCtx.createImageData(w, h);
    const iImg = iCtx.createImageData(w, h);
    const cImg = cCtx.createImageData(w, h);
    sImg.data.set(px);

    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      if (sockMask[i]) {
        cImg.data[idx] = 255;
        cImg.data[idx + 1] = 255;
        cImg.data[idx + 2] = 255;
        cImg.data[idx + 3] = 255;

        // Distance-weighted sclera infill preserves natural upper-eyelid shadow gradient
        if (!(ellArr[i] > 1.04 && scleraMask[i])) {
          if (pureScleraIdx.length > 6) {
            const x = i % w;
            const y = (i / w) | 0;
            let sr = 0, sg = 0, sb = 0, sw = 0;
            for (let k = 0; k < pureScleraIdx.length; k++) {
              const si = pureScleraIdx[k];
              const dx = (si % w) - x;
              const dy = ((si / w) | 0) - y;
              const d2 = dy * dy * 2.5 + dx * dx * 0.35 + 0.1;
              const wgt = 1 / (d2 * Math.sqrt(d2));
              const sBase = si * 4;
              sr += px[sBase] * wgt;
              sg += px[sBase + 1] * wgt;
              sb += px[sBase + 2] * wgt;
              sw += wgt;
            }
            sImg.data[idx] = clamp(Math.round(sr / sw), 0, 255);
            sImg.data[idx + 1] = clamp(Math.round(sg / sw), 0, 255);
            sImg.data[idx + 2] = clamp(Math.round(sb / sw), 0, 255);
            sImg.data[idx + 3] = 255;
          } else {
            sImg.data[idx] = 245;
            sImg.data[idx + 1] = 245;
            sImg.data[idx + 2] = 252;
            sImg.data[idx + 3] = 255;
          }
        }

        // Solid iris disc + internal highlights (excludes outer sclera corners)
        if (ellArr[i] <= 1.0 && (!scleraMask[i] || ellArr[i] <= 0.84)) {
          iImg.data[idx] = px[idx];
          iImg.data[idx + 1] = px[idx + 1];
          iImg.data[idx + 2] = px[idx + 2];
          iImg.data[idx + 3] = clamp(Math.round((1.05 - ellArr[i]) * 5 * 255), 0, 255);
        }
      } else {
        const y = (i / w) | 0;
        if (y < iy - 1 && ellArr[i] <= 0.94) {
          const sy = Math.min(h - 1, y + 4);
          const si = sy * w + (i % w);
          if (sockMask[si] && ellArr[si] <= 0.88) {
            const sBase = si * 4;
            iImg.data[idx] = px[sBase];
            iImg.data[idx + 1] = px[sBase + 1];
            iImg.data[idx + 2] = px[sBase + 2];
            iImg.data[idx + 3] = clamp(Math.round((1.0 - ellArr[i]) * 4.5 * 255), 0, 255);
          }
        }
      }
    }

    sCtx.putImageData(sImg, 0, 0);
    iCtx.putImageData(iImg, 0, 0);
    cCtx.putImageData(cImg, 0, 0);
    return { scleraCanvas, irisCanvas, clipCanvas, w, h };
  }

  function buildEyeRig(bmp) {
    const probe = createOffscreenCanvas(74, 62);
    if (!probe || !bmp) return null;
    const pCtx = probe.getContext && probe.getContext("2d", { willReadFrequently: true });
    if (!pCtx || typeof pCtx.getImageData !== "function" || typeof pCtx.putImageData !== "function") {
      return null;
    }
    const eyes = [];
    for (const roi of EYE_ROIS) {
      pCtx.clearRect(0, 0, roi.w, roi.h);
      pCtx.drawImage(bmp, roi.x0, roi.y0, roi.w, roi.h, 0, 0, roi.w, roi.h);
      const data = pCtx.getImageData(0, 0, roi.w, roi.h);
      const region = extractEyeRegion(data, roi.w, roi.h);
      if (!region) return null;
      eyes.push(Object.assign({ x0: roi.x0, y0: roi.y0 }, region));
    }
    return eyes;
  }

  function base64ToBlob(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type: "image/png" });
  }

  class WaifuMeshAnimator {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });
      this.displayHeight = options.height || 175;
      this.aspect = 460 / 600;
      this.microMotion = options.microMotion !== false;
      this.depth25D = options.depth25D !== false;
      this.modelKey = options.modelKey || "seraphina";

      this.sprites = new Map();
      this.loadingPromises = new Map();
      this.batchLoadPromise = null;

      this.startTime = performance.now();
      this.lastFrameTime = this.startTime;
      this.currentPose = "idle";
      this.poseEnteredAt = this.startTime;
      this.rafId = null;
      this.destroyed = false;
      this.paused = false;

      // Natural autonomous blink scheduler (used during idle)
      this.nextBlinkAt = this.startTime + 2200;
      this.blinkUntil = 0;
      this.doubleBlinkQueued = false;

      // Look & interaction state
      this.targetLookX = 0;
      this.targetLookY = 0;
      this.lookX = 0;
      this.lookY = 0;
      this.targetEyeX = 0;
      this.targetEyeY = 0;
      this.eyeX = 0;
      this.eyeY = 0;
      this.eyeRigs = new Map();
      this.eyeScratchCanvas = null;
      this.eyeScratchCtx = null;

      this.dragVelX = 0;
      this.smoothDragLag = 0;
      this.hoverTarget = 0;
      this.hoverBoost = 0;
      this.bounceStart = -9999;

      // Walk & 60fps continuous motion state (-1 = left, 1 = right)
      this.walkTarget = 0;
      this.walkAmount = 0;
      this.walkDir = -1;
      this.walkStart = this.startTime;
      this.walkPhase = 0;
      this.walkSpeed = 0;
      this.targetWalkSpeed = 0;
      this.sipBlend = 0;
      this.smoothBodyRot = 0;
      this.smoothBodyY = 0;
      this.smoothBodyScaleX = 1;
      this.smoothBodyScaleY = 1;
      this.lastCanvasTransform = "";

      this.resize(this.displayHeight);
    }

    resize(heightPx) {
      this.displayHeight = clamp(Number(heightPx) || 175, 90, 1000);
      this.displayWidth = Math.round(this.displayHeight * this.aspect);
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(1800000 / (this.displayWidth * this.displayHeight)));

      this.dpr = dpr;
      const cssW = `${this.displayWidth}px`;
      const cssH = `${this.displayHeight}px`;
      const nextW = Math.round(this.displayWidth * dpr);
      const nextH = Math.round(this.displayHeight * dpr);
      if (this.canvas.style.width !== cssW) this.canvas.style.width = cssW;
      if (this.canvas.style.height !== cssH) this.canvas.style.height = cssH;
      if (this.canvas.width !== nextW) this.canvas.width = nextW;
      if (this.canvas.height !== nextH) this.canvas.height = nextH;

      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
      }
    }

    async fetchViaBackground() {
      const modelKey = this.modelKey;
      if (!chrome?.runtime?.sendMessage) return false;
      try {
        const resp = await chrome.runtime.sendMessage({ type: "GET_SPRITES", model: this.modelKey });
        if (!resp || !resp.ok || !resp.sprites) return false;
        await Promise.all(
          Object.entries(resp.sprites).map(async ([poseId, b64]) => {
            if (!b64 || this.sprites.has(poseId)) return;
            const blob = base64ToBlob(b64);
            const bmp = await createImageBitmap(blob);
            if (this.destroyed || this.modelKey !== modelKey) { bmp.close(); return; }
            this.sprites.set(poseId, bmp);
          })
        );
        return this.sprites.size > 0;
      } catch {
        return false;
      }
    }

    async loadSpriteDirect(poseId) {
      const modelKey = this.modelKey;
      if (this.sprites.has(poseId)) return this.sprites.get(poseId);
      if (this.loadingPromises.has(poseId)) return this.loadingPromises.get(poseId);

      const spriteFiles = root.WAIFU_SHARED?.getSpriteFiles
        ? root.WAIFU_SHARED.getSpriteFiles(this.modelKey)
        : SPRITE_FILE_MAP;
      const defaultIdle = this.modelKey === "gothic_red" ? "assets/sprites/crimson/idle.png" : "assets/sprites/idle.png";
      const filePath = spriteFiles[poseId] || defaultIdle;
      const promise = (async () => {
        const url = chrome.runtime.getURL(filePath);
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) throw new Error(`Failed to fetch ${filePath}`);
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        if (this.destroyed || this.modelKey !== modelKey) { bmp.close(); return null; }
        this.sprites.set(poseId, bmp);
        return bmp;
      })().finally(() => { if (this.loadingPromises.get(poseId) === promise) this.loadingPromises.delete(poseId); });

      this.loadingPromises.set(poseId, promise);
      return promise;
    }

    async loadSprite(poseId) {
      if (this.sprites.has(poseId)) return this.sprites.get(poseId);
      await this.preloadAll();
      if (this.sprites.has(poseId)) return this.sprites.get(poseId);
      return this.loadSpriteDirect(poseId).catch(() => null);
    }

    async preloadAll() {
      if (!this.batchLoadPromise) {
        this.batchLoadPromise = (async () => {
          const spriteFiles = root.WAIFU_SHARED?.getSpriteFiles
            ? root.WAIFU_SHARED.getSpriteFiles(this.modelKey)
            : SPRITE_FILE_MAP;
          // Paint idle first; load other poses without encoding all sprites in messages.
          await this.loadSpriteDirect("idle").catch(() => null);
          if (!this.destroyed) this.renderFrame(performance.now());
          await Promise.all(Object.keys(spriteFiles).filter(id => !this.sprites.has(id))
            .map(id => this.loadSpriteDirect(id).catch(() => null)));
          if (Object.keys(spriteFiles).some(id => !this.sprites.has(id))) await this.fetchViaBackground();
        })();
      }
      return this.batchLoadPromise;
    }

    async setModelKey(modelKey) {
      const cleanKey = modelKey === "gothic_red" ? "gothic_red" : "seraphina";
      if (this.modelKey === cleanKey) return;
      this.modelKey = cleanKey;
      for (const bmp of this.sprites.values()) bmp.close?.();
      this.sprites.clear();
      this.loadingPromises.clear();
      this.batchLoadPromise = null;
      this.eyeRigs.clear();
      await this.preloadAll();
      const current = this.currentPose || "idle";
      if (this.sprites.has(current)) {
        this.baseImage = this.sprites.get(current);
      }
      this.renderFrame(performance.now());
    }

    async setPose(poseId, withBounce = true) {
      const target = SPRITE_POSES[poseId] ? poseId : "idle";
      if (!this.sprites.has(target)) {
        await this.loadSprite(target);
      }
      if (target !== this.currentPose) {
        this.currentPose = target;
        this.poseEnteredAt = performance.now();
      }
      if (withBounce) {
        this.triggerBounce();
      }
      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
      }
    }

    setMicroMotion(enabled) {
      if (this.microMotion === Boolean(enabled)) return;
      this.microMotion = Boolean(enabled);
      if (!this.microMotion) {
        this.lastCanvasTransform = "";
        this.canvas.style.transform = "";
      }
      if (this.microMotion && !this.paused && !this.destroyed) {
        this.lastFrameTime = performance.now();
        this.start();
      } else {
        this.stopLoop();
        this.renderFrame(performance.now());
      }
    }

    setDepth25D(enabled) {
      this.depth25D = Boolean(enabled);
      if (!this.depth25D) {
        this.lastCanvasTransform = "";
        this.canvas.style.transform = "";
      }
      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
      }
    }

    setWalking(active, dirX = 0, speedPx = this.displayHeight * 0.42) {
      this.targetWalkSpeed = active ? Math.max(0, speedPx) : 0;
      const next = active ? 1 : 0;
      if (next === 1 && this.walkTarget === 0) {
        this.walkStart = performance.now();
      }
      this.walkTarget = next;
      if (dirX > 0.5) {
        this.walkDir = 1;
      } else if (dirX < -0.5) {
        this.walkDir = -1;
      }
    }

    setPaused(paused) {
      this.paused = Boolean(paused);
      if (this.paused) {
        this.stopLoop();
      } else if (this.microMotion && !this.destroyed) {
        this.lastFrameTime = performance.now();
        this.start();
      }
    }

    setPointerLook(nx, ny, eyeNx = nx, eyeNy = ny) {
      this.targetLookX = clamp(nx, -1, 1);
      this.targetLookY = clamp(ny, -1, 1);
      this.targetEyeX = clamp(eyeNx, -1, 1);
      this.targetEyeY = clamp(eyeNy, -1, 1);
    }

    getEyeRig(poseKey, bmp) {
      if (this.eyeRigs.has(poseKey)) return this.eyeRigs.get(poseKey);
      const rig = buildEyeRig(bmp);
      this.eyeRigs.set(poseKey, rig);
      return rig;
    }

    setHover(hovered) {
      this.hoverTarget = hovered ? 1 : 0;
    }

    setDragVelocity(vx) {
      this.dragVelX = clamp(vx, -40, 40);
    }

    triggerBounce() {
      this.bounceStart = performance.now();
    }

    start() {
      if (this.destroyed || this.rafId !== null) return;
      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
        return;
      }
      const tick = (now) => {
        if (this.destroyed || !this.microMotion || this.paused) {
          this.rafId = null;
          return;
        }
        if (now - this.lastFrameTime >= 1000 / 30 - 0.5) this.renderFrame(now);
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }

    stopLoop() {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    destroy() {
      this.destroyed = true;
      this.stopLoop();
      for (const bmp of this.sprites.values()) {
        if (bmp && typeof bmp.close === "function") {
          bmp.close();
        }
      }
      this.sprites.clear();
      this.eyeRigs.clear();
      this.eyeScratchCanvas = null;
      this.eyeScratchCtx = null;
    }

    updateBlinkState(now) {
      if (!this.microMotion || this.walkAmount > 0.15 || this.currentPose !== "idle") {
        return false;
      }
      if (now >= this.nextBlinkAt) {
        this.blinkUntil = now + 135;
        if (this.doubleBlinkQueued) {
          this.doubleBlinkQueued = false;
          this.nextBlinkAt = now + 2600 + Math.random() * 2800;
        } else if (Math.random() < 0.24) {
          this.doubleBlinkQueued = true;
          this.nextBlinkAt = now + 240;
        } else {
          this.nextBlinkAt = now + 2800 + Math.random() * 2600;
        }
      }
      return now < this.blinkUntil;
    }

    resolveActiveFrame(now) {
      // Registered side-view frames keep the character facing the direction of travel.
      if (this.walkAmount > 0.12) {
        const keys = ["walk_left", "walk_pass_left", "walk_contact_right", "walk_pass_right"];
        const key = keys[Math.floor(this.walkPhase / (Math.PI * 0.5)) % 4];
        return { key: this.sprites.has(key) ? key : "walk_left", offsetX: 0, offsetY: 0, flipX: this.walkDir > 0, isSipping: false };
      }

      // 2) Tea break: cozy sip every 5 seconds (3.6s..5.0s of every 5s cycle)
      if (this.currentPose === "tea" && this.microMotion && this.sprites.has("tea_sip")) {
        const teaElapsed = Math.max(0, now - this.poseEnteredAt);
        const teaCycleMs = teaElapsed % 5000;
        if (teaCycleMs >= 3600) {
          return { key: "tea_sip", offsetX: 0, offsetY: 0, flipX: false, isSipping: true };
        }
        return { key: "tea", offsetX: 0, offsetY: 0, flipX: false, isSipping: false };
      }

      // 3) Crisp 2-frame same-arm animated waving (inward <-> outward)
      if (this.currentPose === "wave" && this.microMotion) {
        // Crimson's alternate drawing changes her head/torso, not just the hand.
        // Keep one registered drawing and articulate its raised arm at render time.
        if (this.modelKey === "gothic_red" || this.modelKey === "crimson") {
          return { key: "wave", offsetX: 0, offsetY: 0, flipX: false, isSipping: false };
        }
        const waveBeat = Math.floor((now - this.poseEnteredAt) / 260) % 2;
        if (waveBeat === 1 && this.sprites.has("wave_alt")) {
          return { key: "wave_alt", offsetX: 0, offsetY: 0, flipX: false, isSipping: false };
        }
        return { key: "wave", offsetX: 0, offsetY: 0, flipX: false, isSipping: false };
      }

      // 4) Pixel-locked natural blink while idle
      if (this.currentPose === "idle" && this.updateBlinkState(now) && this.sprites.has("idle_blink")) {
        return { key: "idle_blink", offsetX: 0, offsetY: 0, flipX: false, isSipping: false };
      }

      return { key: this.currentPose, offsetX: 0, offsetY: 0, flipX: false, isSipping: false };
    }

    renderFrame(now) {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      const dt = clamp((now - this.lastFrameTime) * 0.001, 0.001, 0.05);
      this.lastFrameTime = now;

      // Frame-rate-independent exponential smoothing for liquid 60fps+ feel
      const lerpFactor = 1 - Math.exp(-11 * dt);
      this.lookX += (this.targetLookX - this.lookX) * lerpFactor;
      this.lookY += (this.targetLookY - this.lookY) * lerpFactor;
      const eyeLerp = 1 - Math.exp(-18 * dt);
      this.eyeX += (this.targetEyeX - this.eyeX) * eyeLerp;
      this.eyeY += (this.targetEyeY - this.eyeY) * eyeLerp;
      this.hoverBoost += (this.hoverTarget - this.hoverBoost) * lerpFactor;

      const walkLerp = 1 - Math.exp(-15 * dt);
      this.walkAmount += (this.walkTarget - this.walkAmount) * walkLerp;

      const dragLerp = 1 - Math.exp(-14 * dt);
      this.smoothDragLag += (this.dragVelX - this.smoothDragLag) * dragLerp;
      this.dragVelX *= Math.exp(-10 * dt);

      const frame = this.resolveActiveFrame(now);
      const activeImg = this.sprites.get(frame.key) || this.sprites.get("idle");
      if (!activeImg) return;
      ctx.clearRect(0, 0, w, h);

      // Rigid articulated character transform anchored at her feet (zero rubber mesh distortion!)
      const padX = w * 0.055;
      const padTop = h * 0.04;
      const padBottom = h * 0.03;
      const drawW = w - padX * 2;
      const drawH = h - padTop - padBottom;

      const pivotX = w * 0.5;
      const pivotY = h - padBottom;

      let translateX = 0;
      let translateY = 0;
      let rotRad = 0;
      let scaleX = 1;
      let scaleY = 1;

      const t = (now - this.startTime) * 0.001;

      if (this.microMotion) {
        // Continuous stride phase integration prevents pops when starting/stopping a stroll
        if (this.walkAmount > 0.01) {
          this.walkSpeed += (this.targetWalkSpeed - this.walkSpeed) * (1 - Math.exp(-10 * dt));
          const cyclesPerSecond = clamp(1.55 + this.walkSpeed / this.displayHeight * 0.75, 1.55, 2.4);
          this.walkPhase += dt * Math.PI * 2 * cyclesPerSecond;
        } else {
          this.walkPhase = 0;
        }

        // Smooth C-infinity pose targets blended across state switches at 60fps
        let targetBodyRot = 0;
        let targetBodyY = 0;
        let targetScaleX = 1;
        let targetScaleY = 1;

        const sipTarget = this.currentPose === "tea" && frame.isSipping ? 1 : 0;
        this.sipBlend += (sipTarget - this.sipBlend) * (1 - Math.exp(-12 * dt));

        if (this.walkAmount > 0.01) {
          const walkEase = this.walkAmount * this.walkAmount * (3 - 2 * this.walkAmount);
          const stepArc = 0.5 - 0.5 * Math.cos(this.walkPhase * 2);
          targetBodyY -= stepArc * (h * 0.004) * walkEase;
          targetBodyRot += this.walkDir * (0.005 + stepArc * 0.003) * walkEase;
          
          
        } else {
          switch (this.currentPose) {
            case "wave": {
              const waveArc = 0.5 - 0.5 * Math.cos(t * 3.8);
              const bodyWeight = this.modelKey === "gothic_red" || this.modelKey === "crimson" ? 0.35 : 1;
              targetBodyRot += (Math.sin(t * 3.8) * 0.02 + Math.sin(t * 1.9) * 0.007) * bodyWeight;
              targetBodyY -= waveArc * (h * 0.008) * bodyWeight;
              break;
            }
            case "celebrate": {
              const hop = 0.5 - 0.5 * Math.cos(t * 4.2);
              targetBodyRot += Math.sin(t * 3.9) * 0.036;
              targetBodyY -= hop * (h * 0.008);
              targetScaleY += (hop - 0.4) * 0.026;
              targetScaleX -= (hop - 0.4) * 0.015;
              break;
            }
            case "think":
              targetBodyRot += -0.034 + Math.sin(t * 1.35) * 0.013;
              targetBodyY += Math.sin(t * 2.0) * (h * 0.005);
              targetScaleY += Math.sin(t * 2.0) * 0.004;
              break;
            case "tea": {
              const idleRot = Math.sin(t * 1.35) * 0.016;
              const idleY = Math.sin(t * 1.35) * (h * 0.004);
              const sipRot = -0.022 + Math.sin(t * 1.35) * 0.004;
              const sipY = h * 0.0045;
              targetBodyRot += idleRot + (sipRot - idleRot) * this.sipBlend;
              targetBodyY += idleY + (sipY - idleY) * this.sipBlend;
              targetScaleY += -0.006 * this.sipBlend + Math.sin(t * 1.8) * 0.004 * (1 - this.sipBlend);
              break;
            }
            default: {
              // Calm living weight shift + smooth harmonic breathing
              const breath = Math.sin(t * 2.05);
              targetBodyRot += Math.sin(t * 1.4) * 0.006 + Math.sin(t * 0.7) * 0.005;
              targetBodyY += breath * (h * 0.006);
              targetScaleY += breath * 0.005;
              break;
            }
          }
          targetBodyRot += this.lookX * 0.022;
        }

        const poseLerp = 1 - Math.exp(-14 * dt);
        this.smoothBodyRot += (targetBodyRot - this.smoothBodyRot) * poseLerp;
        this.smoothBodyY += (targetBodyY - this.smoothBodyY) * poseLerp;
        this.smoothBodyScaleX += (targetScaleX - this.smoothBodyScaleX) * poseLerp;
        this.smoothBodyScaleY += (targetScaleY - this.smoothBodyScaleY) * poseLerp;

        rotRad += this.smoothBodyRot;
        translateY += this.smoothBodyY;
        scaleX *= this.smoothBodyScaleX;
        scaleY *= this.smoothBodyScaleY;

        // Tactile spring bounce on click / pose switch
        const bounceAge = (now - this.bounceStart) * 0.001;
        if (bounceAge >= 0 && bounceAge < 0.38) {
          const decay = Math.exp(-8 * bounceAge);
          const s = Math.sin(bounceAge * 24) * decay * 0.008;
          scaleY *= 1 + s;
          scaleX *= 1 - s * 0.55;
          translateY -= (0.5 - 0.5 * Math.cos(bounceAge * 26)) * decay * (h * 0.022);
        }

        // Subtle drag inertia lean
        rotRad += clamp(this.smoothDragLag * 0.0032, -0.09, 0.09);
      }

      // Subtle 2.5D perspective depth tilt on canvas card when enabled (high precision, zero CSS transition fighting rAF)
      if (this.microMotion && this.depth25D) {
        const tiltY = (this.lookX * 3.0 + clamp(this.smoothDragLag * 0.4, -10, 10)).toFixed(3);
        const tiltX = (-this.lookY * 2.0).toFixed(3);
        const hoverScale = (1 + this.hoverBoost * 0.028).toFixed(5);
        const nextTransform = `perspective(560px) rotateY(${tiltY}deg) rotateX(${tiltX}deg) scale(${hoverScale})`;
        if (nextTransform !== this.lastCanvasTransform) {
          this.lastCanvasTransform = nextTransform;
          this.canvas.style.transform = nextTransform;
        }
      } else if (this.lastCanvasTransform || this.canvas.style.transform) {
        this.lastCanvasTransform = "";
        this.canvas.style.transform = "";
      }

      const regX = (frame.offsetX / 460) * drawW;
      const regY = (frame.offsetY / 600) * drawH;

      // Always draw at 100% full opacity so colors never wash out
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.translate(pivotX + translateX + regX, pivotY + translateY + regY);
      ctx.rotate(rotRad);
      ctx.scale(frame.flipX ? -scaleX : scaleX, scaleY);
      if (frame.key === "wave" && this.microMotion && (this.modelKey === "gothic_red" || this.modelKey === "crimson")) {
        this.drawCrimsonWave(ctx, activeImg, drawW, drawH, now);
      } else {
        ctx.drawImage(activeImg, -drawW * 0.5, -drawH, drawW, drawH);
      }

      // Expressive 60fps eyeball gaze tracking inside exact pixel-clipped eye sockets
      if (this.modelKey === "seraphina" && frame.key === "idle" && this.microMotion && (Math.abs(this.eyeX) > 0.02 || Math.abs(this.eyeY) > 0.02)) {
        const rig = this.getEyeRig(frame.key, activeImg);
        if (rig) {
          if (!this.eyeScratchCanvas) {
            this.eyeScratchCanvas = createOffscreenCanvas(74, 62);
            this.eyeScratchCtx = this.eyeScratchCanvas && this.eyeScratchCanvas.getContext("2d");
          }
          const eCtx = this.eyeScratchCtx;
          if (eCtx) {
            const ox = (frame.flipX ? -1 : 1) * this.eyeX * 7.8;
            const oy = this.eyeY * 4.4;
            for (const eye of rig) {
              eCtx.clearRect(0, 0, eye.w, eye.h);
              eCtx.globalCompositeOperation = "source-over";
              eCtx.drawImage(eye.scleraCanvas, 0, 0);
              eCtx.drawImage(eye.irisCanvas, ox, oy);
              eCtx.globalCompositeOperation = "destination-in";
              eCtx.drawImage(eye.clipCanvas, 0, 0);
              eCtx.globalCompositeOperation = "source-over";

              const dx = -drawW * 0.5 + (eye.x0 / 460) * drawW;
              const dy = -drawH + (eye.y0 / 600) * drawH;
              const dw = (eye.w / 460) * drawW;
              const dh = (eye.h / 600) * drawH;
              ctx.drawImage(this.eyeScratchCanvas, 0, 0, eye.w, eye.h, dx, dy, dw, dh);
            }
          }
        }
      }

      ctx.restore();
    }

    drawCrimsonWave(ctx, image, width, height, now) {
      // The silhouette left of the elbow is isolated from the face and hair.
      // Two clipped draws rotate the same pixels; no full-frame swaps or fades.
      const sx = width / 460, sy = height / 600;
      const arm = () => {
        ctx.moveTo(65, 245); ctx.lineTo(101, 245);
        ctx.lineTo(111, 239); ctx.lineTo(145, 245);
        ctx.lineTo(158, 278); ctx.lineTo(174, 301);
        ctx.lineTo(179, 332); ctx.lineTo(166, 349);
        ctx.lineTo(139, 341); ctx.lineTo(114, 310);
        ctx.lineTo(65, 292); ctx.closePath();
      };
      ctx.save();
      ctx.translate(-width * 0.5, -height);
      ctx.scale(sx, sy);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, 460, 600); arm(); ctx.clip('evenodd');
      ctx.drawImage(image, 0, 0, 460, 600);
      ctx.restore();
      const elapsed = Math.max(0, (now - this.poseEnteredAt) * 0.001);
      const easeIn = Math.min(1, elapsed / 0.25);
      const angle = Math.sin(elapsed * Math.PI * 2 * 1.5) * 0.045 * easeIn;
      ctx.save();
      ctx.translate(174, 325); ctx.rotate(angle); ctx.translate(-174, -325);
      ctx.beginPath(); arm(); ctx.clip();
      ctx.drawImage(image, 0, 0, 460, 600);
      ctx.restore();
      ctx.restore();
    }
  }

  root.WaifuMeshAnimator = WaifuMeshAnimator;
})(typeof globalThis !== "undefined" ? globalThis : window);
