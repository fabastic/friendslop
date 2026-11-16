import * as THREE from 'three';

/** Critically-tunable 1D spring: the jelly in every animation. */
export class Spring {
  x: number;
  v = 0;
  target: number;
  k: number;
  c: number;
  constructor(x: number, k = 120, c = 14) {
    this.x = x;
    this.target = x;
    this.k = k;
    this.c = c;
  }
  update(dt: number): number {
    this.v += (this.k * (this.target - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}


/**
 * Gummy soft-body point (shape matching, reduced to what a character needs): a mass hanging off
 * the rig at a rest offset. The rig moving/accelerating drags it away from rest; a stiff, lightly
 * damped spring pulls it back — the lag, stretch, squash-on-landing and snap-back wobble of jelly.
 * Offsets are in the character's local space.
 */
export class SoftPoint {
  readonly off = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  k: number;
  c: number;
  /** how strongly body acceleration drags this point (heavier = lags more) */
  mass: number;
  limit: number;
  constructor(k = 160, c = 9, mass = 1, limit = 0.12) {
    this.k = k;
    this.c = c;
    this.mass = mass;
    this.limit = limit;
  }
  /** accel = the character's acceleration in its local space (m/s²). */
  step(dt: number, accel: THREE.Vector3): THREE.Vector3 {
    this.vel.x += (-this.k * this.off.x - this.c * this.vel.x - accel.x * this.mass) * dt;
    this.vel.y += (-this.k * this.off.y - this.c * this.vel.y - accel.y * this.mass) * dt;
    this.vel.z += (-this.k * this.off.z - this.c * this.vel.z - accel.z * this.mass) * dt;
    this.off.addScaledVector(this.vel, dt);
    if (this.off.length() > this.limit) {
      this.off.setLength(this.limit);
      this.vel.multiplyScalar(0.6);
    }
    return this.off;
  }
  impulse(x: number, y: number, z: number): void {
    this.vel.x += x;
    this.vel.y += y;
    this.vel.z += z;
  }
  get energy(): number {
    return this.off.length() * 8 + this.vel.length() * 0.35;
  }
}

/**
 * Jelly ripple on a toon material: vertices breathe along their normals with a travelling wave
 * whose strength follows the soft body's energy. Chains any existing onBeforeCompile (hatching).
 */
export function addWobble(mat: THREE.Material, u: { uWob: { value: number }; uWobT: { value: number } }): void {
  if (mat.userData.wobble) return;
  mat.userData.wobble = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uWob = u.uWob;
    sh.uniforms.uWobT = u.uWobT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWob;\nuniform float uWobT;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  float wv = sin(position.y * 41.0 + uWobT * 23.0) * 0.6 + sin(position.x * 33.0 - uWobT * 17.0) * 0.4;\n  transformed += normal * wv * uWob;',
      );
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|wob`;
  mat.needsUpdate = true;
}

/** Skinned tapered tube on a bone chain, posed by springs for follow-through. */
export class Tentacle {
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly springsX: Spring[] = [];
  readonly springsZ: Spring[] = [];
  readonly phase = Math.random() * Math.PI * 2;

  constructor(length: number, r0: number, r1: number, segments: number, mat: THREE.Material) {
    const geo = new THREE.CylinderGeometry(r1, r0, length, 12, segments * 3, false);
    geo.translate(0, -length / 2, 0); // top at y = 0, hanging down
    const seg = length / segments;
    const pos = geo.attributes.position;
    const idx = new Uint16Array(pos.count * 4);
    const wgt = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const d = THREE.MathUtils.clamp(-pos.getY(i) / seg, 0, segments); // 0..segments
      const b = Math.min(Math.floor(d), segments - 1);
      const f = THREE.MathUtils.clamp(d - b, 0, 1);
      idx.set([b, Math.min(b + 1, segments), 0, 0], i * 4);
      wgt.set([1 - f, f, 0, 0], i * 4);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));

    for (let b = 0; b <= segments; b++) {
      const bone = new THREE.Bone();
      bone.position.y = b === 0 ? 0 : -seg;
      if (b > 0) this.bones[b - 1].add(bone);
      this.bones.push(bone);
      this.springsX.push(new Spring(0, 90, 7));
      this.springsZ.push(new Spring(0, 90, 7));
    }
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** Drive the chain toward per-bone target bends; springs add the wobbly follow-through. */
  pose(dt: number, bendX: (i: number) => number, bendZ: (i: number) => number): void {
    for (let i = 1; i < this.bones.length; i++) {
      this.springsX[i].target = bendX(i);
      this.springsZ[i].target = bendZ(i);
      this.bones[i].rotation.x = this.springsX[i].update(dt);
      this.bones[i].rotation.z = this.springsZ[i].update(dt);
    }
  }

  /** Whip impulse that travels down the chain. */
  whip(ax: number, az: number): void {
    for (let i = 1; i < this.bones.length; i++) {
      const fall = i / this.bones.length;
      this.springsX[i].v += ax * fall;
      this.springsZ[i].v += az * fall;
    }
  }

  get tip(): THREE.Bone {
    return this.bones[this.bones.length - 1];
  }
}

