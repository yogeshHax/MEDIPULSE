import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  HEART_ELLIPSOIDS, HEART_ARCS, HEART_K,
  ellipsoidUniforms, vesselUniforms,
  type Ellipsoid, type VesselArc,
} from "../lib/heartGeometry";

/**
 * 3D anatomical heart — the dashboard's focal element.
 *
 * - Default: an ORIGINAL procedural organ rendered by RAYMARCHING the signed-distance
 *   field defined in lib/heartGeometry.ts (rounded ellipsoid chamber masses + tapered
 *   vessel arcs, smooth-union blended). Raymarching yields a watertight surface with
 *   no meshing holes. The shaders are GLSL ES 3.00.
 * - Optional upgrade: drop a licensed `heart.glb` into `public/models/` and it is
 *   used automatically instead (verified by content type + glTF magic bytes, because
 *   dev servers answer any path with index.html and a bare HEAD check would lie).
 * - The scene is lazy-loaded so the dashboard paints before Three.js loads.
 * - Respects `prefers-reduced-motion`, degrades to a static SVG if WebGL fails.
 */

const EL_COUNT = HEART_ELLIPSOIDS.length;
const AR_COUNT = HEART_ARCS.length;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);
  return reduced;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

/** Double-beat envelope (lub-dub) in 0..1, driven by the live BPM. */
function beatEnvelope(t: number, bpm: number): number {
  const period = 60 / Math.max(35, Math.min(200, bpm || 70));
  const phase = (t % period) / period;
  const lub = Math.exp(-Math.pow((phase - 0.06) / 0.055, 2));
  const dub = 0.55 * Math.exp(-Math.pow((phase - 0.26) / 0.06, 2));
  return Math.min(1, lub + dub);
}

function BpmPulse({ bpm, children }: { bpm: number | null; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const reduced = useReducedMotion();
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    if (reduced) { group.current.scale.setScalar(1); return; }
    const s = 1 + beatEnvelope(t, bpm ?? 72) * 0.03;
    group.current.scale.setScalar(s);
  });
  return <group ref={group}>{children}</group>;
}

// ── Raymarched SDF heart ─────────────────────────────────────────────────────

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // full-screen quad (no camera transform)
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform mat4 uModel;      // heart transform (world ← local)
  uniform mat4 uInvModel;   // local ← world
  uniform mat4 uInvVP;      // reconstruct world ray from NDC
  uniform vec3 uCamPos;
  uniform vec4 uElA[${EL_COUNT}]; // xyz = ellipsoid centre
  uniform vec4 uElB[${EL_COUNT}]; // xyz = half-radii
  uniform vec4 uArA[${AR_COUNT}]; // xyz = arc start, w = start radius
  uniform vec4 uArB[${AR_COUNT}]; // xyz = arc end,   w = end radius

  const float CK = ${HEART_K.chambers.toFixed(4)};
  const float VK = ${HEART_K.vessels.toFixed(4)};
  const float BK = ${HEART_K.blend.toFixed(4)};
  const int STEPS = 110;

  float sdEllipsoid(vec3 p, vec3 c, vec3 r) {
    vec3 q = (p - c) / r;
    float k0 = length(q);
    float k1 = length((p - c) / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-9);
  }
  float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 ba = b - a;
    float l2 = dot(ba, ba);
    float rr = r1 - r2;
    float a2 = l2 - rr * rr;
    float il2 = 1.0 / l2;
    vec3 pa = p - a;
    float y = dot(pa, ba);
    float z = y - l2;
    vec3 qp = pa * l2 - ba * y;
    float x2 = dot(qp, qp);
    float y2 = y * y * l2;
    float z2 = z * z * l2;
    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  }
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  float mapChambers(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < ${EL_COUNT}; i++) {
      d = smin(d, sdEllipsoid(p, uElA[i].xyz, uElB[i].xyz), CK);
    }
    return d;
  }
  float mapVessels(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < ${AR_COUNT}; i++) {
      d = smin(d, sdRoundCone(p, uArA[i].xyz, uArB[i].xyz, uArA[i].w, uArB[i].w), VK);
    }
    return d;
  }
  float map(vec3 p) { return smin(mapChambers(p), mapVessels(p), BK); }

  vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.0022, 0.0);
    return normalize(vec3(
      map(p + e.xyy) - map(p - e.xyy),
      map(p + e.yxy) - map(p - e.yxy),
      map(p + e.yyx) - map(p - e.yyx)
    ));
  }

  void main() {
    // Reconstruct the world-space view ray through this pixel.
    vec4 far = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 ro = uCamPos;
    vec3 rd = normalize(far.xyz / far.w - ro);

    // Bounding sphere (local centre + radius) in world space, to skip empty pixels.
    vec3 cW = (uModel * vec4(-0.05, 0.05, -0.1, 1.0)).xyz;
    float scale = length(uModel[0].xyz);
    float R = 2.35 * scale;
    vec3 oc = ro - cW;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - R * R;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    float tNear = max(-b - sq, 0.0);
    float tFar = -b + sq;

    float t = tNear + 0.001;
    bool hit = false;
    vec3 p = ro;
    for (int i = 0; i < STEPS; i++) {
      p = ro + rd * t;
      vec3 lp = (uInvModel * vec4(p, 1.0)).xyz;
      float d = map(lp) * scale;
      if (d < 0.002 * t + 0.0008) { hit = true; break; }
      t += d;
      if (t > tFar) break;
    }
    if (!hit) discard;

    vec3 lp = (uInvModel * vec4(p, 1.0)).xyz;
    vec3 nL = normalAt(lp);
    // Local → world normal via the inverse-transpose of the model linear part.
    vec3 nW = normalize(mat3(transpose(uInvModel)) * nL);

    vec3 V = normalize(uCamPos - p);

    // Base colour: deep crimson body, warm second tint on the upper mass and
    // a slightly cooler shade on vessels.
    float dCh = mapChambers(lp);
    float dVe = mapVessels(lp);
    float up = clamp(0.5 + 0.5 * lp.y / 1.2, 0.0, 1.0);
    vec3 bodyLow = vec3(0.52, 0.085, 0.135);
    vec3 bodyHigh = vec3(0.96, 0.30, 0.365);
    vec3 base = mix(bodyLow, bodyHigh, up * up);
    vec3 vesselCol = mix(vec3(0.55, 0.10, 0.15), vec3(0.80, 0.26, 0.30), up);
    base = mix(base, vesselCol, clamp(1.0 - (dVe - dCh) * 14.0, 0.0, 0.85));

    // Three-point lighting, world space (the organ spins, lights stay fixed).
    vec3 L1 = normalize(vec3(1.9, 2.6, 2.4));    // warm key — upper left front
    vec3 L2 = normalize(vec3(-2.6, 0.9, -1.7));  // teal rim — right
    vec3 L3 = normalize(vec3(-0.2, -2.0, 1.2));  // violet bounce — below
    vec3 L4 = normalize(vec3(-1.2, 1.6, -2.6));  // cool back light (halo edge)
    float nd1 = max(dot(nW, L1), 0.0);
    float nd2 = max(dot(nW, L2), 0.0);
    float nd3 = max(dot(nW, L3), 0.0);
    float nd4 = max(dot(nW, L4), 0.0);

    float ao = clamp(map(lp + nL * 0.07) / 0.07, 0.0, 1.0);
    ao = 0.35 + 0.65 * ao;

    vec3 col = base * 0.10 * ao;                                   // ambient
    col += base * nd1 * vec3(1.00, 0.88, 0.90) * 1.28 * (0.6 + 0.4 * ao); // warm key
    col += base * nd2 * vec3(0.30, 0.94, 0.85) * 0.30;             // teal fill
    col += base * nd3 * vec3(0.62, 0.45, 0.85) * 0.28;             // violet bounce
    col += base * nd4 * vec3(0.75, 0.60, 0.70) * 0.55;             // back halo

    // Wet speculars: sharp key highlight + soft secondary.
    vec3 H1 = normalize(L1 + V);
    vec3 H2 = normalize(L2 + V);
    float spec1 = pow(max(dot(nW, H1), 0.0), 64.0) * 0.75;
    float spec2 = pow(max(dot(nW, H2), 0.0), 26.0) * 0.22;
    col += vec3(1.0, 0.94, 0.94) * spec1 * ao;
    col += vec3(0.75, 0.98, 0.95) * spec2;

    // Fresnel rim for the glossy medical-viz look, graded crimson → teal edge.
    float fres = pow(1.0 - max(dot(nW, V), 0.0), 2.6);
    col += mix(vec3(0.94, 0.52, 0.60), vec3(0.42, 0.98, 0.86), 0.35) * fres * 0.55;

    // Subsurface glow in the crevices (fake SSS: warm bleed where occluded).
    float sss = 1.0 - ao;
    col += vec3(0.85, 0.20, 0.22) * sss * sss * 0.35;

    // Affine tone-map + lift so highlights roll off like PBR output.
    col = col / (col + vec3(1.02));
    col = pow(col, vec3(0.86)) * 1.14;
    fragColor = vec4(col, 1.0);
  }
`;

function RaymarchedHeart({ bpm, reduced }: { bpm: number | null; reduced: boolean }) {
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const uniforms = useMemo(() => {
    const el = ellipsoidUniforms(HEART_ELLIPSOIDS as readonly Ellipsoid[]);
    const ar = vesselUniforms(HEART_ARCS as readonly VesselArc[]);
    return {
      uModel: { value: new THREE.Matrix4() },
      uInvModel: { value: new THREE.Matrix4() },
      uInvVP: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uElA: { value: el.a },
      uElB: { value: el.b },
      uArA: { value: ar.a },
      uArB: { value: ar.b },
    };
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        // The shaders are written in GLSL ES 3.00 (`in`/`out`, a user `out vec4
        // fragColor`, `transpose()`). Without GLSL3 Three.js compiles them as
        // ES 1.00, where those are invalid → the program fails to link and the
        // heart silently disappears (only the backdrop rings render).
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [uniforms],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (reduced) {
      dummy.rotation.set(0.05, -0.34, 0.05);
      dummy.scale.setScalar(0.92);
    } else {
      dummy.rotation.set(
        0.05,
        -0.34 + Math.sin(t * 0.22) * 0.34,
        0.05 + Math.cos(t * 0.17) * 0.03,
      );
      dummy.scale.setScalar((1 + beatEnvelope(t, bpm ?? 72) * 0.035) * 0.92);
    }
    dummy.position.set(0, -0.2, 0);
    dummy.updateMatrixWorld();

    uniforms.uModel.value.copy(dummy.matrixWorld);
    uniforms.uInvModel.value.copy(dummy.matrixWorld).invert();
    uniforms.uInvVP.value
      .multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse)
      .invert();
    uniforms.uCamPos.value.setFromMatrixPosition(state.camera.matrixWorld);
  });

  // Full-screen quad: position spans [-1,1] (PlaneGeometry 2×2), ignoring matrices.
  return (
    <mesh frustumCulled={false} material={material} renderOrder={2}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

function HeartGLB({ url, reduced }: { url: string; reduced: boolean }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let cancelled = false;
    new GLTFLoader().load(
      url,
      (gltf) => { if (!cancelled) setScene(gltf.scene); },
      undefined,
      () => { if (!cancelled) setScene(null); },
    );
    return () => { cancelled = true; };
  }, [url]);
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current || reduced) return;
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.5;
  });
  if (!scene) return null;
  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

/** Scanner ring + soft glow behind the organ. */
function Backdrop() {
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ring.current) {
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.06 * Math.sin(t * 0.8);
      ring.current.rotation.z = t * 0.05;
    }
    if (halo.current) {
      const m = halo.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.09 + 0.03 * Math.sin(t * 1.1);
    }
  });
  return (
    <>
      <mesh ref={halo} position={[0, 0.05, -1.6]} renderOrder={0}>
        <circleGeometry args={[1.9, 64]} />
        <meshBasicMaterial color="#0f6f66" transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={ring} position={[0, 0.05, -1.45]} renderOrder={0}>
        <torusGeometry args={[1.72, 0.005, 8, 128]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.05, -1.5]} rotation={[0, 0, Math.PI / 2]} renderOrder={0}>
        <torusGeometry args={[1.42, 0.0025, 8, 128]} />
        <meshBasicMaterial color="#46f09b" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </>
  );
}

function StaticFallback({ height }: { height: string | number }) {
  return (
    <div style={{ height, width: "100%", display: "grid", placeItems: "center", position: "relative" }} aria-hidden>
      <svg viewBox="0 0 200 220" style={{ height: "86%", filter: "drop-shadow(0 0 32px rgba(194,58,88,0.45))" }}>
        <defs>
          <radialGradient id="hg" cx="38%" cy="30%">
            <stop offset="0%" stopColor="#ff7f96" />
            <stop offset="55%" stopColor="#c23a58" />
            <stop offset="100%" stopColor="#6d1a2c" />
          </radialGradient>
        </defs>
        <path
          d="M100 60c-10-26-46-34-62-14-17 21-3 44 10 60 11 14 26 30 40 48 6 8 14 8 20 0 14-18 30-34 40-48 13-16 27-39 10-60-16-20-48-12-58 14z"
          fill="url(#hg)"
        />
      </svg>
    </div>
  );
}

export function HeartScene({
  bpm = null,
  className,
  height = "100%",
}: {
  bpm?: number | null;
  className?: string;
  height?: string | number;
}) {
  const reduced = useReducedMotion();
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [glOk, setGlOk] = useState<boolean | null>(null);

  useEffect(() => { setGlOk(webglAvailable()); }, []);

  useEffect(() => {
    // Optional upgrade path: drop a licensed heart.glb in frontend/public/models/.
    // NOTE: dev servers answer any path with index.html (HTTP 200), so a bare HEAD
    // check would falsely enable the GLB path and show nothing. Verify the content
    // type and the "glTF" magic bytes before trusting it.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/models/heart.glb");
        if (!res.ok) return;
        const type = res.headers.get("content-type") ?? "";
        if (!/model|gltf|octet-stream|application\/x-?binary/i.test(type)) return;
        const head = new Uint8Array(await res.clone().arrayBuffer()).slice(0, 4);
        const magic = String.fromCharCode(...head);
        if (!cancelled && magic === "glTF") setGlbUrl("/models/heart.glb");
      } catch { /* no model → procedural organ */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (glOk === false) return <StaticFallback height={height} />;

  return (
    <div className={className} style={{ height, width: "100%", position: "relative" }} role="img" aria-label="3-D anatomical heart visualisation">
      <Canvas
        camera={{ position: [0, 0.2, 4.9], fov: 38 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        <Backdrop />
        {glbUrl ? (
          <BpmPulse bpm={bpm}>
            <HeartGLB url={glbUrl} reduced={reduced} />
          </BpmPulse>
        ) : (
          <RaymarchedHeart bpm={bpm} reduced={reduced} />
        )}
      </Canvas>
    </div>
  );
}
