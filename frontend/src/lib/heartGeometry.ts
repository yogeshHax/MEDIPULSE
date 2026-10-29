/**
 * Procedural anatomical heart — THE visual centre of the dashboard.
 *
 * Design goals (docs/architecture.md §3D heart): a graceful, normal-shaped
 * organ — rounded ventricular mass tapering to an apex, two atrial bulges,
 * and clearly-formed great vessels (aorta + arch + branches, pulmonary trunk
 * with bifurcation, cavae, pulmonary veins, surface coronaries). Deliberately
 * slightly stylised: "classic anatomical illustration", not medical realism.
 *
 * The SAME primitives drive two renderers:
 *   1. the GPU raymarcher (components/HeartScene.tsx) — watertight memorial
 *      surface, no meshing holes; and
 *   2. `buildHeartGeometry()`'s surface-nets mesh — used by unit tests to
 *      verify the field actually forms closed, outward-wound shells.
 *
 * No third-party asset is shipped: the shape is 100% original.
 */

"use no side effects";
import * as THREE from "three";

// ── Primitives ───────────────────────────────────────────────────────────────

/** An ellipsoid: centred at c with half-radii r (the chamber masses). */
export interface Ellipsoid {
  c: [number, number, number];
  r: [number, number, number];
}

/** A tapered capsule (round cone): radius ra at a shrinking to rb at b (vessels). */
export interface VesselArc {
  a: [number, number, number];
  ra: number;
  b: [number, number, number];
  rb: number;
}

/**
 * Chamber masses: left-ventrial ovoid + apex taper + right-ventricular mass,
 * blended with a WIDE smooth-union so the surface reads as one organic body.
 */
export const HEART_ELLIPSOIDS: readonly Ellipsoid[] = [
  // Left ventricle — the dominant ovoid mass (posterior-left)
  { c: [-0.12, -0.5, -0.05], r: [0.78, 1.02, 0.72] },
  // Apex taper — pulls the silhouette into the characteristic point
  { c: [-0.26, -0.98, 0.0], r: [0.5, 0.58, 0.46] },
  // Right ventricle — shorter, rounder, sits anterior-right
  { c: [0.44, -0.18, -0.02], r: [0.6, 0.76, 0.58] },
  // Right atrium — soft bump upper-right
  { c: [0.58, 0.42, -0.14], r: [0.38, 0.34, 0.36] },
  // Left atrium — tucked posterior-upper-left
  { c: [-0.34, 0.56, -0.3], r: [0.4, 0.34, 0.38] },
];

/**
 * Great vessels + surface coronaries as tapered arcs. Segment chains share
 * endpoints so the pipe joints weld seamlessly under the smooth-union.
 * Oredered back-to-front in the shader is irrelevant — SDFs blend in any order.
 */
export const HEART_ARCS: readonly VesselArc[] = [
  // Ascending aorta (thick root) → arch
  { a: [0.04, 0.55, -0.08], ra: 0.3, b: [0.08, 1.12, -0.12], rb: 0.235 },
  // Aortic arch curving back-left over the top
  { a: [0.08, 1.12, -0.12], ra: 0.235, b: [-0.3, 1.44, -0.18], rb: 0.2 },
  // Descending aorta behind the heart
  { a: [-0.3, 1.44, -0.18], ra: 0.2, b: [-0.52, 0.72, -0.26], rb: 0.185 },
  { a: [-0.52, 0.72, -0.26], ra: 0.185, b: [-0.56, -0.15, -0.32], rb: 0.17 },
  // Arch branches (brachiocephalic, carotid, subclavian)
  { a: [0.0, 1.46, -0.1], ra: 0.095, b: [0.04, 1.86, -0.08], rb: 0.072 },
  { a: [-0.16, 1.5, -0.14], ra: 0.082, b: [-0.24, 1.8, -0.16], rb: 0.06 },
  { a: [-0.34, 1.44, -0.2], ra: 0.072, b: [-0.46, 1.68, -0.24], rb: 0.055 },
  // Pulmonary trunk rising in FRONT of the aorta
  { a: [0.3, 0.4, 0.18], ra: 0.3, b: [0.0, 1.0, 0.1], rb: 0.235 },
  // Bifurcation under the arch: left + right pulmonary arteries
  { a: [0.0, 1.0, 0.1], ra: 0.235, b: [-0.64, 0.9, 0.02], rb: 0.175 },
  { a: [0.0, 1.0, 0.1], ra: 0.235, b: [0.5, 0.84, 0.12], rb: 0.145 },
  // Superior vena cava
  { a: [0.78, 0.5, -0.2], ra: 0.17, b: [0.88, 1.14, -0.26], rb: 0.15 },
  // Inferior vena cava
  { a: [0.72, 0.14, -0.28], ra: 0.16, b: [0.86, -0.6, -0.34], rb: 0.15 },
  // Pulmonary veins entering the left atrium (posterior stubs)
  { a: [-0.88, 0.64, -0.4], ra: 0.125, b: [-0.52, 0.56, -0.26], rb: 0.1 },
  { a: [-0.92, 0.3, -0.35], ra: 0.11, b: [-0.52, 0.3, -0.24], rb: 0.085 },
  { a: [0.96, 0.26, -0.4], ra: 0.11, b: [0.56, 0.22, -0.24], rb: 0.085 },
  // Right coronary artery — groove across the front-right
  { a: [0.36, 0.26, 0.62], ra: 0.07, b: [-0.42, 0.02, 0.46], rb: 0.055 },
  // Left anterior descending — down the front interventricular groove
  { a: [0.08, 0.24, 0.62], ra: 0.065, b: [-0.14, -0.98, 0.4], rb: 0.05 },
];

/** Blend radii: chambers must melt together; vessel chains just weld their joints. */
export const HEART_K = { chambers: 0.32, vessels: 0.07, blend: 0.1 } as const;

// ── SDFs (mirrored 1:1 in the raymarch shader) ───────────────────────────────

type V3 = [number, number, number];

/** Approximate analytic ellipsoid SDF (Iñigo Quilez). */
export function sdEllipsoid(p: V3, e: Ellipsoid): number {
  const px = (p[0] - e.c[0]) / e.r[0];
  const py = (p[1] - e.c[1]) / e.r[1];
  const pz = (p[2] - e.c[2]) / e.r[2];
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const px2 = p[0] - e.c[0], py2 = p[1] - e.c[1], pz2 = p[2] - e.c[2];
  const nx = px2 / (e.r[0] * e.r[0]);
  const ny = py2 / (e.r[1] * e.r[1]);
  const nz = pz2 / (e.r[2] * e.r[2]);
  const k1 = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return k0 === 0 ? -Math.min(e.r[0], Math.min(e.r[1], e.r[2])) : (k0 * (k0 - 1)) / (k1 || 1e-9);
}

/** Exact tapered-capsule (round cone) SDF (Iñigo Quilez). */
export function sdRoundCone(p: V3, v: VesselArc): number {
  const pa: V3 = [p[0] - v.a[0], p[1] - v.a[1], p[2] - v.a[2]];
  const ba: V3 = [v.b[0] - v.a[0], v.b[1] - v.a[1], v.b[2] - v.a[2]];
  const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const rr = v.ra - v.rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const y = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
  const z = y - l2;
  const q = [pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y];
  const x2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - v.rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - v.ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - v.ra;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

export function heartSdfOrgan(p: V3): number {
  const ells = HEART_ELLIPSOIDS;
  let d = 1e9;
  for (let i = 0; i < ells.length; i++) {
    d = i === 0 ? sdEllipsoid(p, ells[i]) : smin(d, sdEllipsoid(p, ells[i]), HEART_K.chambers);
  }
  return d;
}

export function heartSdfVessels(p: V3): number {
  const arcs = HEART_ARCS;
  let d = 1e9;
  for (let i = 0; i < arcs.length; i++) {
    d = i === 0 ? sdRoundCone(p, arcs[i]) : smin(d, sdRoundCone(p, arcs[i]), HEART_K.vessels);
  }
  return d;
}

/** Full heart: chambers + vessels, mildly smoothed together. */
export function heartSdf(p: V3): number {
  return smin(heartSdfOrgan(p), heartSdfVessels(p), HEART_K.blend);
}

// ── GPU uniform packing (consumed by components/HeartScene.tsx) ──────────────

/** Pack ellipsoids: A = (c.xyz, 0), B = (r.xyz, 0). */
export function ellipsoidUniforms(ells: readonly Ellipsoid[]): { a: Float32Array; b: Float32Array; count: number } {
  const a = new Float32Array(ells.length * 4);
  const b = new Float32Array(ells.length * 4);
  ells.forEach((e, i) => {
    a[i * 4] = e.c[0]; a[i * 4 + 1] = e.c[1]; a[i * 4 + 2] = e.c[2]; a[i * 4 + 3] = 0;
    b[i * 4] = e.r[0]; b[i * 4 + 1] = e.r[1]; b[i * 4 + 2] = e.r[2]; b[i * 4 + 3] = 0;
  });
  return { a, b, count: ells.length };
}

/** Pack vessel arcs: A = (a.xyz, ra), B = (b.xyz, rb). */
export function vesselUniforms(arcs: readonly VesselArc[]): { a: Float32Array; b: Float32Array; count: number } {
  const a = new Float32Array(arcs.length * 4);
  const b = new Float32Array(arcs.length * 4);
  arcs.forEach((v, i) => {
    a[i * 4] = v.a[0]; a[i * 4 + 1] = v.a[1]; a[i * 4 + 2] = v.a[2]; a[i * 4 + 3] = v.ra;
    b[i * 4] = v.b[0]; b[i * 4 + 1] = v.b[1]; b[i * 4 + 2] = v.b[2]; b[i * 4 + 3] = v.rb;
  });
  return { a, b, count: arcs.length };
}

// ── Legacy mesh path (tests + possible future fallback) ──────────────────────

interface Bounds {
  min: V3;
  max: V3;
}
const BOUNDS: Bounds = { min: [-1.15, -1.45, -0.55], max: [1.1, 1.95, 0.75] };
const CELL = 0.055; // keeps the test grid cheap while capturing the silhouette

function sampleField(sdf: (p: V3) => number) {
  const nx = Math.ceil((BOUNDS.max[0] - BOUNDS.min[0]) / CELL) + 1;
  const ny = Math.ceil((BOUNDS.max[1] - BOUNDS.min[1]) / CELL) + 1;
  const nz = Math.ceil((BOUNDS.max[2] - BOUNDS.min[2]) / CELL) + 1;
  const values = new Float32Array(nx * ny * nz);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    const pz = BOUNDS.min[2] + z * CELL;
    for (let y = 0; y < ny; y++) {
      const py = BOUNDS.min[1] + y * CELL;
      for (let x = 0; x < nx; x++) {
        values[at(x, y, z)] = sdf([BOUNDS.min[0] + x * CELL, py, pz]);
      }
    }
  }
  return { nx, ny, nz, values, at };
}

/** 12 cube edges as pairs of corner offsets. */
const EDGES: Array<[V3, V3]> = [
  [[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 1, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 0]],
  [[0, 0, 1], [1, 0, 1]], [[1, 0, 1], [1, 1, 1]], [[1, 1, 1], [0, 1, 1]], [[0, 1, 1], [0, 0, 1]],
  [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[1, 1, 0], [1, 1, 1]], [[0, 1, 0], [0, 1, 1]],
];

function surfaceNets(sdf: (p: V3) => number) {
  const { nx, ny, nz, values, at } = sampleField(sdf);
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const cAt = (x: number, y: number, z: number) => x + cx * (y + cy * z);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        let count = 0;
        let sx = 0, sy = 0, sz = 0;
        for (const [oa, ob] of EDGES) {
          const va = values[at(x + oa[0], y + oa[1], z + oa[2])];
          const vb = values[at(x + ob[0], y + ob[1], z + ob[2])];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb || 1e-9);
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          count++;
        }
        if (count === 0) continue;
        positions.push(
          BOUNDS.min[0] + (x + sx / count) * CELL,
          BOUNDS.min[1] + (y + sy / count) * CELL,
          BOUNDS.min[2] + (z + sz / count) * CELL,
        );
        cellVertex[cAt(x, y, z)] = positions.length / 3 - 1;
      }
    }
  }

  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };

  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const inside = values[at(x, y, z)] < 0;
        if (inside === (values[at(x + 1, y, z)] < 0)) continue;
        quad(
          cellVertex[cAt(x, y - 1, z - 1)], cellVertex[cAt(x, y, z - 1)],
          cellVertex[cAt(x, y, z)], cellVertex[cAt(x, y - 1, z)], !inside,
        );
      }
    }
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const inside = values[at(x, y, z)] < 0;
        if (inside === (values[at(x, y + 1, z)] < 0)) continue;
        quad(
          cellVertex[cAt(x - 1, y, z - 1)], cellVertex[cAt(x - 1, y, z)],
          cellVertex[cAt(x, y, z)], cellVertex[cAt(x, y, z - 1)], inside,
        );
      }
    }
  }
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const inside = values[at(x, y, z)] < 0;
        if (inside === (values[at(x, y, z + 1)] < 0)) continue;
        quad(
          cellVertex[cAt(x - 1, y - 1, z)], cellVertex[cAt(x, y - 1, z)],
          cellVertex[cAt(x, y, z)], cellVertex[cAt(x - 1, y, z)], !inside,
        );
      }
    }
  }

  // Orient outward: negative signed volume means the quads are wound clockwise.
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx2 = positions[c], cy2 = positions[c + 1], cz2 = positions[c + 2];
    volume += (ax * (by * cz2 - bz * cy2) - ay * (bx * cz2 - bz * cx2) + az * (bx * cy2 - by * cx2)) / 6;
  }
  if (volume < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const tmp = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = tmp;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export interface HeartMeshes {
  organ: THREE.BufferGeometry;
  vessels: THREE.BufferGeometry;
}

let cached: HeartMeshes | null = null;

/** Build (once) the two geometries that make up the heart (test/verification path). */
export function buildHeartGeometry(): HeartMeshes {
  if (cached) return cached;
  cached = { organ: surfaceNets(heartSdfOrgan), vessels: surfaceNets(heartSdfVessels) };
  return cached;
}
