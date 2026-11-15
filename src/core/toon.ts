import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** Shared 3-band gradient for crisp, inky toon shading. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([105, 105, 190, 255, 255]);
  gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

/**
 * Ink hatching: thin screen-space diagonal strokes inside the darkest toon band,
 * so shadows read like pen shading rather than flat grey.
 */
const HATCH_GLSL = /* glsl */ `
  {
    vec3 inkLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    float inkBase = max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.02);
    float inkLum = dot(inkLit, vec3(0.299, 0.587, 0.114)) / inkBase;
    // thin anti-aliased diagonal pen strokes, only in the deepest shadow band
    float inkD = abs(mod(gl_FragCoord.x + gl_FragCoord.y, 7.0) - 3.5);
    float inkStroke = smoothstep(2.55, 3.25, inkD);
    float inkShade = 1.0 - smoothstep(0.5, 0.7, inkLum);
    outgoingLight = mix(outgoingLight, outgoingLight * 0.72, inkStroke * inkShade * inkHatch);
  }
`;

function patchHatch(mat: THREE.MeshToonMaterial, strength: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.inkHatch = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float inkHatch;')
      .replace('#include <opaque_fragment>', `${HATCH_GLSL}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `toon-hatch-${strength}`;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}, hatch = 0.7): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
  if (hatch > 0) patchHatch(m, hatch);
  return m;
}

/**
 * Jelly: banded toon base, see-through body, bright fresnel rim and a soft inner glow.
 * Works with skinning, shadows and fog because it is a patched MeshToonMaterial.
 */
export function jelly(color: THREE.ColorRepresentation, opts: { opacity?: number; rim?: THREE.ColorRepresentation; glow?: number } = {}): THREE.MeshToonMaterial {
  const c = new THREE.Color(color);
  const rim = new THREE.Color(opts.rim ?? c.clone().lerp(new THREE.Color('#ffffff'), 0.65));
  const m = new THREE.MeshToonMaterial({
    color: c,
    gradientMap: toonGradient(),
    transparent: true,
    opacity: opts.opacity ?? 0.82,
    emissive: c.clone().multiplyScalar(opts.glow ?? 0.18),
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.jellyRim = { value: rim };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 jellyRim;')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 jv = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normal, jv)), 0.0, 1.0), 2.2);
          float band = step(0.45, fres) * 0.6 + step(0.75, fres) * 0.4;
          outgoingLight = mix(outgoingLight, jellyRim, band * 0.75);
          diffuseColor.a = mix(diffuseColor.a, 1.0, band * 0.8);
          // glossy blob highlight
          vec3 jh = normalize(vec3(-0.35, 0.8, 0.5));
          float spec = step(0.93, dot(normal, jh));
          outgoingLight = mix(outgoingLight, vec3(1.0), spec * 0.85);
          diffuseColor.a = mix(diffuseColor.a, 1.0, spec);
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'jelly-v1';
  return m;
}

/** The shared gradient is deliberately never disposed with a scene. */
export function isSharedTexture(t: THREE.Texture): boolean {
  return t === gradient;
}
