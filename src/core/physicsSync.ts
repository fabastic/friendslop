import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

interface Link {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  prevP: THREE.Vector3;
  curP: THREE.Vector3;
  prevQ: THREE.Quaternion;
  curQ: THREE.Quaternion;
}

/** Keeps meshes in sync with rigid bodies, interpolating between fixed steps. */
export class PhysicsSync {
  private links: Link[] = [];

  add(body: RAPIER.RigidBody, obj: THREE.Object3D): void {
    const t = body.translation();
    const r = body.rotation();
    const p = new THREE.Vector3(t.x, t.y, t.z);
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.links.push({ body, obj, prevP: p.clone(), curP: p, prevQ: q.clone(), curQ: q });
    obj.position.copy(p);
    obj.quaternion.copy(q);
  }

  remove(body: RAPIER.RigidBody): void {
    this.links = this.links.filter((l) => l.body !== body);
  }

  /** Snap (no interpolation) — call after teleporting a body. */
  snap(body: RAPIER.RigidBody): void {
    const l = this.links.find((x) => x.body === body);
    if (!l) return;
    this.capture(l);
    l.prevP.copy(l.curP);
    l.prevQ.copy(l.curQ);
    l.obj.position.copy(l.curP);
    l.obj.quaternion.copy(l.curQ);
  }

  /** Call after each physics step. */
  afterStep(): void {
    for (const l of this.links) {
      l.prevP.copy(l.curP);
      l.prevQ.copy(l.curQ);
      this.capture(l);
    }
  }

  /** Call once per rendered frame. */
  render(alpha: number): void {
    for (const l of this.links) {
      l.obj.position.lerpVectors(l.prevP, l.curP, alpha);
      l.obj.quaternion.slerpQuaternions(l.prevQ, l.curQ, alpha);
    }
  }

  clear(): void {
    this.links = [];
  }

  private capture(l: Link): void {
    const t = l.body.translation();
    const r = l.body.rotation();
    l.curP.set(t.x, t.y, t.z);
    l.curQ.set(r.x, r.y, r.z, r.w);
  }
}
