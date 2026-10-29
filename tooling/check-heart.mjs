/** Focused check: does the 3D heart canvas render organ pixels (not just the backdrop)? */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:5173/login", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Enter demo") && !b.disabled), null, { timeout: 25000 });
await page.getByRole("button", { name: "Enter demo dashboard" }).click();
await page.waitForURL("**/patient", { timeout: 20000 });

// Wait for the lazy 3D chunk + first frames.
await page.waitForTimeout(4000);

const stat = await page.evaluate(() => {
  // The heart canvas is the WebGL one (the ECG chart is a 2D canvas).
  const canvases = [...document.querySelectorAll("canvas")];
  const glCanvas = canvases.find((c) => c.getContext("webgl2") || c.getContext("webgl"));
  if (!glCanvas) return { found: false };
  const ctx = glCanvas.getContext("webgl2") || glCanvas.getContext("webgl");
  const w = glCanvas.width, h = glCanvas.height;
  const px = new Uint8Array(w * h * 4);
  ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  let reddish = 0, tealish = 0, total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    total++;
    // Organ material is a warm pink/red; the backdrop ring is teal/cyan.
    if (r > 60 && r > g * 1.2 && r > b * 1.2) reddish++;
    if (g > 60 && g > r * 1.2) tealish++;
  }
  return { found: true, w, h, reddish, tealish, total, pct: (reddish / total * 100).toFixed(2) };
});

console.log(JSON.stringify(stat, null, 2));
if (errors.length) console.log("ERRORS:\n" + errors.slice(0, 6).join("\n"));

const ok = stat.found && stat.reddish > 2000;
console.log(ok ? "HEART_OK" : "HEART_MISSING");
await page.screenshot({ path: "E:/MediPulse/docs/evidence/heart-check.png", clip: { x: 100, y: 110, width: 760, height: 620 } });
await browser.close();
process.exit(ok ? 0 : 1);
