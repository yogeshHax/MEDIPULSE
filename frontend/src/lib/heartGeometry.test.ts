import { describe, expect, it } from "vitest";
import { buildHeartGeometry, heartSdfOrgan, heartSdfVessels } from "./heartGeometry";

describe("procedural heart geometry", () => {
  it("is inside the chamber mass and outside far away", () => {
    expect(heartSdfOrgan([0, -0.2, 0])).toBeLessThan(0);
    expect(heartSdfOrgan([-0.15, -0.6, 0])).toBeLessThan(0);
    expect(heartSdfOrgan([6, 6, 6])).toBeGreaterThan(0);
  });

  it("builds a closed-ish surface for chambers and vessels", () => {
    const { organ, vessels } = buildHeartGeometry();
    const organPos = organ.getAttribute("position");
    const organIdx = organ.getIndex();
    expect(organPos.count).toBeGreaterThan(2000);
    expect(organIdx!.count).toBeGreaterThan(6000);
    expect(organIdx!.count % 3).toBe(0);

    const vesselPos = vessels.getAttribute("position");
    expect(vesselPos.count).toBeGreaterThan(500);
    expect(vessels.getIndex()!.count).toBeGreaterThan(1500);

    // Normals must be unit length — otherwise lighting looks broken.
    const n = organ.getAttribute("normal");
    const len = Math.hypot(n.getX(0), n.getY(0), n.getZ(0));
    expect(len).toBeGreaterThan(0.95);
    expect(len).toBeLessThan(1.05);

    // Geometry should frame the anatomical bounding box, not a stray triangle field.
    expect(organ.boundingSphere!.radius).toBeGreaterThan(0.9);
    expect(organ.boundingSphere!.radius).toBeLessThan(2.6);
  });

  it("winds its faces outward (visible under back-face culling)", () => {
    const { organ, vessels } = buildHeartGeometry();
    const volumeOf = (geo: typeof organ) => {
      const pos = geo.getAttribute("position");
      const idx = geo.getIndex()!;
      let vol = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
        const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
        vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      }
      return vol;
    };
    expect(volumeOf(organ)).toBeGreaterThan(0);
    expect(volumeOf(vessels)).toBeGreaterThan(0);
  });

  it("caches the generated meshes", () => {
    expect(buildHeartGeometry()).toBe(buildHeartGeometry());
  });

  it("has vessels that start inside the chamber mass (so junctions hide)", () => {
    expect(heartSdfVessels([0.26, 0.44, 0.2])).toBeLessThan(0.02);
  });
});
