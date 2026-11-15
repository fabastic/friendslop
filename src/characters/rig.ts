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

