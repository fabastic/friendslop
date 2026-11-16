/**
 * Gummy look for JellyFolk: glossy, see-through, faceted candy (low poly, flat shaded) that
 * refracts whatever is inside it, plus a vertex wobble driven per character so the whole body
 * jiggles like a fresh-out-of-the-mould pudding when it lands, hops or gets bumped.
 *
 * Also the hidden treats: every animal has a little surprise set inside its jelly belly.
 */
import * as THREE from 'three';
import { toon } from '../core/toon.ts';

/** Shared per-character uniforms: time and current jiggle energy. */
export interface Wobble {
  time: { value: number };
  amp: { value: number };
}

export function makeWobble(): Wobble {
  return { time: { value: Math.random() * 10 }, amp: { value: 0 } };
}

export interface GummyOpts {
  /** 0 = solid candy, 1 = glassy */
  clear?: number;
  /** wobble strength multiplier for this part (tiny parts barely move) */
  wob?: number;
  /** sour-candy sugar crystals glinting on the surface (0..1) */
  sugar?: number;
}

/** Translucent, glossy gummy candy. Low quality setting falls back to an opaque toon-ish candy. */
export function gummy(color: THREE.ColorRepresentation, w: Wobble, o: GummyOpts = {}): THREE.Material {
  const clear = o.clear ?? 0.6;
  const c = new THREE.Color(color);
  const deep = c.clone().multiplyScalar(0.55);
  const mat = new THREE.MeshPhysicalMaterial({
    color: c,
    flatShading: true,
    roughness: 0.08,
    metalness: 0,
    transmission: Math.min(0.95, clear * 1.35),
    thickness: 0.12,
    ior: 1.33,
    attenuationColor: deep,
    attenuationDistance: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 0.4,
    sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.6),
    emissive: c.clone().multiplyScalar(0.12),
    specularIntensity: 1,
  });
  const k = o.wob ?? 1;
  const sugar = o.sugar ?? 0.7;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWobT = w.time;
    sh.uniforms.uWobA = w.amp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWobT;\nuniform float uWobA;\nvarying vec3 vSugarP;')
      .replace('#include <project_vertex>', 'vSugarP = position;\n#include <project_vertex>')
      .replace(
        '#include <begin_vertex>',
        // displace along the position direction (not the face normal) so flat facets stay stitched
        `#include <begin_vertex>
        {
          float wv = sin(uWobT * 9.0 + position.y * 22.0 + position.x * 13.0) * 0.6
                   + sin(uWobT * 13.0 - position.z * 19.0) * 0.4;
          float base = 0.0035 + uWobA;
          transformed += normalize(position + vec3(1e-4)) * wv * base * ${k.toFixed(2)} * length(position);
        }`,
      );
    // sugar crystals: tiny cells (stuck to the body, not the screen) that glint and twinkle
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWobT;\nvarying vec3 vSugarP;')
      .replace(
        '#include <dithering_fragment>',
        `{
          vec3 cell = floor(vSugarP * 170.0);
          float sg = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw = 0.55 + 0.45 * sin(uWobT * 2.5 + sg * 60.0);
          gl_FragColor.rgb += step(0.94, sg) * ${sugar.toFixed(2)} * 0.32 * tw;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), ${(sugar * 0.06).toFixed(3)}); // frosted haze
        }
        #include <dithering_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `gummy-${k.toFixed(2)}-${sugar.toFixed(2)}`;
  return mat;
}

// ---------------------------------------------------------------- hidden treats
type TreatKind = 'fish' | 'bone' | 'carrot' | 'cheese' | 'banana' | 'star' | 'heart' | 'crown' | 'moon' | 'leaf' | 'egg' | 'acorn' | 'cloud' | 'coin' | 'bamboo' | 'grapes' | 'fly' | 'seed' | 'bolt' | 'flower';

const TREATS: Record<string, TreatKind> = {
  cat: 'fish', dog: 'bone', lion: 'crown', tiger: 'bolt', bear: 'heart', panda: 'bamboo', fox: 'grapes',
  bunny: 'carrot', frog: 'fly', pig: 'acorn', cow: 'flower', mouse: 'cheese', koala: 'leaf', monkey: 'banana',
  raccoon: 'coin', sheep: 'cloud', penguin: 'fish', owl: 'moon', duck: 'egg', chick: 'egg', unicorn: 'star',
  deer: 'leaf', hamster: 'seed', wolf: 'moon',
};

export function treatFor(species: string): TreatKind {
  return TREATS[species] ?? 'heart';
}

const lowp = (g: THREE.BufferGeometry) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
};

function m(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(lowp(geo), toon(color, {}, 0.2));
  mesh.position.set(x, y, z);
  mesh.userData.noInk = true; // seen through jelly: no outlines
  mesh.userData.treat = true; // keeps its own colours when the body is recoloured
  return mesh;
}

function star(points: number, outer: number, inner: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? inner : outer;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
}

/** A ~0.12-unit treat, centred at the origin, opaque so it shows through the gummy. */
export function buildTreat(kind: TreatKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'fish': {
      const body = m(new THREE.SphereGeometry(0.05, 6, 4), '#5fb8ff');
      body.scale.set(1.4, 0.8, 0.5);
      const tail = m(new THREE.ConeGeometry(0.035, 0.05, 3), '#3a8fe0', -0.075, 0, 0);
      tail.rotation.z = Math.PI / 2;
      g.add(body, tail, m(new THREE.SphereGeometry(0.008, 4, 3), '#2a1b4a', 0.04, 0.012, 0.02));
      break;
    }
    case 'bone': {
      g.add(m(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 5), '#fff6e0').rotateZ(Math.PI / 2));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(m(new THREE.SphereGeometry(0.02, 5, 4), '#fff6e0', sx * 0.05, sy * 0.014, 0));
      break;
    }
    case 'carrot': {
      const c = m(new THREE.ConeGeometry(0.03, 0.11, 6), '#ff8a2a');
      c.rotation.z = Math.PI;
      g.add(c, m(new THREE.ConeGeometry(0.02, 0.04, 4), '#3ccf7a', 0, 0.07, 0));
      break;
    }
    case 'cheese': {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(0.1, 0.03);
      s.lineTo(0, 0.07);
      s.closePath();
      g.add(m(new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }).translate(-0.04, -0.035, -0.025), '#ffd23f'));
      break;
    }
    case 'banana': {
      const b = m(new THREE.TorusGeometry(0.05, 0.016, 4, 8, Math.PI * 0.9), '#ffe14d');
      b.rotation.z = Math.PI * 1.05;
      g.add(b);
      break;
    }
    case 'star':
      g.add(m(star(5, 0.055, 0.024, 0.025), '#ffd23f'));
      break;
    case 'heart': {
      g.add(m(new THREE.SphereGeometry(0.03, 6, 4), '#ff4f7a', -0.022, 0.012, 0), m(new THREE.SphereGeometry(0.03, 6, 4), '#ff4f7a', 0.022, 0.012, 0));
      const tip = m(new THREE.ConeGeometry(0.043, 0.06, 6), '#ff4f7a', 0, -0.025, 0);
      tip.rotation.z = Math.PI;
      g.add(tip);
      break;
    }
    case 'crown': {
      g.add(m(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 8, 1, true), '#ffd23f'));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(m(new THREE.ConeGeometry(0.012, 0.035, 4), '#ffd23f', Math.sin(a) * 0.042, 0.035, Math.cos(a) * 0.042));
      }
      break;
    }
    case 'moon': {
      const t = m(new THREE.TorusGeometry(0.04, 0.018, 4, 10, Math.PI * 1.2), '#fff2a8');
      t.rotation.z = Math.PI * 0.4;
      g.add(t);
      break;
    }
    case 'leaf': {
      const l = m(new THREE.SphereGeometry(0.05, 6, 3), '#3ccf7a');
      l.scale.set(0.5, 1.1, 0.15);
      l.rotation.z = 0.5;
      g.add(l);
      break;
    }
    case 'egg': {
      const e = m(new THREE.SphereGeometry(0.04, 7, 5), '#fff6e0');
      e.scale.set(0.85, 1.15, 0.85);
      g.add(e);
      break;
    }
    case 'acorn':
      g.add(m(new THREE.SphereGeometry(0.035, 6, 4), '#c48a52', 0, -0.01, 0), m(new THREE.SphereGeometry(0.038, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), '#8a5a3c', 0, 0.012, 0));
      break;
    case 'cloud':
      for (const [x, y, r] of [[-0.03, 0, 0.028], [0.005, 0.015, 0.035], [0.035, 0, 0.026]] as const) g.add(m(new THREE.SphereGeometry(r, 6, 4), '#ffffff', x, y, 0));
      break;
    case 'coin': {
      const c = m(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), '#ffd23f');
      c.rotation.x = Math.PI / 2;
      g.add(c);
      break;
    }
    case 'bamboo':
      for (let i = 0; i < 3; i++) g.add(m(new THREE.CylinderGeometry(0.014, 0.016, 0.035, 6), i % 2 ? '#8be36b' : '#5fbf5a', 0, -0.04 + i * 0.037, 0));
      break;
    case 'grapes':
      for (const [x, y] of [[-0.02, 0.03], [0.02, 0.03], [0, 0], [-0.022, -0.005], [0.022, -0.005], [0, -0.035]] as const) g.add(m(new THREE.SphereGeometry(0.018, 5, 4), '#9b5fe0', x, y, 0));
      break;
    case 'fly':
      g.add(m(new THREE.SphereGeometry(0.022, 5, 4), '#2a1b4a'));
      for (const sx of [-1, 1]) {
        const w = m(new THREE.SphereGeometry(0.02, 5, 3), '#d8f3ff', sx * 0.025, 0.02, 0);
        w.scale.set(1.2, 0.4, 0.8);
        g.add(w);
      }
      break;
    case 'seed': {
      const s = m(new THREE.SphereGeometry(0.03, 6, 4), '#6b5a4a');
      s.scale.set(0.6, 1.3, 0.4);
      g.add(s);
      break;
    }
    case 'bolt': {
      const s = new THREE.Shape();
      s.moveTo(0.01, 0.06);
      s.lineTo(-0.03, 0);
      s.lineTo(0, 0);
      s.lineTo(-0.01, -0.06);
      s.lineTo(0.03, 0.01);
      s.lineTo(0, 0.01);
      s.closePath();
      g.add(m(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }).translate(0, 0, -0.01), '#ffd23f'));
      break;
    }
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(m(new THREE.SphereGeometry(0.02, 5, 3), '#ffffff', Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0));
      }
      g.add(m(new THREE.SphereGeometry(0.018, 5, 3), '#ffd23f', 0, 0, 0.01));
      break;
  }
  return g;
}
