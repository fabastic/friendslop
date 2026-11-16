/**
 * Jelly Peak's mountain: a candy pillar wrapped in a spiral of floating slabs, with rest stops
 * (checkpoints), stamina berries and a summit disc. Everything is seeded so every player in a
 * party climbs the exact same mountain.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { toon, jelly } from '../../core/toon.ts';
import { mulberry } from '../bowling/world.ts';

export interface Checkpoint {
  pos: THREE.Vector3;
  index: number;
  marker: THREE.Object3D;
}

export interface Berry {
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  taken: boolean;
  respawn: number;
}

export interface Mountain {
  pillarR: number;
  height: number;
  summit: THREE.Vector3;
  checkpoints: Checkpoint[];
  berries: Berry[];
  /** decorations that bob/spin each frame */
  update(dt: number, t: number): void;
}

const SLAB_COLORS = ['#ff8fd0', '#ffd23f', '#7fe0ff', '#b9a3ff', '#8be36b', '#ffb07a'];

export function buildMountain(R: typeof RAPIER, world: RAPIER.World, scene: THREE.Scene, seed = 20261116): Mountain {
  const rnd = mulberry(seed);
  const fixed = (desc: RAPIER.ColliderDesc, at: THREE.Vector3, rotY = 0) => {
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z).setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0))));
    world.createCollider(desc.setFriction(0.9), body);
  };

  // ---- meadow
  const meadow = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 1, 48), toon('#9be59a'));
  meadow.position.y = -0.5;
  meadow.receiveShadow = true;
  scene.add(meadow);
  fixed(R.ColliderDesc.cylinder(0.5, 30), new THREE.Vector3(0, -0.5, 0));

  // ---- the pillar (climbable all the way up, if your stamina lasts)
  const pillarR = 3;
  const STEPS = 42;
  const rise = 1.35;
  const height = 1.2 + STEPS * rise + 1.2;
  const pillarGroup = new THREE.Group();
  const bandH = 3;
  for (let y = 0, k = 0; y < height; y += bandH, k++) {
    const h = Math.min(bandH, height - y);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(pillarR, pillarR + 0.05, h, 28), toon(k % 2 ? '#fff3e6' : '#ff9ec9'));
    band.position.y = y + h / 2;
    band.castShadow = band.receiveShadow = true;
    pillarGroup.add(band);
  }
  scene.add(pillarGroup);
  fixed(R.ColliderDesc.cylinder(height / 2, pillarR), new THREE.Vector3(0, height / 2, 0));

  // ---- spiral slabs
  const checkpoints: Checkpoint[] = [];
  const berries: Berry[] = [];
  const bobbers: { o: THREE.Object3D; base: number; ph: number }[] = [];
  const spinners: THREE.Object3D[] = [];
  const berryGeo = new THREE.IcosahedronGeometry(0.16, 1);
  const berryMat = jelly('#ff4f7a', { opacity: 0.9, glow: 0.6 });

  const addCheckpoint = (pos: THREE.Vector3, index: number) => {
    // a glowing jelly mushroom: touching it saves your spot
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 10), toon('#fff3e6'));
    stem.position.y = 0.25;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), jelly('#7fe0ff', { opacity: 0.85, glow: 0.8 }));
    cap.position.y = 0.48;
    g.add(stem, cap);
    g.position.copy(pos);
    scene.add(g);
    bobbers.push({ o: cap, base: cap.position.y, ph: index });
    checkpoints.push({ pos: pos.clone(), index, marker: g });
  };

  addCheckpoint(new THREE.Vector3(0, 0, pillarR + 3), 0);

  let theta = 0;
  for (let i = 0; i < STEPS; i++) {
    const rest = i > 0 && i % 10 === 0;
    // every 6th step is missing: you'll have to climb the pillar to get past the gap
    const missing = i % 6 === 5 && !rest;
    theta += 0.5 + rnd() * 0.12;
    const y = 1.2 + i * rise;
    if (missing) continue;
    const r = pillarR + (rest ? 1.5 : 1.1);
    const pos = new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
    const w = rest ? 3.2 : 1.7 + rnd() * 0.5;
    const d = rest ? 2.6 : 1.4 + rnd() * 0.3;
    const th = 0.36;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, th, d), toon(SLAB_COLORS[i % SLAB_COLORS.length]));
    slab.position.copy(pos);
    slab.rotation.y = theta;
    slab.castShadow = slab.receiveShadow = true;
    scene.add(slab);
    // gumdrop studs on the edge
    for (const sx of [-1, 1]) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), toon('#ffffff'));
      stud.position.set(sx * (w / 2 - 0.15), th / 2 + 0.05, d / 2 - 0.15);
      slab.add(stud);
    }
    fixed(R.ColliderDesc.cuboid(w / 2, th / 2, d / 2), pos, theta);
    const top = pos.clone().setY(y + th / 2);
    if (rest) addCheckpoint(top, checkpoints.length);
    else if (rnd() < 0.3) {
      const b = new THREE.Mesh(berryGeo, berryMat);
      const bp = top.clone().add(new THREE.Vector3(0, 0.45, 0));
      b.position.copy(bp);
      scene.add(b);
      berries.push({ pos: bp, mesh: b, taken: false, respawn: 0 });
      spinners.push(b);
    }
  }

  // ---- summit disc + flag
  const summit = new THREE.Vector3(0, height, 0);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(pillarR + 0.6, pillarR + 0.3, 0.5, 32), toon('#ffd23f'));
  disc.position.set(0, height + 0.25, 0);
  disc.castShadow = disc.receiveShadow = true;
  scene.add(disc);
  fixed(R.ColliderDesc.cylinder(0.25, pillarR + 0.6), new THREE.Vector3(0, height + 0.25, 0));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), toon('#ffffff'));
  pole.position.set(0, height + 1.7, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 8, 1), toon('#ff4fa3', { side: THREE.DoubleSide }));
  flag.position.set(0.55, height + 2.5, 0);
  scene.add(pole, flag);
  summit.y = height + 0.5;

  // ---- sky dressing: clouds and floating candy shapes (no colliders)
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const n = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1 + rnd() * 0.8, 14, 10), toon('#ffffff', {}, 0.2));
      puff.position.set(k * 1.3 - n * 0.6, rnd() * 0.4, rnd() * 0.6);
      puff.userData.noInk = true;
      cloud.add(puff);
    }
    const a = rnd() * Math.PI * 2;
    const r = 16 + rnd() * 22;
    cloud.position.set(Math.sin(a) * r, 6 + rnd() * (height + 8), Math.cos(a) * r);
    cloud.lookAt(0, cloud.position.y, 0);
    scene.add(cloud);
    bobbers.push({ o: cloud, base: cloud.position.y, ph: rnd() * 6 });
  }
  const shapes = [new THREE.TorusGeometry(0.8, 0.28, 10, 20), new THREE.OctahedronGeometry(0.9), new THREE.TorusKnotGeometry(0.6, 0.2, 48, 8)];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(shapes[i % shapes.length], toon(SLAB_COLORS[i % SLAB_COLORS.length]));
    const a = rnd() * Math.PI * 2;
    const r = 11 + rnd() * 12;
    m.position.set(Math.sin(a) * r, 4 + rnd() * height, Math.cos(a) * r);
    scene.add(m);
    spinners.push(m);
    bobbers.push({ o: m, base: m.position.y, ph: rnd() * 6 });
  }

  return {
    pillarR,
    height,
    summit,
    checkpoints,
    berries,
    update(dt, t) {
      for (const b of bobbers) b.o.position.y = b.base + Math.sin(t * 0.8 + b.ph) * 0.15;
      for (const s of spinners) s.rotation.y += dt * 0.8;
      // flag flutter
      const pos = flag.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + 0.55;
        pos.setZ(i, Math.sin(t * 6 - x * 4) * 0.08 * x);
      }
      pos.needsUpdate = true;
      for (const b of berries) {
        if (b.taken) {
          b.respawn -= dt;
          if (b.respawn <= 0) b.taken = false;
        }
        b.mesh.visible = !b.taken;
      }
    },
  };
}
