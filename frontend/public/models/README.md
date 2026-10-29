# Optional 3D model

Drop a **licensed** anatomical heart here as `heart.glb` and `HeartScene` will load
it automatically instead of the built-in procedural organ
(`src/lib/heartGeometry.ts`, SDF capsules → surface nets, original authorship).

The app verifies the file is a real glTF binary before using it (`glTF` magic
bytes), so a missing or misconfigured file never leaves the dashboard blank — it
falls back to the procedural heart, and to a static SVG heart when WebGL is
unavailable.

Licence: only add a model you are allowed to redistribute (CC0 / your own
authorship / a purchased licence that permits it).
