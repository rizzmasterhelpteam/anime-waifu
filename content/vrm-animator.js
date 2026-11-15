(function (root) {
  "use strict";

  const VENDOR = root.WAIFU_VRM_VENDOR || {};
  const THREE = VENDOR.THREE;
  const createVrmGltfLoader = VENDOR.createVrmGltfLoader;
  const VRMUtils = VENDOR.VRMUtils;

  const MODEL_CANVAS_ASPECT = 460 / 600;

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function damp(cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  }
  function smooth01(v) {v=clamp(v,0,1);return v*v*(3-2*v);}

  function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  const HUMANOID_BONE_KEYS = [
    "hips",
    "spine",
    "chest",
    "upperChest",
    "neck",
    "head",
    "leftEye",
    "rightEye",
    "leftShoulder",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightShoulder",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
    "leftUpperLeg",
    "leftLowerLeg",
    "leftFoot",
    "leftToes",
    "rightUpperLeg",
    "rightLowerLeg",
    "rightFoot",
    "rightToes"
  ];

  const EXTRA_PHYSICS_BONES = [
    "HairBack1",
    "HairBack2",
    "HairLeft1",
    "HairLeft2",
    "HairRight1",
    "HairRight2",
    "SkirtFront",
    "SkirtBack"
  ];

  const FINGER_BONE_KEYS=[];
  for(const side of ['left','right']){
    for(const finger of ['Index','Middle','Ring','Little'])for(const joint of ['Proximal','Intermediate','Distal'])FINGER_BONE_KEYS.push(side+finger+joint);
    for(const joint of ['Metacarpal','Proximal','Distal'])FINGER_BONE_KEYS.push(side+'Thumb'+joint);
  }
  HUMANOID_BONE_KEYS.push(...FINGER_BONE_KEYS);

  class WaifuVrmAnimator {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.modelKey = options.modelKey || "seraphina";
      this.modelSource = options.modelSource || "auto";
      this.displayHeight = options.height || 175;
      this.aspect = MODEL_CANVAS_ASPECT;
      this.microMotion = options.microMotion !== false;
      this.depth25D = options.depth25D !== false;
      this.onFallback2D = typeof options.onFallback2D === "function" ? options.onFallback2D : null;

      this.startTime = performance.now();
      this.lastFrameTime = this.startTime;
      this.currentPose = "idle";
      this.poseEnteredAt = this.startTime;
      this.rafId = null;
      this.destroyed = false;
      this.paused = false;
      this.webglFailed = false;

      // Pose crossfade weights
      this.poseWeights = {
        idle: 1,
        wave: 0,
        think: 0,
        celebrate: 0,
        tea: 0
      };

      // Blink scheduler
      this.nextBlinkAt = this.startTime + 2100;
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

      this.dragVelX = 0;
      this.dragVelY = 0;
      this.physicsEnabled = options.physicsEnabled !== false;
      this.physicsStrength = clamp(options.physicsStrength ?? 0.9, 0, 1);
      this.chestBounce = clamp(options.chestBounce ?? 1, 0, 1);
      this.secondaryMotion = null;
      this.smoothDragLag = 0;
      this.hoverTarget = 0;
      this.hoverBoost = 0;
      this.bounceStart = -9999;

      // Walk locomotion state
      this.walkTarget = 0;
      this.walkAmount = 0;
      this.walkDir = -1;
      this.walkPhase = 0;
      this.walkSpeed = 0;
      this.walkCadence = 1;
      this._walkLegs = { left: new Float64Array(4), right: new Float64Array(4) };
      this.targetWalkSpeed = 0;
      this.walkYaw = 0;
      this.sipBlend = 0;

      // Interactive 3D Zoom, Focus Pan & 360° Orbit state
      this.zoomLevel = 1.0;
      this.targetZoomLevel = 1.0;
      this.zoomPanY = 0.50;
      this.targetZoomPanY = 0.50;
      this.orbitYaw = 0;
      this.targetOrbitYaw = 0;
      this.orbitPitch = 0;
      this.targetOrbitPitch = 0;
      this.modelHeight = 1.35;
      this.baseCamDist = 3.0;

      // Future AI Brain expression / lip-sync overrides
      this.apiExpression = null;
      this.apiExpressionWeight = 0;
      this.mouthOpenWeight = 0;

      // Procedural spring physics state (for non-VRM starter GLB & subtle velocity impulse)
      this.hairVelZ = 0;
      this.hairAngleZ = 0;
      this.hairVelX = 0;
      this.hairAngleX = 0;

      // Loaded model data
      this.loadPromise = null;
      this.vrm = null;
      this.modelRoot = null;
      this.modelInfo = { source: "starter", name: "seraphina_starter.glb" };
      this.boneMap = new Map();
      this.morphMeshes = [];
      this.teaPropNodes = [];
      this.restArmDropLeft = 0.0;
      this.restArmDropRight = 0.0;
      this.hipsRestPos = THREE ? new THREE.Vector3() : null;
      this.legLength = 0.5;
      this.isVrmModel = false;

      this._initThree();
      this.resize(this.displayHeight);
    }

    _initThree() {
      if (!THREE || !createVrmGltfLoader) {
        this.webglFailed = true;
        return;
      }

      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
          preserveDrawingBuffer: false
        });
      } catch {
        this.webglFailed = true;
        if (this.onFallback2D) queueMicrotask(() => { if (!this.destroyed) this.onFallback2D("WebGL unavailable"); });
        return;
      }

      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(26, this.aspect, 0.08, 25);
      this.camera.position.set(0, 0.72, 3.0);

      // Soft bright 360-degree anime studio lighting
      const hemi = new THREE.HemisphereLight(0xfff2ef, 0x74718b, 1.15);
      this.scene.add(hemi);

      const key = new THREE.DirectionalLight(0xffeee6, 1.10);
      key.position.set(1.8, 2.3, 2.5);
      this.scene.add(key);

      const frontFill = new THREE.DirectionalLight(0xe9e2ff, 0.42);
      frontFill.position.set(-1.9, 1.2, 2.0);
      this.scene.add(frontFill);

      const rim = new THREE.DirectionalLight(0xd9ccff, 0.78);
      rim.position.set(-1.8, 1.4, -1.6);
      this.scene.add(rim);

      const backFill = new THREE.DirectionalLight(0xf6eeff, 1.05);
      backFill.position.set(0.4, 1.5, -2.8);
      this.scene.add(backFill);

      this.pivotGroup = new THREE.Group();
      this.scene.add(this.pivotGroup);

      // Reusable scratch math objects (zero GC churn per frame at 60 FPS)
      this._tmpEuler = new THREE.Euler(0, 0, 0, "XYZ");
      this._tmpDeltaQ = new THREE.Quaternion();
      this._tmpConjQ = new THREE.Quaternion();
      this._lookTargetVec = new THREE.Vector3(0, 1.1, 2.5);

      this._onContextLost = (e) => {
        e.preventDefault();
        this.webglFailed = true;
        this.stopLoop();
        if (this.onFallback2D) this.onFallback2D("WebGL context lost");
      };
      this.canvas.addEventListener("webglcontextlost", this._onContextLost, false);
    }

    resize(heightPx) {
      this.displayHeight = clamp(Number(heightPx) || 175, 90, 1000);
      this.displayWidth = Math.round(this.displayHeight * this.aspect);
      // Supersampled WebGL backing buffer keeps facial & dress textures ultra-sharp when zooming
      const dpr = Math.min(clamp(window.devicePixelRatio || 1, 1, 2), Math.sqrt(2000000 / (this.displayWidth * this.displayHeight)));

      const cssW = `${this.displayWidth}px`;
      const cssH = `${this.displayHeight}px`;
      if (this.canvas.style.width !== cssW) this.canvas.style.width = cssW;
      if (this.canvas.style.height !== cssH) this.canvas.style.height = cssH;

      if (this.renderer && !this.webglFailed) {
        if (this.renderer.getPixelRatio() !== dpr) {
          this.renderer.setPixelRatio(dpr);
        }
        const curSize = new THREE.Vector2();
        this.renderer.getSize(curSize);
        if (curSize.x !== this.displayWidth || curSize.y !== this.displayHeight) {
          this.renderer.setSize(this.displayWidth, this.displayHeight, false);
          this.camera.aspect = this.displayWidth / Math.max(1, this.displayHeight);
          this.camera.updateProjectionMatrix();
        }
      }

      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
      }
    }

    async fetchModelBuffer() {
      if (chrome?.runtime?.sendMessage) {
        try {
          let resp = await chrome.runtime.sendMessage({ type: "GET_3D_MODEL", preferUrl: true, model: this.modelKey, source: this.modelSource });
          if (resp?.ok && resp.url) {
            try {
              const result = await fetch(resp.url, { signal: AbortSignal.timeout(12000) });
              if (!result.ok) throw Error(`Model fetch failed: ${result.status}`);
              return { source: resp.source, name: resp.name, buffer: await result.arrayBuffer() };
            } catch {
              // Encoded transport remains a fallback for constrained page contexts.
              resp = await chrome.runtime.sendMessage({ type: "GET_3D_MODEL", model: this.modelKey, source: this.modelSource });
            }
          }
          if (resp?.ok && resp.base64) {
            return {
              source: resp.source || "starter",
              name: resp.name || "model.glb",
              buffer: base64ToArrayBuffer(resp.base64)
            };
          }
        } catch {
          // Fall through to direct fetch
        }
      }
      const fallbackUrl = chrome?.runtime?.getURL
        ? chrome.runtime.getURL("assets/models/seraphina_starter.glb")
        : "assets/models/seraphina_starter.glb";
      const res = await fetch(fallbackUrl);
      if (!res.ok) throw new Error(`Model fetch failed: ${res.status}`);
      return {
        source: "starter",
        name: "seraphina_starter.glb",
        buffer: await res.arrayBuffer()
      };
    }

    async prepareDance() {
      if(this.isVrmModel){if(!this.authoredMotion)throw Error('3D animations are still loading');return 10;}
      if(!root.WAIFU_DANCE)throw Error('Reload the extension to load dance playback');
      this.dancePlayer??=new root.WAIFU_DANCE.SkeletonDance();
      return this.dancePlayer.prepare(this.modelKey);
    }

    _disposeCurrentModel() {
      this.authoredMotion?.dispose();this.authoredMotion=null;
      for(const skeleton of this.motionDressSkeletons||[])skeleton.dispose();this.motionDressSkeletons=[];
      this.dancePlayer?.release();this.behavior=null;
      this._poseHistory=null;this._supportRest=null;this._poseRootPosition=null;
      if(this._lookAtTargetObj){this.scene.remove(this._lookAtTargetObj);this._lookAtTargetObj=null;}
      if(this.garden3D){
        this.pivotGroup.remove(this.garden3D.group);
        const geometries=new Set(),materials=new Set();
        this.garden3D.group.traverse(n=>{if(n.geometry)geometries.add(n.geometry);if(n.material)materials.add(n.material);});
        for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
        this.garden3D=null;
      }
      this.secondaryMotion?.dispose();
      this.secondaryMotion = null;
      if (this.modelRoot && this.pivotGroup) {
        this.pivotGroup.remove(this.modelRoot);
      }
      if (this.vrm && VRMUtils?.deepDispose) {
        try {
          VRMUtils.deepDispose(this.vrm.scene);
        } catch {
          // Ignore disposal errors
        }
      }
      this.vrm = null;
      this.modelRoot = null;
      this.boneMap.clear();
      this.morphMeshes = [];
      this.teaPropNodes = [];
    }

    _createHandheldTeacupMesh() {
      const grp = new THREE.Group();
      grp.name = "Seraphina_DynamicTeacup";

      const porcelain = new THREE.MeshStandardMaterial({
        color: 0xfbf9f5,
        roughness: 0.25,
        metalness: 0.05
      });
      const teaMat = new THREE.MeshStandardMaterial({
        color: 0xa6622b,
        roughness: 0.15
      });
      const gold = new THREE.MeshStandardMaterial({
        color: 0xd8b356,
        roughness: 0.28,
        metalness: 0.78
      });

      const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.026, 0.011, 20), porcelain);
      saucer.position.y = -0.005;
      grp.add(saucer);

      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.024, 0.052, 20), porcelain);
      cup.position.y = 0.026;
      grp.add(cup);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.0025, 8, 20), gold);
      rim.rotation.x = Math.PI * 0.5;
      rim.position.y = 0.052;
      grp.add(rim);

      const tea = new THREE.Mesh(new THREE.CircleGeometry(0.031, 16), teaMat);
      tea.rotation.x = -Math.PI * 0.5;
      tea.position.y = 0.044;
      grp.add(tea);

      // Upright saucer & teacup cradled cleanly when rightHand holds cup (thumb +Z up)
      grp.position.set(0.0, -0.025, 0.038);
      grp.rotation.set(0, 0, 0);
      grp.scale.setScalar(1.0);
      return grp;
    }

    _setupRigFromGltf(gltf, modelMeta) {
      this._disposeCurrentModel();

      const vrm = gltf?.userData?.vrm || null;
      this.isVrmModel = Boolean(vrm);
      this.isChibiRig = gltf.asset?.extras?.characterStyle === "chibi-reference";
      this.vrm = vrm;
      this.modelInfo = modelMeta || { source: "starter", name: "model.glb" };

      if (vrm) {
        try {
          if (VRMUtils?.removeUnnecessaryVertices) {
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
          }
        } catch {
          // Safe to ignore
        }
        // VRM 0.x faces -Z, VRM 1.0 faces +Z; rotateVRM0 aligns VRM 0.x cleanly to +Z
        if (VRMUtils?.rotateVRM0) {
          VRMUtils.rotateVRM0(vrm);
        }
        this.modelRoot = vrm.scene;
      } else {
        this.modelRoot = gltf.scene;
      }

      this.pivotGroup.add(this.modelRoot);
      this.modelRoot.updateMatrixWorld(true);

      // Compute clean bounding box to normalize size & center in camera
      const box = new THREE.Box3().setFromObject(this.modelRoot);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      // Shift modelRoot so feet sit cleanly at y=0 and center X/Z at 0
      this.modelRoot.position.set(-center.x, -box.min.y, -center.z);
      this.modelRoot.updateMatrixWorld(true);

      const safeH = Math.max(0.4, size.y);
      const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
      const dist = (safeH * 1.18) / (2 * Math.tan(fovRad * 0.5));
      this.modelHeight = safeH;
      this.baseCamDist = dist;
      this.camera.position.set(0, safeH * 0.51, dist);
      this.camera.lookAt(0, safeH * 0.50, 0);

      // Maximize anisotropic filtering across all VRM / GLB textures for crisp close-up zoom
      const maxAniso = Math.min(16, this.renderer?.capabilities?.getMaxAnisotropy?.() || 8);
      this.modelRoot.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          for (const val of Object.values(mat)) {
            if (val && val.isTexture) {
              val.anisotropy = Math.max(val.anisotropy || 1, maxAniso);
              val.needsUpdate = true;
            }
          }
          const mtoonTex = mat.uniforms;
          if (mtoonTex) {
            for (const u of Object.values(mtoonTex)) {
              if (u?.value?.isTexture) {
                u.value.anisotropy = Math.max(u.value.anisotropy || 1, maxAniso);
                u.value.needsUpdate = true;
              }
            }
          }
        }
      });

      // Collect bones cleanly into normalized world-conjugate adapters
      const findNodeByNames = (rootNode, names) => {
        for (const n of names) {
          const obj = rootNode.getObjectByName(n);
          if (obj) return obj;
        }
        return null;
      };

      const keysToCollect = [...HUMANOID_BONE_KEYS, ...EXTRA_PHYSICS_BONES, "teaCupMount"];
      for (const bkey of keysToCollect) {
        let node = null;
        if (vrm && vrm.humanoid && HUMANOID_BONE_KEYS.includes(bkey)) {
          node = vrm.humanoid.getNormalizedBoneNode(bkey) || null;
        }
        if (!node) {
          node = findNodeByNames(this.modelRoot, [bkey, bkey[0].toUpperCase() + bkey.slice(1)]);
        }
        if (node) {
          const restWorldQ = new THREE.Quaternion();
          node.updateWorldMatrix(true, false);
          node.matrixWorld.decompose(new THREE.Vector3(), restWorldQ, new THREE.Vector3());
          this.boneMap.set(bkey, {
            node,
            restLocalQ: node.quaternion.clone(),
            restLocalPos: node.position.clone(),
            restWorldQ: restWorldQ.clone(),
            invRestWorldQ: restWorldQ.clone().invert(),
            isNormalizedVrm: Boolean(vrm && vrm.humanoid && HUMANOID_BONE_KEYS.includes(bkey))
          });
        }
      }

      // Measure natural rest arm drop angle so T-pose VRMs & A-pose GLBs share identical target angles!
      const measureArmDrop = (upperKey, lowerKey) => {
        const up = this.boneMap.get(upperKey)?.node;
        const lo = this.boneMap.get(lowerKey)?.node;
        if (!up || !lo) return 0;
        const p0 = new THREE.Vector3();
        const p1 = new THREE.Vector3();
        up.getWorldPosition(p0);
        lo.getWorldPosition(p1);
        const dir = p1.sub(p0);
        return Math.atan2(-dir.y, Math.max(0.01, Math.abs(dir.x)));
      };
      this.restArmDropLeft = measureArmDrop("leftUpperArm", "leftLowerArm");
      this.restArmDropRight = measureArmDrop("rightUpperArm", "rightLowerArm");

      // Measure leg length for proportional walking bounce
      const hipsRec = this.boneMap.get("hips");
      const footRec = this.boneMap.get("leftFoot");
      if (hipsRec && footRec) {
        const hp = new THREE.Vector3();
        const fp = new THREE.Vector3();
        hipsRec.node.getWorldPosition(hp);
        footRec.node.getWorldPosition(fp);
        this.legLength = clamp(Math.abs(hp.y - fp.y), 0.25, 1.4);
      } else {
        this.legLength = safeH * 0.42;
      }

      this.legSegments = {};
      for (const side of ["left", "right"]) {
        const upper = this.boneMap.get(side + "UpperLeg")?.node;
        const lower = this.boneMap.get(side + "LowerLeg")?.node;
        const foot = this.boneMap.get(side + "Foot")?.node;
        if (upper && lower && foot) {
          const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
          upper.getWorldPosition(a); lower.getWorldPosition(b); foot.getWorldPosition(c);
          this.legSegments[side] = [a.distanceTo(b), b.distanceTo(c)];
        }
      }

      // Collect morph targets & handheld teacup props
      this.modelRoot.traverse((obj) => {
        if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
          this.morphMeshes.push(obj);
        }
        if (obj.name && obj.name.startsWith("Tea_")) {
          this.teaPropNodes.push(obj);
          obj.visible = false;
        }
      });

      // If VRM lacks built-in teacup meshes, mount a dynamic 3D porcelain teacup on rightHand!
      if (this.teaPropNodes.length === 0) {
        const rightHand = this.boneMap.get("rightHand")?.node;
        if (rightHand) {
          const cupGrp = this._createHandheldTeacupMesh();
          cupGrp.visible = false;
          rightHand.add(cupGrp);
          this.teaPropNodes.push(cupGrp);
        }
      }

      // Configure VRM lookAt autoUpdate = false so our smooth cursor tracker drives it cleanly
      if (vrm?.lookAt) {
        vrm.lookAt.autoUpdate = true;
        this._lookAtTargetObj = new THREE.Object3D();
        this._lookAtTargetObj.position.set(0, safeH * 0.82, 2.5);
        this.scene.add(this._lookAtTargetObj);
        vrm.lookAt.target = this._lookAtTargetObj;
      }
      this._headWorldY = safeH * 0.82;
      if(vrm)this._fitDressSkinning();
      if(vrm)this._createMotionLining();
      this._captureSupportRest();
      if (root.WaifuSecondaryMotion) {
        this.secondaryMotion = new root.WaifuSecondaryMotion(vrm, gltf, this.pivotGroup, {
          height: safeH, enabled: this.physicsEnabled,
          strength: this.physicsStrength, chest: this.chestBounce
        });
      }
    }

    async preloadAll() {
      if (this.webglFailed) return false;
      if (!this.loadPromise) {
        const generation = this.loadGeneration = (this.loadGeneration || 0) + 1;
        this.loadPromise = (async () => {
          if(!root.WaifuAuthoredMotion)throw Error('Reload the extension to load authored 3D animations');
          const [payload,motionBuffer] = await Promise.all([this.fetchModelBuffer(),root.WaifuAuthoredMotion.fetchBuffer(this.modelKey)]);
          const loader = createVrmGltfLoader();
          const gltf = await loader.parseAsync(payload.buffer, "");
          if (this.destroyed || generation !== this.loadGeneration) {
            VRMUtils?.deepDispose?.(gltf.scene);
            return false;
          }
          this._setupRigFromGltf(gltf, { source: payload.source, name: payload.name });
          if(this.isVrmModel){
            const motion=await root.WaifuAuthoredMotion.create(this,motionBuffer);
            if(this.destroyed||generation!==this.loadGeneration){motion.dispose();return false;}
            this.authoredMotion=motion;
          }
          this.renderFrame(performance.now());
          return true;
        })().catch((err) => {
          if (this.destroyed || generation !== this.loadGeneration) return false;
          this.loadPromise = null;
          if (this.onFallback2D) this.onFallback2D(String(err?.message || err));
          return false;
        });
      }
      return this.loadPromise;
    }

    async reloadModel() {
      this.loadPromise = null;
      return this.preloadAll();
    }

    async setPose(poseId, withBounce = true) {
      const valid = ["idle", "wave", "think", "celebrate", "tea"];
      const target = valid.includes(poseId) ? poseId : "idle";
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

    // Future AI Brain API hooks
    setExpression(name, weight = 1.0) {
      this.apiExpression = name || null;
      this.apiExpressionWeight = clamp(Number(weight) || 0, 0, 1);
    }

    setMouthOpen(weight = 0) {
      this.mouthOpenWeight = clamp(Number(weight) || 0, 0, 1);
    }

    playAction(poseId, durationMs = 0) {
      this.setPose(poseId, true);
      if (durationMs > 0) {
        clearTimeout(this._actionTimer);
        this._actionTimer = setTimeout(() => {
          if (!this.destroyed) this.setPose("idle", false);
        }, durationMs);
      }
    }

    setMicroMotion(enabled) {
      if (this.microMotion === Boolean(enabled)) return;
      this.microMotion = Boolean(enabled);
      if (this.microMotion && !this.paused && !this.destroyed) {
        this.lastFrameTime = performance.now();
        this.start();
      } else {
        this.stopLoop();
        this.renderFrame(performance.now());
      }
    }

    setPhysicsOptions(enabled, strength = 0.9, chest = 1) {
      this.physicsEnabled = enabled !== false;
      this.physicsStrength = clamp(Number(strength) || 0, 0, 1);
      this.chestBounce = clamp(Number(chest) || 0, 0, 1);
      this.secondaryMotion?.setOptions(this.physicsEnabled, this.physicsStrength, this.chestBounce);
      if (!this.microMotion || this.paused) this.renderFrame(performance.now());
    }

    setDepth25D(enabled) {
      this.depth25D = Boolean(enabled);
      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
      }
    }

    setWalking(active, dirX = 0, speedPx = this.displayHeight * 0.42) {
      this.targetWalkSpeed = active ? Math.max(0, speedPx) : 0;
      this.walkTarget = active ? 1 : 0;
      if (dirX > 0.5) this.walkDir = 1;
      else if (dirX < -0.5) this.walkDir = -1;
    }

    setPaused(paused) {
      if (this.paused === Boolean(paused)) return;
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

    setHover(hovered) {
      this.hoverTarget = hovered ? 1 : 0;
    }

    setDragVelocity(vx, vy = 0) {
      this.dragVelX = clamp(vx, -36, 36);
      this.dragVelY = clamp(vy, -36, 36);
    }

    triggerBounce() {
      this.bounceStart = performance.now();
      this.secondaryMotion?.impulse(1);
    }

    _ensureOneShotRender() {
      if (!this.microMotion || this.paused) {
        this.renderFrame(performance.now());
      }
    }

    adjustZoom(factor = 1.15, focusNormY = null) {
      const next = clamp(this.targetZoomLevel * (Number(factor) || 1), 1.0, 4.0);
      this.targetZoomLevel = next;
      if (focusNormY !== null && Number.isFinite(focusNormY) && next > 1.04) {
        // Map normalized canvas Y (0=top head, 1=bottom shoes) toward character vertical focus height
        const aimY = clamp(1.0 - focusNormY, 0.16, 0.88);
        const weight = factor > 1 ? 0.35 : 0.12;
        this.targetZoomPanY = clamp(this.targetZoomPanY * (1 - weight) + aimY * weight, 0.16, 0.88);
      } else if (next <= 1.04) {
        this.targetZoomPanY = 0.50;
      }
      this._ensureOneShotRender();
      return next;
    }

    setZoom(level = 1.0) {
      this.targetZoomLevel = clamp(Number(level) || 1, 1.0, 4.0);
      if (this.targetZoomLevel <= 1.04) this.targetZoomPanY = 0.50;
      this._ensureOneShotRender();
      return this.targetZoomLevel;
    }

    adjustPanY(deltaNormY = 0) {
      this.targetZoomPanY = clamp(this.targetZoomPanY + (Number(deltaNormY) || 0), 0.16, 0.88);
      this._ensureOneShotRender();
    }

    adjustOrbit(deltaYaw = 0, deltaPitch = 0) {
      // Unconstrained 360-degree horizontal spin + smooth vertical tilt
      this.targetOrbitYaw += Number(deltaYaw) || 0;
      this.targetOrbitPitch = clamp(this.targetOrbitPitch + (Number(deltaPitch) || 0), -0.68, 0.68);
      this._ensureOneShotRender();
    }

    resetView() {
      this.targetZoomLevel = 1.0;
      this.targetZoomPanY = 0.50;
      this.targetOrbitYaw = 0;
      this.targetOrbitPitch = 0;
      this._ensureOneShotRender();
    }

    getViewState() {
      return {
        zoomLevel: this.targetZoomLevel,
        zoomPanY: this.targetZoomPanY,
        orbitYaw: this.targetOrbitYaw,
        orbitPitch: this.targetOrbitPitch
      };
    }

    start() {
      if (this.destroyed || this.rafId !== null || this.paused || !this.microMotion || this.webglFailed) {
        return;
      }
      this.lastFrameTime = performance.now();
      const tick = (now) => {
        if (this.destroyed || this.paused || !this.microMotion || this.webglFailed) {
          this.rafId = null;
          return;
        }
        if (now - this.lastFrameTime >= 1000 / (this.walkTarget ? 60 : 30) - 0.5) this.renderFrame(now);
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
      clearTimeout(this._actionTimer);
      if (this._onContextLost) {
        this.canvas.removeEventListener("webglcontextlost", this._onContextLost);
      }
      this._disposeCurrentModel();
      if (this.renderer) {
        try {
          this.renderer.dispose();
          // Detached canvases otherwise retain GPU contexts until garbage collection.
          this.renderer.forceContextLoss?.();
        } catch {
          // Ignore
        }
      }
    }

    _setBoneWorldEuler(boneKey, rx = 0, ry = 0, rz = 0, posYOffset = 0) {
      const rec = this.boneMap.get(boneKey);
      if (!rec) return;
      this._tmpEuler.set(rx, ry, rz, "XYZ");
      this._tmpDeltaQ.setFromEuler(this._tmpEuler);

      if (rec.isNormalizedVrm) {
        // Normalized VRM bones have rest identity aligned with +Z forward, +Y up
        rec.node.quaternion.copy(rec.restLocalQ).multiply(this._tmpDeltaQ);
      } else {
        // Conjugate world delta into Blender/GLB bone's own rest frame
        this._tmpConjQ.copy(rec.invRestWorldQ).multiply(this._tmpDeltaQ).multiply(rec.restWorldQ);
        rec.node.quaternion.copy(rec.restLocalQ).multiply(this._tmpConjQ);
      }

      if (posYOffset !== 0) {
        rec.node.position.set(rec.restLocalPos.x, rec.restLocalPos.y + posYOffset, rec.restLocalPos.z);
      } else if (rec.node.position.y !== rec.restLocalPos.y) {
        rec.node.position.copy(rec.restLocalPos);
      }
    }

    _solveWalkLeg(side, phase, weight, strideWorld) {
      const lengths = this.legSegments?.[side];
      if (!lengths) return null;
      const upper = lengths[0], lower = lengths[1], length = upper + lower;
      const stride = clamp(strideWorld, 0, length * 0.38);
      const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
      const stance = cycle < .56;
      const p = stance ? cycle/.56 : (cycle-.56)/.44;
      const swingEase = p * p * (3 - 2 * p);
      const z = (stance ? 0.5 - p : -0.5 + swingEase) * stride;
      // Lower the hips by the same amount as leg flexion so stance feet stay on the floor.
      const hipHeight = Math.sqrt(length * length - stride * stride * 0.25) * 0.995;
      const lift = stance ? 0 : Math.sin(p * Math.PI) ** 2 * length * .045;
      const y = -hipHeight + lift;
      const distance = clamp(Math.hypot(y, z), Math.abs(upper - lower) + 0.0001, length * 0.999);
      const knee = Math.PI - Math.acos(clamp((upper * upper + lower * lower - distance * distance) / (2 * upper * lower), -1, 1));
      const thigh = -Math.atan2(z, -y) - Math.acos(clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
      const out = this._walkLegs[side];
      out[0] = thigh * weight;
      out[1] = knee * weight;
      const footRoll=stance?(p<.2?.08*(1-p/.2):p>.8?-.10*((p-.8)/.2):0):.07*Math.sin(p*Math.PI);
      out[2] = (-thigh - knee + footRoll) * weight;
      out[3] = (length - hipHeight) * weight;
      return out;
    }

    _solveRightArm(thinkWeight, teaWeight) {
      const weight=clamp(thinkWeight+teaWeight,0,1);
      if(weight<.001)return;
      const tea=teaWeight/weight,h=this.modelHeight,sip=this.sipBlend;
      // Keep both reach targets in front of the chest, clear of the face.
      this._reachHand('right',-h*(.075*(1-tea)+(.12-sip*.045)*tea),
        h*(.77*(1-tea)+(.60+sip*.15)*tea),h*(.14*(1-tea)+(.21-sip*.11)*tea),weight,.95*(1-tea)+.3*tea,-.8*(1-tea));
    }

    _captureSupportRest() {
      this.pivotGroup.updateWorldMatrix(true,true);
      this._supportRest={};
      for(const side of ['left','right']){
        const foot=this.boneMap.get(side+'Foot')?.node;
        if(foot){const p=foot.getWorldPosition(new THREE.Vector3());this.pivotGroup.parent.worldToLocal(p);this._supportRest[side]=p.y;}
      }
      this._poseHistory=null;this._poseRootPosition=null;
    }

    // Analytic elbow plane: the shoulder owns arm twist, the elbow is a hinge.
    // Targets are in avatar space, so reaching remains correct during user orbit.
    _reachHand(side, x, y, z, weight, grip=0, wristTilt=0, wristRoll=0) {
      if(weight<.001||!this.isVrmModel)return;
      const upper=this.boneMap.get(side+'UpperArm')?.node,lower=this.boneMap.get(side+'LowerArm')?.node,hand=this.boneMap.get(side+'Hand')?.node;
      if(!upper||!lower||!hand)return;
      const k=this._reachScratch??={a:new THREE.Vector3(),b:new THREE.Vector3(),c:new THREE.Vector3(),target:new THREE.Vector3(),dir:new THREE.Vector3(),hint:new THREE.Vector3(),elbow:new THREE.Vector3(),u:new THREE.Vector3(),v:new THREE.Vector3(),normal:new THREE.Vector3(),axisX:new THREE.Vector3(),axisY:new THREE.Vector3(),matrix:new THREE.Matrix4(),q:new THREE.Quaternion(),parent:new THREE.Quaternion()};
      this.pivotGroup.updateWorldMatrix(true,true);
      upper.getWorldPosition(k.a);lower.getWorldPosition(k.b);hand.getWorldPosition(k.c);
      const l1=k.a.distanceTo(k.b),l2=k.b.distanceTo(k.c),sign=side==='left'?1:-1;
      k.target.set(x,y,z);this.pivotGroup.localToWorld(k.target);
      k.dir.copy(k.target).sub(k.a);
      const near=Math.sqrt(l1*l1+l2*l2+2*l1*l2*Math.cos(2.15)),far=(l1+l2)*.985;
      const distance=clamp(k.dir.length(),near,far);k.dir.normalize();k.target.copy(k.a).addScaledVector(k.dir,distance);
      const along=(l1*l1-l2*l2+distance*distance)/(2*distance),radius=Math.sqrt(Math.max(0,l1*l1-along*along));
      k.hint.set(sign*.65,-.7,-.25).transformDirection(this.pivotGroup.matrixWorld);
      k.hint.addScaledVector(k.dir,-k.hint.dot(k.dir)).normalize();
      k.elbow.copy(k.a).addScaledVector(k.dir,along).addScaledVector(k.hint,radius);
      k.u.copy(k.elbow).sub(k.a).normalize();k.v.copy(k.target).sub(k.elbow).normalize();
      k.axisX.copy(k.u).multiplyScalar(sign);k.normal.crossVectors(k.u,k.v).normalize().multiplyScalar(sign);k.axisY.crossVectors(k.normal,k.axisX).normalize();
      k.matrix.makeBasis(k.axisX,k.axisY,k.normal);k.q.setFromRotationMatrix(k.matrix);
      upper.parent.getWorldQuaternion(k.parent).invert();k.q.premultiply(k.parent);upper.quaternion.slerp(k.q,weight);
      const bend=Math.acos(clamp(k.u.dot(k.v),-1,1));k.q.setFromAxisAngle(k.normal.set(0,0,1),sign*bend);lower.quaternion.slerp(k.q,weight);
      this.pivotGroup.updateWorldMatrix(true,true);
      hand.parent.getWorldQuaternion(k.parent).invert();this.pivotGroup.getWorldQuaternion(k.q);k.q.premultiply(k.parent);k.q.multiply(k.parent.setFromAxisAngle(k.normal.set(0,0,1),wristTilt));k.q.multiply(k.parent.setFromAxisAngle(k.normal.set(1,0,0),wristRoll));hand.quaternion.slerp(k.q,weight);
      for(const finger of ['Index','Middle','Ring','Little'])for(const joint of ['Proximal','Intermediate','Distal']){
        const record=this.boneMap.get(side+finger+joint);if(record){k.q.setFromAxisAngle(k.normal.set(0,0,1),-sign*grip);record.node.quaternion.slerp(k.q,weight);}
      }
      for(const joint of ['Metacarpal','Proximal','Distal']){const record=this.boneMap.get(side+'Thumb'+joint);if(record){k.q.setFromAxisAngle(k.normal.set(0,0,1),-sign*grip*.25);record.node.quaternion.slerp(k.q,weight);}}
    }

    _stabilizePose(dt) {
      const history=this._poseHistory??=new Map(),q=this._poseScratchQ??=new THREE.Quaternion(),e=this._poseScratchEuler??=new THREE.Euler();
      const alpha=this.microMotion?1-Math.exp(-18*dt):1;
      for(const [key,rec]of this.boneMap){
        if(!rec.isNormalizedVrm||key.endsWith('Eye'))continue;
        if(key.endsWith('LowerArm')){
          q.copy(rec.restLocalQ).invert().multiply(rec.node.quaternion);e.setFromQuaternion(q,'XYZ');
          e.set(0,0,(key.startsWith('left')?1:-1)*clamp(Math.abs(e.z),.06,2.15));
          rec.node.quaternion.copy(rec.restLocalQ).multiply(q.setFromEuler(e));
        }
        if(key.endsWith('LowerLeg')){
          q.copy(rec.restLocalQ).invert().multiply(rec.node.quaternion);e.setFromQuaternion(q,'XYZ');
          rec.node.quaternion.copy(rec.restLocalQ).multiply(q.setFromEuler(e.set(clamp(e.x,.015,.85),0,0)));
        }
        let previous=history.get(key);
        if(!previous){previous=rec.node.quaternion.clone();history.set(key,previous);}
        const angle=previous.angleTo(rec.node.quaternion),rate=/Arm|Hand/.test(key)?4.2:/Leg|Foot/.test(key)?5:2.8;
        previous.slerp(rec.node.quaternion,this.microMotion?Math.min(alpha,angle>1e-6?rate*dt/angle:1):1);rec.node.quaternion.copy(previous);
      }
      // Keep root offsets continuous when an action is cancelled or replaced.
      this._poseRootPosition??=this.pivotGroup.position.clone();
      this._poseRootPosition.lerp(this.pivotGroup.position,alpha);this.pivotGroup.position.copy(this._poseRootPosition);
      // Correct the actual chained pose, not just an isolated leg IK solution.
      const hips=this.boneMap.get('hips')?.node;
      if(hips&&this._supportRest){
        this.pivotGroup.updateWorldMatrix(true,true);
        const p=this._supportPoint??=new THREE.Vector3();let error=Infinity;
        for(const side of ['left','right']){const foot=this.boneMap.get(side+'Foot')?.node;if(foot){foot.getWorldPosition(p);this.pivotGroup.parent.worldToLocal(p);error=Math.min(error,p.y-this._supportRest[side]);}}
        if(Number.isFinite(error)){
          p.set(0,clamp(-error,-this.modelHeight*.2,this.modelHeight*.2),0);
          this.pivotGroup.parent.getWorldQuaternion(q);p.applyQuaternion(q);hips.parent.getWorldQuaternion(q).invert();p.applyQuaternion(q);hips.position.add(p);
        }
      }
    }

    _fitDressSkinning() {
      this.motionDressFitCount=0;
      if(this.modelKey!=='seraphina'||!this.vrm?.humanoid?.getRawBoneNode)return;
      const names=['hips','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg'];
      const bones=names.map(name=>this.vrm.humanoid.getRawBoneNode(name));if(bones.some(b=>!b))return;
      this.pivotGroup.updateWorldMatrix(true,true);
      const point=new THREE.Vector3(),hips=this.pivotGroup.worldToLocal(bones[0].getWorldPosition(new THREE.Vector3())).y;
      const knee=(this.pivotGroup.worldToLocal(bones[3].getWorldPosition(new THREE.Vector3())).y+this.pivotGroup.worldToLocal(bones[4].getWorldPosition(new THREE.Vector3())).y)*.5;
      const inversePivot=new THREE.Matrix4().copy(this.pivotGroup.matrixWorld).invert();
      this.modelRoot.traverse(mesh=>{
        if(!mesh.isSkinnedMesh)return;
        const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
        if(!materials.some(material=>['Tops_01_CLOTH_02','Tops_01_CLOTH_03','Seraphina_FlashGold'].some(key=>(material?.name||'').includes(key))))return;
        const geometry=mesh.geometry.clone(),position=geometry.getAttribute('position'),skinWeight=geometry.getAttribute('skinWeight');let skinIndex=geometry.getAttribute('skinIndex');
        if(!skinIndex||!skinWeight){geometry.dispose();return;}
        // The imported garment palette can omit legs entirely because its old
        // weights only referenced cloth joints. Extend a private palette while
        // preserving the mesh's exact rest/bind transform and other meshes.
        const missing=bones.filter(b=>!mesh.skeleton.bones.includes(b));
        if(missing.length){
          const jointList=mesh.skeleton.bones.slice(),inverses=mesh.skeleton.boneInverses.map(m=>m.clone());
          const meshBind=new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld,mesh.bindMatrix.clone().invert());
          for(const bone of missing){jointList.push(bone);inverses.push(bone.matrixWorld.clone().invert().multiply(meshBind));}
          mesh.skeleton=new THREE.Skeleton(jointList,inverses);(this.motionDressSkeletons??=[]).push(mesh.skeleton);
        }
        if(mesh.skeleton.bones.length>255&&skinIndex.array.BYTES_PER_ELEMENT===1){skinIndex=new THREE.Uint16BufferAttribute(Array.from(skinIndex.array),4);geometry.setAttribute('skinIndex',skinIndex);}
        const palette=bones.map(b=>mesh.skeleton.bones.indexOf(b));
        const transform=new THREE.Matrix4().multiplyMatrices(inversePivot,mesh.matrixWorld),index=geometry.getIndex();
        const used=index?new Set(index.array):new Set(Array.from({length:position.count},(_,i)=>i));
        for(const i of used){
          point.fromBufferAttribute(position,i).applyMatrix4(transform);if(point.y>hips+.025*this.modelHeight)continue;
          const follow=1-smooth01((point.y-(hips-.14*this.modelHeight))/(.165*this.modelHeight));
          const calf=(1-smooth01((point.y-(knee-.1*this.modelHeight))/(.18*this.modelHeight)))*.45;
          const left=smooth01((point.x+.03*this.modelHeight)/(.06*this.modelHeight));
          const weights=[1-follow,follow*(1-calf)*left,follow*(1-calf)*(1-left),follow*calf*left,follow*calf*(1-left)];
          const order=[0,1,2,3,4].sort((a,b)=>weights[b]-weights[a]).slice(0,4),sum=order.reduce((s,k)=>s+weights[k],0);
          skinIndex.setXYZW(i,...order.map(k=>palette[k]));skinWeight.setXYZW(i,...order.map(k=>weights[k]/sum));
        }
        skinIndex.needsUpdate=skinWeight.needsUpdate=true;mesh.geometry=geometry;this.motionDressFitCount++;
      });
    }

    _createMotionLining() {
      // The repaired skin is continuous but the fitted garment has separate
      // panels. A thin skinned fabric underlap covers panel gaps during bends.
      // It shares the existing skin/skeleton; this is not a rigid torso shell.
      const sources=[];this.motionLiningCount=0;
      this.modelRoot.traverse(node=>{if(node.isSkinnedMesh&&node.name.includes('Repair_ContinuousTorso'))sources.push(node);});
      const spine=this.boneMap.get('spine')?.node,chest=this.boneMap.get('upperChest')?.node||this.boneMap.get('chest')?.node;
      if(!spine||!chest)return;
      this.pivotGroup.updateWorldMatrix(true,true);
      const low=this.pivotGroup.worldToLocal(spine.getWorldPosition(new THREE.Vector3())).y-.02*this.modelHeight;
      const high=this.pivotGroup.worldToLocal(chest.getWorldPosition(new THREE.Vector3())).y+.025*this.modelHeight;
      const inversePivot=new THREE.Matrix4().copy(this.pivotGroup.matrixWorld).invert(),point=new THREE.Vector3();
      for(const source of sources){
        const geometry=source.geometry.clone(),position=geometry.getAttribute('position'),heights=new Float32Array(position.count);
        const toPivot=new THREE.Matrix4().multiplyMatrices(inversePivot,source.matrixWorld),toMesh=toPivot.clone().invert();
        for(let i=0;i<position.count;i++){
          point.fromBufferAttribute(position,i).applyMatrix4(toPivot);heights[i]=point.y;
          point.x*=1.015;point.z*=1.015;point.applyMatrix4(toMesh);position.setXYZ(i,point.x,point.y,point.z);
        }
        const index=geometry.getIndex(),count=index?index.count:position.count,triangles=[];
        for(let i=0;i<count;i+=3){const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2,y=(heights[a]+heights[b]+heights[c])/3;if(y>=low&&y<=high)triangles.push(a,b,c);}
        if(!triangles.length){geometry.dispose();continue;}
        geometry.setIndex(triangles);geometry.clearGroups();position.needsUpdate=true;geometry.computeVertexNormals();
        const lining=source.clone(false);lining.name='Motion_FabricUnderlap';lining.geometry=geometry;
        lining.material=new THREE.MeshStandardMaterial({color:this.modelKey==='seraphina'?0x1e1930:0x201923,roughness:.95,side:THREE.DoubleSide});
        lining.frustumCulled=false;source.parent.add(lining);this.motionLiningCount++;
      }
    }

    _createGarden3D() {
      const group=new THREE.Group(),plant=new THREE.Group(),can=new THREE.Group(),h=this.modelHeight;
      const mat=color=>new THREE.MeshStandardMaterial({color,roughness:.8});
      const clay=mat(0xb87354),soil=mat(0x493126),green=mat(0x70aa60),metal=mat(0x78a8b6),water=mat(0x87d2f4),petal=mat(this.modelKey==='gothic_red'?0xc85c7b:0xdca9dd);
      const mesh=(geometry,material,parent,x=0,y=0,z=0)=>{const n=new THREE.Mesh(geometry,material);n.position.set(x,y,z);parent.add(n);return n;};
      const pot=new THREE.Group();group.add(pot);pot.position.set(-h*.22,h*.005,h*.17);pot.scale.setScalar(h*.075);
      mesh(new THREE.CylinderGeometry(.8,.58,1.05,16),clay,pot,0,.525);
      mesh(new THREE.TorusGeometry(.78,.09,6,20),clay,pot,0,1.05).rotation.x=Math.PI/2;
      mesh(new THREE.CylinderGeometry(.71,.71,.04,16),soil,pot,0,1.03);
      pot.add(plant);plant.position.y=1.07;
      mesh(new THREE.CylinderGeometry(.035,.05,1.7,6),green,plant,0,.85);
      const leafGeometry=new THREE.SphereGeometry(1,8,6);
      for(let i=0;i<4;i++){const sign=i%2?1:-1,n=mesh(leafGeometry,green,plant,sign*.25,.4+i*.3);n.scale.set(.4,.1,.17);n.rotation.z=sign*.4;}
      for(let i=0;i<5;i++){const a=i/5*Math.PI*2,n=mesh(leafGeometry,petal,plant,Math.cos(a)*.14,1.75+Math.sin(a)*.14);n.scale.set(.15,.13,.07);}
      group.add(can);can.scale.setScalar(h*.065);
      mesh(new THREE.CylinderGeometry(.58,.52,.85,12),metal,can,0,-.48);
      const handle=mesh(new THREE.TorusGeometry(.4,.075,6,16),metal,can,0,.02);handle.rotation.x=Math.PI/2;
      const spout=mesh(new THREE.CylinderGeometry(.09,.16,1.0,8),metal,can,-.78,-.3);spout.rotation.z=-1.0;
      const tip=new THREE.Object3D();tip.position.set(-1.22,-.02,0);can.add(tip);
      const stream=mesh(new THREE.CylinderGeometry(.003,.004,1,6),water,group);stream.visible=false;
      group.visible=false;this.pivotGroup.add(group);
      this.garden3D={group,pot,plant,can,tip,stream,point:new THREE.Vector3(),target:new THREE.Vector3(),direction:new THREE.Vector3(),up:new THREE.Vector3(0,1,0)};
    }

    _updateGarden3D(now) {
      const active=this.microMotion&&['garden','showPlant'].includes(this.behavior?.id)&&now<this.behavior.until;
      if(active&&!this.garden3D)this._createGarden3D();
      const g=this.garden3D;if(!g)return;g.group.visible=active;if(!active)return;
      const age=Math.max(0,(now-this.behavior.start)/1000),t=this.behavior.id==='showPlant'?13+age:age,end=Math.max(0,(this.behavior.until-now)/1000);
      g.pot.scale.setScalar(this.modelHeight*.075*smooth01(Math.min(age/.7,end/.7)));
      const authored=Boolean(this.authoredMotion);
      const growth=smooth01((t-(authored?7.2:6))/(authored?4.6:5));g.plant.visible=growth>0;g.plant.scale.setScalar(Math.max(.001,growth));
      const pour=authored?smooth01((t-3.4)/.5)*smooth01((6.9-t)/.5):smooth01((t-1)/.5)*smooth01((6-t)/.5);
      const carry=authored?smooth01((t-1)/.5)*smooth01((7.2-t)/.5):smooth01(t/.8)*smooth01((7-t)/.8);
      g.can.visible=carry>.001;g.can.scale.setScalar(this.modelHeight*.065*carry);
      this.pivotGroup.updateWorldMatrix(true,true);
      const hand=this.boneMap.get('rightHand')?.node;
      if(hand){hand.getWorldPosition(g.point);this.pivotGroup.worldToLocal(g.point);g.can.position.copy(g.point);g.can.rotation.z=.32*pour;}
      this.pivotGroup.updateWorldMatrix(true,true);g.tip.getWorldPosition(g.point);this.pivotGroup.worldToLocal(g.point);
      g.target.copy(g.pot.position);g.target.y+=this.modelHeight*.078;
      g.direction.copy(g.target).sub(g.point);g.stream.visible=pour>.1;
      g.stream.position.copy(g.point).add(g.target).multiplyScalar(.5);g.stream.scale.y=g.direction.length();g.stream.quaternion.setFromUnitVectors(g.up,g.direction.normalize());
    }

    _applyExpression(name, val) {
      const v = clamp(val, 0, 1);
      if (this.vrm?.expressionManager) {
        try {
          this.vrm.expressionManager.setValue(name, v);
        } catch {
          // Expression missing on custom VRM
        }
      }
      for (const mesh of this.morphMeshes) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx !== undefined) {
          mesh.morphTargetInfluences[idx] = v;
        }
      }
    }

    renderFrame(now = performance.now()) {
      if (!this.renderer || this.webglFailed) return;
      if(this.authoredMotion){this.authoredMotion.renderFrame(now);return;}
      if(this.isVrmModel)return; // Never flash a legacy pose while native motion loads.

      const dt = clamp((now - this.lastFrameTime) * 0.001, 0.001, 0.1);
      this.lastFrameTime = now;
      const t = this.microMotion?(now - this.startTime) * 0.001:0;

      if (!this.modelRoot) {
        this.renderer.render(this.scene, this.camera);
        return;
      }

      // Smoothly crossfade pose weights
      for (const key of Object.keys(this.poseWeights)) {
        const targetW = key === this.currentPose ? 1 : 0;
        this.poseWeights[key] = this.microMotion?damp(this.poseWeights[key], targetW, 5.5, dt):targetW;
      }

      this.walkSpeed = damp(this.walkSpeed, this.targetWalkSpeed, 10, dt);
      this.walkAmount = damp(this.walkAmount, this.walkTarget && this.microMotion ? clamp(this.walkSpeed / 16, 0, 1) : 0, 7, dt);
      if(!this.microMotion){this.walkAmount=0;this.walkSpeed=0;this.walkYaw=0;}
      this.hoverBoost = damp(this.hoverBoost, this.hoverTarget, 11, dt);
      this.smoothDragLag = damp(this.smoothDragLag, this.dragVelX, 11, dt);
      this.dragVelX *= Math.exp(-10 * dt);
      this.dragVelY *= Math.exp(-10 * dt);

      this.lookX = damp(this.lookX, this.microMotion ? this.targetLookX : 0, 7, dt);
      this.lookY = damp(this.lookY, this.microMotion ? this.targetLookY : 0, 7, dt);
      this.eyeX = damp(this.eyeX, this.microMotion ? this.targetEyeX : 0, 18, dt);
      this.eyeY = damp(this.eyeY, this.microMotion ? this.targetEyeY : 0, 18, dt);

      this.zoomLevel = damp(this.zoomLevel, this.targetZoomLevel, 14, dt);
      this.zoomPanY = damp(this.zoomPanY, this.targetZoomPanY, 12, dt);
      this.orbitYaw = damp(this.orbitYaw, this.targetOrbitYaw, 14, dt);
      this.orbitPitch = damp(this.orbitPitch, this.targetOrbitPitch, 14, dt);

      if (this.walkAmount > 0.02) {
        const speedInBodyHeights = this.walkSpeed / this.displayHeight;
        const cadenceForStride = speedInBodyHeights * this.modelHeight / (0.90 * Math.max(0.1, this.legLength) * 0.76);
        this.walkCadence = clamp(Math.max(.72 + speedInBodyHeights * .45, cadenceForStride), .72, 1.6);
        this.walkPhase += dt * this.walkCadence * Math.PI * 2;
      }

      // Seductive 3/4 runway catwalk angle (~45 deg) when strolling, plus subtle front-facing cursor sway when idle
      const frontFacing = Math.max(0, Math.cos(this.orbitYaw));
      const targetYaw =
        (this.walkAmount > 0.05 ? this.walkDir * 1.08 * this.walkAmount : 0) +
        (this.depth25D && this.microMotion ? this.lookX * 0.16 * frontFacing : 0) -
        clamp(this.smoothDragLag * 0.015, -0.35, 0.35);
      const nextYaw=damp(this.walkYaw,targetYaw,7,dt);
      this.walkYaw+=clamp(nextYaw-this.walkYaw,-1.6*dt,1.6*dt);

      // Update camera distance, vertical focus target & orbital elevation
      const safeH = this.modelHeight || 1.35;
      const baseDist = this.baseCamDist || 3.0;
      const zBlend = clamp((this.zoomLevel - 1.0) * 1.15, 0, 1);
      const focusY = safeH * (0.50 * (1 - zBlend) + this.zoomPanY * zBlend);
      const camDist = baseDist / Math.max(1.0, this.zoomLevel);
      const camPitch = this.orbitPitch + (this.depth25D && this.microMotion ? this.lookY * 0.05 * frontFacing : 0);
      this.camera.position.set(
        0,
        focusY + Math.sin(camPitch) * camDist,
        Math.cos(camPitch) * camDist
      );
      this.camera.lookAt(0, focusY, 0);

      // Compute Blink value (natural random + double blinks)
      let blinkVal = 0;
      if (this.microMotion) {
        if (now >= this.nextBlinkAt && this.blinkUntil < now) {
          this.blinkUntil = now + 150;
          if (!this.doubleBlinkQueued && Math.random() < 0.22) {
            this.doubleBlinkQueued = true;
            this.nextBlinkAt = now + 230;
          } else {
            this.doubleBlinkQueued = false;
            this.nextBlinkAt = now + 2300 + Math.random() * 2900;
          }
        }
        if (now <= this.blinkUntil) {
          const p = (this.blinkUntil - now) / 150;
          blinkVal = Math.sin(p * Math.PI);
        }
      }

      if(this._danceRootBase){this.pivotGroup.position.copy(this._danceRootBase);}
      // Accumulate anatomical targets; the adapter maps them into each rig's local frame.
      const wIdle = this.poseWeights.idle;
      const wWave = this.poseWeights.wave * (1 - this.walkAmount);
      const wThink = this.poseWeights.think * (1 - this.walkAmount);
      const wCheer = this.poseWeights.celebrate * (1 - this.walkAmount);
      const wTea = this.poseWeights.tea * (1 - this.walkAmount);
      const wWalk = this.walkAmount;
      const standWeight = 1 - wWalk;
      this.secondaryMotion?.update(dt, t, this.walkPhase, wWalk, wCheer,
        this.dragVelX * 60 / this.displayHeight,
        this.dragVelY * 60 / this.displayHeight, this.microMotion && !this.paused);


      const breath = this.microMotion ? Math.sin(t * 2.15) : 0;
      const gentleSway = this.microMotion ? Math.sin(t * 1.1) : 0;

      // Seraphina's fitted gown extends beyond the old wrist path. Keep her
      // relaxed arms clear of the skirt instead of burying the hands inside it.
      const armDown = this.modelKey === 'seraphina' ? 1.20 : 1.35;
      let lArmRx = 0, lArmRy = 0, lArmRz = -(armDown - this.restArmDropLeft);
      let lForeRx = 0, lForeRy = -0.18, lForeRz = 0;

      let rArmRx = 0, rArmRy = 0, rArmRz = +(armDown - this.restArmDropRight);
      let rForeRx = 0, rForeRy = +0.18, rForeRz = 0;

      let hipsPy = this.microMotion
        ? (Math.sin(t * 3.5) * 0.0045 + Math.cos(t * 2.15) * 0.002) * standWeight * this.legLength
        : 0;
      let hipsRx = 0, hipsRy = 0, hipsRz = 0;
      let spineRx = breath * 0.008, spineRy = 0, spineRz = 0;
      let chestRx = breath * 0.012, chestRy = 0, chestRz = 0;
      let headRx = this.lookY * 0.14 + breath * 0.02, headRy = this.lookX * 0.22 * frontFacing, headRz = gentleSway * 0.03;

      let lThighRx = 0, lThighRz = -0.02, lKneeRx = 0.04, lFootRx = 0;
      let rThighRx = 0, rThighRz = +0.02, rKneeRx = 0.04, rFootRx = 0;

      if (this.secondaryMotion) {
        const inertia = this.secondaryMotion.channels;
        spineRx += inertia[3].x * 0.35;
        chestRx += inertia[3].x * 0.65;
        spineRz += inertia[4].x * 0.35;
        chestRz += inertia[4].x * 0.65;
        headRx -= inertia[3].x * 0.20;
        headRz -= inertia[4].x * 0.25;
      }

      // IDLE gentle poise
      lArmRz += wIdle * gentleSway * 0.03;
      rArmRz -= wIdle * gentleSway * 0.03;

      // Confident adult poise: small asymmetric weight shift, open shoulders and a soft chin tilt.
      const poise = wIdle * standWeight;
      hipsRz += (0.025 + gentleSway * 0.008) * poise;
      hipsRy -= 0.035 * poise;
      spineRz -= 0.018 * poise;
      chestRy += 0.025 * poise;
      headRz -= 0.045 * poise;
      headRx -= 0.025 * poise;
      lArmRy -= 0.07 * poise;
      rArmRy += 0.04 * poise;

      // WAVE pose: Right arm lifted gracefully beside head, forearm waving side-to-side
      if (wWave > 0.01) {
        const waveOsc = Math.sin(t * 5.2) * 0.16;
        const tArmRaise = -(0.35 + this.restArmDropRight); // raised ~20 deg above shoulder horizontal
        rArmRz += wWave * (tArmRaise - (armDown - this.restArmDropRight));
        rArmRx += wWave * -0.22;
        rArmRy += wWave * 0.24;
        rForeRy += wWave * (0.42 + waveOsc * 0.35);
        rForeRz += wWave * (-1.28 + waveOsc);
        headRz += wWave * 0.09;
      }

      // THINK pose: Right arm raised thoughtfully near chin, head tilted
      if (wThink > 0.01) {
        const thinkPulse = Math.sin(t * 1.9) * 0.03;
        rArmRx += wThink * -0.20;
        rArmRy += wThink * 0.08;
        rArmRz += wThink * (1.18 - armDown);
        rForeRy += wThink * -0.12;
        rForeRz += wThink * -2.68;
        headRx += wThink * (0.12 + thinkPulse);
        headRy += wThink * -0.08;
        headRz += wThink * -0.14;
        chestRx += wThink * 0.06;
      }

      // CELEBRATE pose: Both arms cheerful V-raise + rhythmic bounce
      if (wCheer > 0.01) {
        const pump = Math.sin(t * 4.2) * 0.07;
        const hop = (1 - Math.cos(t * 4.2)) * 0.006 * this.legLength;
        lArmRz += wCheer * (+(0.62 + this.restArmDropLeft) + pump - (-(armDown - this.restArmDropLeft)));
        lArmRx += wCheer * -0.25;
        lForeRy += wCheer * -0.48;
        rArmRz += wCheer * (-(0.62 + this.restArmDropRight) - pump - (+(armDown - this.restArmDropRight)));
        rArmRx += wCheer * -0.25;
        rForeRy += wCheer * +0.48;
        hipsPy += wCheer * hop;
        headRx += wCheer * -0.06;
        chestRx += wCheer * -0.05;
      }

      // TEA pose: Right hand holds 3D teacup comfortably, periodic calm sip cycle
      const teacupVisible = wTea > 0.08 && wWalk < 0.7;
      if (wTea > 0.01) {
        const sipCycle = (t * 0.125) % 1;
        const targetSip = smooth01((sipCycle-.45)/.13)*smooth01((.84-sipCycle)/.14);
        this.sipBlend = damp(this.sipBlend, targetSip, 8, dt);

        rArmRx += wTea * (-0.18 - this.sipBlend * 0.10);
        rArmRy += wTea * 0.08;
        rArmRz += wTea * (1.20 - armDown - this.sipBlend * 0.16);
        rForeRy += wTea * -0.10;
        rForeRz += wTea * (-2.05 - this.sipBlend * 0.48);
        headRx += wTea * (0.04 + this.sipBlend * 0.16);
      } else {
        this.sipBlend = damp(this.sipBlend, 0, 8, dt);
      }

      for (const tp of this.teaPropNodes) {
        tp.visible = teacupVisible;
        if (teacupVisible) {
          tp.scale.setScalar(clamp((wTea - 0.08) * 1.15, 0.01, 1.0));
        }
      }

      // Restrained alternating gait. Swing knees flex only while that foot travels forward.
      if (wWalk > 0.001) {
        const phase = this.walkPhase;
        const swing = Math.cos(phase);
        const leftLift = Math.max(0, Math.cos(phase));
        const rightLift = Math.max(0, -Math.cos(phase));
        const stride = 0.30 * wWalk;
        lThighRx = -swing * stride;
        rThighRx = swing * stride;
        lThighRz = -.018*wWalk;
        rThighRz = .018*wWalk;
        lKneeRx = (0.035 + leftLift * leftLift * 0.48) * wWalk;
        rKneeRx = (0.035 + rightLift * rightLift * 0.48) * wWalk;
        lFootRx = -lThighRx - lKneeRx + leftLift * 0.13 * wWalk;
        rFootRx = -rThighRx - rKneeRx + rightLift * 0.13 * wWalk;
        const strideWorld = this.walkSpeed * this.modelHeight / (this.displayHeight * 0.90) * 0.5 / this.walkCadence;
        const left = this._solveWalkLeg("left", phase, wWalk, strideWorld);
        const right = this._solveWalkLeg("right", phase + Math.PI, wWalk, strideWorld);
        if (left) { lThighRx = left[0]; lKneeRx = left[1]; lFootRx = left[2]; }
        if (right) { rThighRx = right[0]; rKneeRx = right[1]; rFootRx = right[2]; }
        if (left && right) hipsPy -= (left[3] + right[3]) * 0.5;
        hipsRz += swing * .032 * wWalk;
        hipsRy += -swing * .06 * wWalk;
        hipsPy += (Math.cos(phase * 2) - 1) * 0.001 * this.legLength * wWalk;
        spineRy += swing * 0.025 * wWalk;
        spineRz -= swing * 0.018 * wWalk;
        chestRy += swing * 0.02 * wWalk;
        headRy *= 1 - wWalk * 0.8;
        headRz *= 1 - wWalk;
        lArmRx = lArmRx * standWeight + swing * .18 * wWalk;
        rArmRx = rArmRx * standWeight - swing * .18 * wWalk;
        lForeRy = -0.16;
        rForeRy = 0.16;
        lForeRz=(.16+.04*Math.max(0,swing))*wWalk;
        rForeRz=-(.16+.04*Math.max(0,-swing))*wWalk;
      }

      const gardenActive=this.microMotion&&wWalk<.1&&this.behavior?.id==='garden'&&now<this.behavior.until;
      const gardenT=gardenActive?Math.max(0,(now-this.behavior.start)/1000):0;
      const gardenWork=gardenActive?smooth01(gardenT/1.2)*smooth01((11.5-gardenT)/1.5):0;
      if(gardenActive){
        hipsRx+=gardenWork*.08;spineRx+=gardenWork*.16;chestRx+=gardenWork*.06;
        headRx+=gardenWork*.16;headRy*=1-gardenWork;headRz*=1-gardenWork;
        lThighRx=-gardenWork*.08;rThighRx=-gardenWork*.08;lKneeRx=.04+gardenWork*.16;rKneeRx=.04+gardenWork*.16;
        lFootRx=-lThighRx-lKneeRx-hipsRx;rFootRx=-rThighRx-rKneeRx-hipsRx;
      }
      if(this.microMotion && wWalk<.1 && !['dance','garden','showPlant'].includes(this.behavior?.id)){
        const motion=globalThis.WAIFU_SHARED?.behaviorMotion?.(this.behavior,now);
        if(motion){
          hipsRz+=motion.roll;hipsRy+=motion.turn;hipsPy-=motion.y*this.legLength;
          spineRx+=motion.bend;headRx-=motion.bend*.5;headRy+=motion.turn*.3;
          lArmRz+=Math.max(0,motion.arm)*.6;rArmRz-=Math.max(0,motion.arm)*.6;
          lForeRy-=Math.max(0,motion.arm)*.6;rForeRy+=Math.max(0,motion.arm)*.6;
          if(motion.arm<0){lArmRx-=motion.weight*.22;rArmRx-=motion.weight*.22;lForeRz+=motion.weight*1.1;rForeRz-=motion.weight*1.1;}
        }
      }

      // Lively tactile click / pose-switch bounce driving Bust & Glute SpringBones
      const bounceAge = (now - this.bounceStart) * 0.001;
      if (this.microMotion && bounceAge >= 0 && bounceAge < 0.62) {
        const decay = Math.exp(-5.4 * bounceAge);
        const osc = Math.sin(bounceAge * 26);
        hipsPy += ((0.5 - 0.5 * Math.cos(bounceAge * 26)) * 0.075 + osc * 0.018) * decay * this.legLength * 0.22;
        chestRx += osc * 0.018 * decay;
        hipsRx += -osc * 0.04 * decay;
      }

      // Drag inertia tilt
      const dragLean = clamp(this.smoothDragLag * 0.012, -0.22, 0.22);
      hipsRz += dragLean * 0.45;
      spineRz += dragLean * 0.55;

      // Combine unconstrained 360-degree user orbit + walk orientation!
      this.pivotGroup.rotation.y = this.orbitYaw + this.walkYaw;
      if (this.depth25D && this.microMotion) {
        this.pivotGroup.rotation.x = this.lookY * 0.06 * frontFacing;
      } else {
        this.pivotGroup.rotation.x = 0;
      }

      this._setBoneWorldEuler("hips", hipsRx, hipsRy, hipsRz, hipsPy);
      this._setBoneWorldEuler("spine", spineRx, spineRy, spineRz);
      this._setBoneWorldEuler("chest", chestRx, chestRy, chestRz);
      const breathPhase = this.microMotion?Math.sin(t * 2.15):0;
      const walkSwing = Math.cos(this.walkPhase) * this.walkAmount;
      this._setBoneWorldEuler(
        "upperChest",
        chestRx * 0.42 + breathPhase * 0.006,
        chestRy * 0.32 - walkSwing * 0.06,
        chestRz * 0.28
      );
      this._setBoneWorldEuler("neck", headRx * 0.34, headRy * 0.38, headRz * 0.32);
      this._setBoneWorldEuler("head", headRx * 0.88, headRy * 0.84, headRz * 0.88);

      const shBreath = breathPhase * 0.016 + this.hoverBoost * 0.025 + wCheer * 0.04;
      const shCatwalk = Math.sin(this.walkPhase) * 0.012 * wWalk;
      this._setBoneWorldEuler("leftShoulder", 0, -walkSwing * 0.04, -0.02 - shBreath - shCatwalk);
      this._setBoneWorldEuler("rightShoulder", 0, -walkSwing * 0.04, +0.02 + shBreath + shCatwalk);
      this._setBoneWorldEuler("leftUpperArm", lArmRx, lArmRy, lArmRz);
      this._setBoneWorldEuler("leftLowerArm", lForeRx, lForeRy, lForeRz);
      this._setBoneWorldEuler(
        "leftHand",
        (this.microMotion?Math.sin(t * 2.5 + 0.6) * 0.025:0) - Math.cos(this.walkPhase) * 0.04 * wWalk,
        0,
        0.04 + wWave * Math.sin(t * 6.4) * 0.12
      );
      this._setBoneWorldEuler("rightUpperArm", rArmRx, rArmRy, rArmRz);
      this._setBoneWorldEuler("rightLowerArm", rForeRx, rForeRy, rForeRz);
      this._setBoneWorldEuler(
        "rightHand",
        (this.microMotion?Math.sin(t * 2.5 + 1.4) * 0.025:0) + Math.cos(this.walkPhase) * 0.04 * wWalk,
        0,
        -0.04 - wCheer * Math.sin(t * 6.0) * 0.10
      );

      this._setBoneWorldEuler("leftUpperLeg", lThighRx, 0, lThighRz);
      this._setBoneWorldEuler("leftLowerLeg", lKneeRx, 0, 0);
      this._setBoneWorldEuler("leftFoot", lFootRx, 0, 0);
      this._setBoneWorldEuler("rightUpperLeg", rThighRx, 0, rThighRz);
      this._setBoneWorldEuler("rightLowerLeg", rKneeRx, 0, 0);
      this._setBoneWorldEuler("rightFoot", rFootRx, 0, 0);

      for(const finger of FINGER_BONE_KEYS)this._setBoneWorldEuler(finger,0,0,0);
      this._solveRightArm(wThink, wTea);
      if(wWave>.001){const h=this.modelHeight;this._reachHand('right',-h*(.23+Math.sin(t*4)*.012),h*.87,h*.14,wWave,0,-Math.PI/2+Math.sin(t*4)*.12,-Math.PI/2);}
      if(gardenActive){
        const carry=smooth01(gardenT/1.2)*smooth01((7-gardenT)/1);
        const h=this.modelHeight,pour=smooth01((gardenT-1)/1);
        this._reachHand('right',-h*.20,h*(.43-.09*pour),h*.23,carry,.85);
        this._reachHand('left',h*.14,h*.43,h*.12,gardenWork,.25);
      }
      if(this.microMotion&&wWalk<.1&&now<(this.behavior?.until||0)){
        const age=(now-this.behavior.start)/1000,remaining=(this.behavior.until-now)/1000,h=this.modelHeight,envelope=smooth01(age/.8)*smooth01(remaining/.7);
        if(['pout','sidestep'].includes(this.behavior.id)){
          this._reachHand('left',-h*.08,h*.58,h*.23,envelope,.45);
          this._reachHand('right',h*.08,h*.61,h*.26,envelope,.45);
        }
        const present=this.behavior.id==='showPlant'?envelope:gardenActive?smooth01((gardenT-11.5)/1.0)*smooth01(remaining/.7):0;
        if(present)this._reachHand('right',-h*.20,h*.38,h*.16,present,.06,-.35);
      }

      if(this.behavior?.id==='dance' && now<this.behavior.until && this.microMotion && wWalk<.1){
        this.dancePlayer?.apply(this,this.behavior,now);
      }
      this._stabilizePose(dt);

      // 3D Eyeball tracking (VRM lookAt OR normalized eye bones on starter GLB)
      if (this.vrm?.lookAt && this._lookAtTargetObj) {
        this._lookAtTargetObj.position.set(
          this.eyeX * 0.95,
          (this._headWorldY || 1.0) - this.eyeY * 0.55 - gardenWork*this.modelHeight*.45,
          2.2
        );
      } else {
        this._setBoneWorldEuler("leftEye", this.eyeY * 0.16, this.eyeX * 0.24, 0);
        this._setBoneWorldEuler("rightEye", this.eyeY * 0.16, this.eyeX * 0.24, 0);
      }

      // Spring physics for Hair, Skirt, Bust & Glutes (clamped fixed substeps prevent jitter)
      if (this.vrm) {
        const substeps = Math.max(1, Math.ceil(dt * 60));
        const stepDt = dt / substeps;
        for (let s = 0; s < substeps; s++) {
          this.vrm.update(stepDt);
        }
      } else {
        // Real damped spring physics on HairBack/Left/Right & Skirt bones for starter GLB
        const targetHairZ =
          -this.smoothDragLag * 0.025 +
          this.walkDir * this.walkAmount * 0.22 +
          Math.sin(t * 2.2) * 0.04;
        const targetHairX = Math.abs(this.walkAmount) * 0.18 + Math.cos(t * 1.8) * 0.035;

        const stiffness = 68;
        const damping = 7.5;
        this.hairVelZ += ((targetHairZ - this.hairAngleZ) * stiffness - this.hairVelZ * damping) * dt;
        this.hairAngleZ = clamp(this.hairAngleZ + this.hairVelZ * dt, -0.55, 0.55);

        this.hairVelX += ((targetHairX - this.hairAngleX) * stiffness - this.hairVelX * damping) * dt;
        this.hairAngleX = clamp(this.hairAngleX + this.hairVelX * dt, -0.35, 0.55);

        this._setBoneWorldEuler("HairBack1", this.hairAngleX * 0.5, 0, this.hairAngleZ * 0.55);
        this._setBoneWorldEuler("HairBack2", this.hairAngleX * 0.85, 0, this.hairAngleZ * 0.9);
        this._setBoneWorldEuler("HairLeft1", this.hairAngleX * 0.4, 0, this.hairAngleZ * 0.5 - this.hoverBoost * 0.06);
        this._setBoneWorldEuler("HairLeft2", this.hairAngleX * 0.65, 0, this.hairAngleZ * 0.85);
        this._setBoneWorldEuler("HairRight1", this.hairAngleX * 0.4, 0, this.hairAngleZ * 0.5 + this.hoverBoost * 0.06);
        this._setBoneWorldEuler("HairRight2", this.hairAngleX * 0.65, 0, this.hairAngleZ * 0.85);

        const skirtStride = Math.abs(Math.sin(this.walkPhase)) * 0.20 * this.walkAmount;
        const skirtSwishZ = Math.sin(this.walkPhase) * 0.185 * this.walkAmount;
        this._setBoneWorldEuler("SkirtFront", -skirtStride * 0.85 - this.hairAngleX * 0.25, 0, skirtSwishZ + this.hairAngleZ * 0.35);
        this._setBoneWorldEuler("SkirtBack", +skirtStride * 0.70 + this.hairAngleX * 0.30, 0, skirtSwishZ + this.hairAngleZ * 0.35);
      }

      this.secondaryMotion?.apply();
      this._updateGarden3D(now);

      // Expressions: Blink + Pose Emotion + AI Brain Overrides
      const softGaze = (wIdle * 0.015 + wTea * 0.025) * (1 - wWalk);
      this._applyExpression("blink", Math.max(blinkVal, softGaze));
      const happyVal = Math.max(
        wIdle * (0.06 + this.hoverBoost * 0.07) + wWave * 0.38 + wCheer * 0.85,
        this.behavior?.id==='dance' && now<this.behavior.until ? .2 : 0,
        this.apiExpression === "happy" ? this.apiExpressionWeight : 0
      );
      this._applyExpression("happy", happyVal);
      this._applyExpression(
        "relaxed",
        Math.max(wTea * 0.22 + wIdle * 0.015, this.apiExpression === "relaxed" ? this.apiExpressionWeight : 0)
      );
      if (this.apiExpression && !["happy", "relaxed", "blink"].includes(this.apiExpression)) {
        this._applyExpression(this.apiExpression, this.apiExpressionWeight);
      }
      this._applyExpression("aa", this.mouthOpenWeight);
      // Reset asymmetric blink channels each frame so cancelling a wink is safe.
      this._applyExpression('blinkLeft',0);this._applyExpression('blinkRight',0);
      if(this.behavior?.id==='dance' && now<this.behavior.until&&this.microMotion&&wWalk<.1)this.dancePlayer?.applyFace(this,this.behavior,now);

      this.renderer.render(this.scene, this.camera);
    }
  }

  root.WaifuVrmAnimator = WaifuVrmAnimator;
})(typeof globalThis !== "undefined" ? globalThis : window);

