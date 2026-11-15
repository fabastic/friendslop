import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toon } from './toon.ts';

/**
 * Downloaded Sketchfab models (see public/assets/sketchfab/README.md for credits).
 * Loaded once at boot, then each game clones what it needs. Missing files are not fatal:
 * games fall back to their procedural meshes.
 */

const BASE = `${import.meta.env.BASE_URL}assets/sketchfab/`;

export interface FittedModel {
  /** Geometry baked into a single local frame: base at y = 0, centred in x/z. */
  geometry: THREE.BufferGeometry;
  /** Source texture (pixel-art friendly, nearest filtering), if any. */
  map: THREE.Texture | null;
}

const cache = new Map<string, THREE.Group>();

export async function preloadAssets(files: string[]): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    files.map(async (f) => {
      try {
        const gltf = await loader.loadAsync(BASE + f);
        gltf.scene.updateMatrixWorld(true);
        cache.set(f, gltf.scene);
      } catch (e) {
        console.warn(`asset ${f} failed to load, using fallback`, e);
      }
    }),
  );
}

/** The loaded scene graph for a file (shared; clone or copy geometry before modifying). */
export function getAssetRoot(file: string): THREE.Group | null {
  return cache.get(file) ?? null;
}

export function hasAsset(file: string): boolean {
  return cache.has(file);
}

/**
 * Bake every mesh under `file` whose name matches `filter` into one geometry,
 * rotate so its longest axis points up (when `upright`), and scale so that
 * the bounding-box height (or max dimension) equals `size`.
 */
export function fitModel(
  file: string,
  filter: (meshName: string) => boolean,
  size: number,
  opts: { upright?: boolean; by?: 'height' | 'max' | 'width' } = {},
): FittedModel | null {
  const root = cache.get(file);
  if (!root) return null;
  const parts: THREE.BufferGeometry[] = [];
  let map: THREE.Texture | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !filter(m.name)) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // keep only what we shade with
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    parts.push(g);
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!map && mat.map) map = mat.map;
  });
  if (parts.length === 0) return null;
  const geo = parts.length === 1 ? parts[0] : mergeSimple(parts);

  geo.computeBoundingBox();
  let box = geo.boundingBox!;
  const dims = box.getSize(new THREE.Vector3());
  if (opts.upright) {
    // rotate the longest axis onto +Y
    if (dims.x >= dims.y && dims.x >= dims.z) geo.rotateZ(Math.PI / 2);
    else if (dims.z >= dims.x && dims.z >= dims.y) geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    box = geo.boundingBox!;
  }
  const s = box.getSize(new THREE.Vector3());
  const ref = opts.by === 'max' ? Math.max(s.x, s.y, s.z) : opts.by === 'width' ? Math.max(s.x, s.z) : s.y;
  const k = size / ref;
  const c = box.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -box.min.y, -c.z);
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (map) {
    const t = map as THREE.Texture;
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { geometry: geo, map };
}

/** Whole model as a toon-shaded group (materials converted, textures kept), fitted to `size`. */
export function cloneModel(file: string, size: number, by: 'height' | 'max' | 'width' = 'max'): THREE.Group | null {
  const root = cache.get(file);
  if (!root) return null;
  const g = new THREE.Group();
  const inner = root.clone(true);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    m.material = toon(src.color ?? '#ffffff', { map: src.map ?? null }, 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
  });
  g.add(inner);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const s = box.getSize(new THREE.Vector3());
  const ref = by === 'max' ? Math.max(s.x, s.y, s.z) : by === 'width' ? Math.max(s.x, s.z) : s.y;
  const k = size / ref;
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  g.scale.setScalar(k);
  return g;
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!nonIndexed.every((p) => p.getAttribute(name))) continue;
    const size = nonIndexed[0].getAttribute(name).itemSize;
    const total = nonIndexed.reduce((n, p) => n + p.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const p of nonIndexed) {
      const a = p.getAttribute(name).array as Float32Array;
      arr.set(a, off);
      off += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/**
 * Recolour a pixel-art texture with a gradient map: luminance -> palette ramp.
 * Keeps the original pixel pattern but swaps every colour.
 */
export function recolorTexture(src: THREE.Texture, ramp: string[]): THREE.CanvasTexture | null {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const cols = ramp.map((h) => new THREE.Color(h));
  const tmp = new THREE.Color();
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    const x = l * (cols.length - 1);
    const a = Math.min(cols.length - 2, Math.floor(x));
    // posterise to keep the crisp pixel-art banding
    const f = Math.round((x - a) * 3) / 3;
    tmp.copy(cols[a]).lerp(cols[a + 1], f);
    d[i] = tmp.r * 255;
    d[i + 1] = tmp.g * 255;
    d[i + 2] = tmp.b * 255;
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.flipY = src.flipY;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  return t;
}
