import * as THREE from 'three';

/**
 * Ink outlines via inverted hulls extruded in clip space, so lines keep a constant pixel width.
 * Hard-edged geometry gets a smoothed `inkNormal` attribute so corners don't crack.
 */

const resolution = { value: new THREE.Vector2(1280, 720) };
const materials = new Map<string, THREE.MeshBasicMaterial>();

export function setInkResolution(w: number, h: number): void {
  resolution.value.set(w, h);
}

export function inkMaterial(width = 2.5, color: THREE.ColorRepresentation = '#2a1b4a'): THREE.MeshBasicMaterial {
  const key = `${width}|${new THREE.Color(color).getHexString()}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.userData.inkShared = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.inkWidth = { value: width };
    shader.uniforms.inkResolution = resolution;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float inkWidth;
        uniform vec2 inkResolution;
        #ifdef USE_INK_NORMAL
          attribute vec3 inkNormal;
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_SKINNING
          vec3 inkN = objectNormal;
        #elif defined( USE_INK_NORMAL )
          vec3 inkN = inkNormal;
        #else
          vec3 inkN = normal;
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 inkClipN = projectionMatrix * modelViewMatrix * vec4(inkN, 0.0);
        vec2 inkDir = inkClipN.xy;
        float inkLen = length(inkDir);
        if (inkLen > 1e-5) gl_Position.xy += (inkDir / inkLen) * inkWidth * gl_Position.w * 2.0 / inkResolution;
        gl_Position.z += 0.0004 * gl_Position.w;`,
      );
  };
  mat.customProgramCacheKey = () => `ink-${key}`;
  materials.set(key, mat);
  return mat;
}

/** Variant that reads the smoothed attribute. */
function inkMaterialFor(geo: THREE.BufferGeometry, width: number, color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const base = inkMaterial(width, color);
  if (!geo.getAttribute('inkNormal')) return base;
  const key = `n|${width}|${new THREE.Color(color).getHexString()}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const mat = base.clone();
  mat.userData.inkShared = true;
  mat.defines = { USE_INK_NORMAL: '' };
  mat.onBeforeCompile = base.onBeforeCompile;
  mat.customProgramCacheKey = () => `ink-${key}`;
  materials.set(key, mat);
  return mat;
}

/** Adds smoothed normals for geometry with split (hard) normals, e.g. boxes. */
export function ensureInkNormals(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('inkNormal') || !geo.getAttribute('normal')) return;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const acc = new Map<string, THREE.Vector3>();
  const keyOf = (i: number) =>
    `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const v = acc.get(k) ?? acc.set(k, new THREE.Vector3()).get(k)!;
    v.x += nrm.getX(i);
    v.y += nrm.getY(i);
    v.z += nrm.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = acc.get(keyOf(i))!.clone().normalize();
    out.set([v.x, v.y, v.z], i * 3);
  }
  geo.setAttribute('inkNormal', new THREE.BufferAttribute(out, 3));
}

export interface InkOptions {
  width?: number;
  color?: THREE.ColorRepresentation;
  /** Skip objects for which this returns true. */
  skip?: (o: THREE.Mesh) => boolean;
}

/** Give every eligible mesh under `root` an ink outline (idempotent). */
export function addInkOutlines(root: THREE.Object3D, opts: InkOptions = {}): void {
  const width = opts.width ?? 2.5;
  const color = opts.color ?? '#2a1b4a';
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.ink || m.userData.isInk || m.userData.noInk) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh) return;
    if (opts.skip?.(m)) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || mat.side === THREE.BackSide) return;
    targets.push(m);
  });
  for (const m of targets) {
    const geo = m.geometry;
    if (!(m as THREE.SkinnedMesh).isSkinnedMesh && hasHardEdges(geo)) ensureInkNormals(geo);
    const w = (m.userData.inkWidth as number | undefined) ?? width;
    let outline: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      const s = new THREE.SkinnedMesh(geo, inkMaterial(w, color));
      s.bind(sm.skeleton, sm.bindMatrix);
      outline = s;
    } else {
      outline = new THREE.Mesh(geo, inkMaterialFor(geo, w, color));
    }
    outline.userData.isInk = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.frustumCulled = m.frustumCulled;
    outline.renderOrder = m.renderOrder;
    m.userData.ink = outline;
    m.add(outline);
  }
}

function hasHardEdges(geo: THREE.BufferGeometry): boolean {
  // Box/plane-like geometry: many coincident vertices with differing normals.
  const t = geo.type;
  return t === 'BoxGeometry' || t === 'CylinderGeometry' || t === 'ExtrudeGeometry' || t === 'BufferGeometry';
}
