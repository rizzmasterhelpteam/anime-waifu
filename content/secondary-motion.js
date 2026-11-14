(function (root) {
  "use strict";
  const THREE = root.WAIFU_VRM_VENDOR?.THREE;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  class WaifuSecondaryMotion {
    constructor(vrm, gltf, pivot, options = {}) {
      this.vrm = vrm;
      this.pivot = pivot;
      this.height = options.height || 1.3;
      this.enabled = options.enabled !== false;
      this.strength = clamp(options.strength ?? 0.9, 0, 1);
      this.chestStrength = clamp(options.chest ?? 1, 0, 1);
      this.bones = [];
      this.nativeRest = [];
      this.previousVx = 0;
      this.previousVy = 0;
      this.accelX = 0;
      this.accelY = 0;
      this.lastStep = -1;
      // Each channel stores displacement and velocity; integration uses bounded 120 Hz substeps.
      this.channels = [
        { x: 0, v: 0, hz: 3.2, damping: 0.48, limit: 0.015 }, // chest vertical, fractions of height
        { x: 0, v: 0, hz: 3.5, damping: 0.55, limit: 0.007 }, // chest depth
        { x: 0, v: 0, hz: 3.0, damping: 0.55, limit: 0.006 }, // chest lateral
        { x: 0, v: 0, hz: 2.3, damping: 0.52, limit: 0.13 },  // torso pitch, radians
        { x: 0, v: 0, hz: 2.0, damping: 0.55, limit: 0.11 },  // torso roll
        { x: 0, v: 0, hz: 2.0, damping: 0.46, limit: 0.075 }, // cloth pitch
        { x: 0, v: 0, hz: 1.8, damping: 0.48, limit: 0.055 }, // cloth sway
        { x: 0, v: 0, hz: 3.0, damping: 0.32, limit: 0.23 },  // accessories pitch
        { x: 0, v: 0, hz: 2.7, damping: 0.35, limit: 0.20 }   // accessories sway
      ];
      this.targets = new Float64Array(this.channels.length);
      this.euler = new THREE.Euler();
      this.deltaQ = new THREE.Quaternion();
      this.tmpQ = new THREE.Quaternion();
      this.pivotQ = new THREE.Quaternion();
      this.offset = new THREE.Vector3();
      const json = gltf.parser?.json || {};
      const nodeMap = new Map();
      gltf.scene.traverse(node => {
        const index = gltf.parser?.associations?.get(node)?.nodes;
        if (Number.isInteger(index)) nodeMap.set(index, node);
      });
      const resolve = index => nodeMap.get(index) || gltf.scene.getObjectByName(json.nodes?.[index]?.name || "");
      const metadata = gltf.asset?.extras?.secondaryMotion || json.asset?.extras?.secondaryMotion;
      pivot.getWorldQuaternion(this.pivotQ).invert();
      for (const item of metadata?.bones || []) {
        const node = resolve(item.node);
        if (!node) continue;
        node.updateWorldMatrix(true, false);
        const restWorld = node.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.pivotQ);
        this.bones.push({
          ...item, node, restQ: node.quaternion.clone(), restP: node.position.clone(),
          restWorld, invRestWorld: restWorld.clone().invert()
        });
      }
      const recorded = new Set();
      for (const spring of json.extensions?.VRMC_springBone?.springs || []) {
        for (const item of spring.joints || []) {
          const node = resolve(item.node);
          if (node && !recorded.has(node)) {
            recorded.add(node);
            this.nativeRest.push({ node, q: node.quaternion.clone(), p: node.position.clone() });
          }
        }
      }
      // Humanoid and expression updates continue when physics is off; spring simulation pauses.
      const manager = vrm?.springBoneManager;
      if (manager?.update) {
        this.manager = manager;
        this.nativeUpdate = manager.update;
        const self = this;
        manager.update = function (dt) {
          if (self.enabled && self.strength > 0 && self.running !== false) self.nativeUpdate.call(this, dt);
        };
      }
    }

    setOptions(enabled, strength, chest) {
      const next = enabled !== false;
      const amount = clamp(Number(strength) || 0, 0, 1);
      const chestAmount = clamp(Number(chest) || 0, 0, 1);
      if ((!next || amount === 0) && (this.enabled || this.strength > 0)) this.reset(true);
      if (chestAmount === 0 && this.chestStrength > 0) {
        for (let i = 0; i < 3; i++) this.channels[i].x = this.channels[i].v = 0;
      }
      this.enabled = next;
      this.strength = amount;
      this.chestStrength = chestAmount;
    }

    restoreOwned() {
      for (const b of this.bones) {
        b.node.quaternion.copy(b.restQ);
        b.node.position.copy(b.restP);
      }
    }

    reset(native = false) {
      for (const s of this.channels) s.x = s.v = 0;
      this.targets.fill(0);
      this.previousVx = this.previousVy = this.accelX = this.accelY = 0;
      this.lastStep = -1;
      this.restoreOwned();
      if (native) for (const r of this.nativeRest) {
        r.node.quaternion.copy(r.q); r.node.position.copy(r.p);
      }
      if (native && this.manager?.reset) this.manager.reset();
    }

    impulse(amount = 1) {
      if (!this.enabled || !this.running || this.strength === 0) return;
      const gain = clamp(amount, 0, 1.5) * this.strength;
      this.channels[0].v += 0.32 * gain * this.chestStrength;
      this.channels[1].v -= 0.07 * gain * this.chestStrength;
      this.channels[3].v += 0.17 * gain;
      this.channels[5].v -= 0.10 * gain;
      this.channels[7].v += 0.40 * gain;
    }

    update(dt, t, phase, walk, cheer, dragX, dragY, running) {
      this.running = running;
      this.restoreOwned();
      if (!running || !this.enabled || this.strength === 0) {
        this.reset(!running);
        return;
      }
      dt = clamp(dt, 0.001, 0.1);
      const filter = 1 - Math.exp(-12 * dt);
      this.accelX += (clamp((dragX - this.previousVx) / dt, -18, 18) - this.accelX) * filter;
      this.accelY += (clamp((dragY - this.previousVy) / dt, -18, 18) - this.accelY) * filter;
      this.previousVx = dragX; this.previousVy = dragY;
      const step = Math.floor(phase / Math.PI);
      if (walk > 0.15 && step !== this.lastStep && this.lastStep !== -1) {
        this.channels[0].v += 0.02 * walk * this.strength * this.chestStrength;
        this.channels[5].v += 0.04 * walk * this.strength;
        this.channels[7].v += 0.08 * walk * this.strength;
      }
      this.lastStep = walk > 0.1 ? step : -1;
      const gain = this.strength, chest = gain * this.chestStrength;
      const stride = Math.sin(phase), footfall = Math.sin(phase * 2);
      const targets = this.targets;
      targets[0] = (footfall * walk * 0.0045 + Math.sin(t * 4.2) * cheer * 0.007 - this.accelY * 0.0003 + Math.sin(t * 2.1) * 0.00065) * chest;
      targets[1] = (Math.sin(phase * 2 - 0.7) * walk * 0.0018 + this.accelY * 0.0002) * chest;
      targets[2] = (-this.accelX * 0.00035 + stride * walk * 0.0008) * chest;
      targets[3] = (this.accelY * 0.003 + footfall * walk * 0.010 + cheer * Math.sin(t * 4.2) * 0.015) * gain;
      targets[4] = (-this.accelX * 0.004 + stride * walk * 0.006) * gain;
      targets[5] = (-footfall * walk * 0.012 - this.accelY * 0.0015) * gain;
      targets[6] = (-this.accelX * 0.0015 + stride * walk * 0.010) * gain;
      targets[7] = (footfall * walk * 0.035 - this.accelY * 0.004 + Math.sin(t * 1.4) * 0.006) * gain;
      targets[8] = (-this.accelX * 0.004 + stride * walk * 0.025) * gain;
      this.channels[0].damping = 0.48 + walk * 0.16;
      const count = Math.ceil(dt * 120), h = dt / count;
      for (let n = 0; n < count; n++) {
        for (let i = 0; i < this.channels.length; i++) {
          const s = this.channels[i], omega = Math.PI * 2 * s.hz;
          s.v += ((targets[i] - s.x) * omega * omega - 2 * s.damping * omega * s.v) * h;
          s.v = clamp(s.v, -3, 3);
          s.x += s.v * h;
          if (Math.abs(s.x) > s.limit) {
            s.x = clamp(s.x, -s.limit, s.limit);
            if (s.v * s.x > 0) s.v *= -0.12;
          }
        }
      }
    }

    apply() {
      if (!this.running || !this.enabled || this.strength === 0) return;
      const s = this.channels, h = this.height;
      this.pivot.getWorldQuaternion(this.pivotQ);
      for (const b of this.bones) {
        let rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0;
        if (b.group === "chest") {
          const link = b.link ? 0.3 : 0.7;
          x = s[2].x * link; y = s[0].x * link; z = s[1].x * link;
          rx = -s[0].x * 2.0 * link; rz = s[2].x * 2.0 * link;
        } else if (b.group === "cloth") {
          rx = s[5].x * (0.75 + b.front * 0.25);
          rz = s[6].x * (0.8 + b.side * 0.2);
        } else if (b.group === "earring") {
          rx = s[7].x; rz = s[8].x * (0.9 + b.side * 0.1);
        } else if (b.group === "pendant") {
          rx = s[7].x * 0.55; rz = s[8].x * 0.55;
        } else if (b.group === "bow") {
          rx = s[7].x * 0.65; rz = s[8].x * 0.8;
        }
        this.euler.set(rx, ry, rz, "XYZ"); this.deltaQ.setFromEuler(this.euler);
        this.tmpQ.copy(b.invRestWorld).multiply(this.deltaQ).multiply(b.restWorld);
        b.node.quaternion.copy(b.restQ).multiply(this.tmpQ);
        if (x || y || z) {
          this.offset.set(x * h, y * h, z * h).applyQuaternion(this.pivotQ);
          b.node.parent.getWorldQuaternion(this.tmpQ).invert(); this.offset.applyQuaternion(this.tmpQ);
          b.node.position.copy(b.restP).add(this.offset);
        }
      }
    }

    dispose() {
      this.reset();
      if (this.manager && this.nativeUpdate) this.manager.update = this.nativeUpdate;
      this.bones.length = this.nativeRest.length = 0;
    }
  }
  root.WaifuSecondaryMotion = WaifuSecondaryMotion;
})(typeof globalThis !== "undefined" ? globalThis : window);
