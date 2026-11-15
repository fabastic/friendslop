import * as THREE from 'three';

const COUNT = 220;
const COLORS = ['#ff6fae', '#5fd0ff', '#ffcf3f', '#8be36b', '#b78cff', '#ff8b4d'];

/** Instanced confetti burst. */
export class Confetti {
  private mesh: THREE.InstancedMesh;
  private pos: THREE.Vector3[] = [];
  private vel: THREE.Vector3[] = [];
  private rot: THREE.Euler[] = [];
  private spin: THREE.Vector3[] = [];
  private life = new Float32Array(COUNT);
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.035, 0.06),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      COUNT,
    );
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.rot.push(new THREE.Euler());
      this.spin.push(new THREE.Vector3());
      this.mesh.setColorAt(i, c.set(COLORS[i % COLORS.length]));
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    scene.add(this.mesh);
  }

  burst(at: THREE.Vector3, n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % COUNT;
      this.pos[i].copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.4));
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.2;
      this.vel[i].set(Math.cos(a) * sp, 3 + Math.random() * 3, Math.sin(a) * sp + 1.2);
      this.rot[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.spin[i].set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      this.life[i] = 2.5 + Math.random();
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const v = this.vel[i];
      v.y -= 4.5 * dt;
      v.multiplyScalar(1 - 1.6 * dt); // air drag -> fluttery
      this.pos[i].addScaledVector(v, dt);
      const r = this.rot[i];
      r.x += this.spin[i].x * dt;
      r.y += this.spin[i].y * dt;
      r.z += this.spin[i].z * dt;
      this.q.setFromEuler(r);
      this.s.setScalar(this.life[i] > 0 ? Math.min(1, this.life[i]) : 0);
      this.m.compose(this.pos[i], this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
