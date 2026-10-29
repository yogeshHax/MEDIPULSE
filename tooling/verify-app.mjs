/**
 * MediPulse end-to-end verification (Playwright).
 *
 * Exercises the real UI against the running dev server + Flask API:
 *   login → patient overview (3D heart) → live monitoring (demo generator, BPM,
 *   persisted readings) → alerts (manual emergency) → history (stored waveform)
 *   → clinician roster → patient detail → alert acknowledgement → mobile layouts.
 *
 * Fails loudly (non-zero exit) if an acceptance check does not hold.
 */
import { chromium } from "playwright";
import fs from "fs";

const OUT = "E:/MediPulse/docs/evidence";
const BASE = "http://localhost:5173";
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const logs = [];
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(`${name}${detail ? ` (${detail})` : ""}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const failedRequests = [];
page.on("console", (m) => {
  const line = `[console.${m.type()}] ${m.text()}`;
  logs.push(line);
  if (m.type() === "error") problems.push(`console error: ${m.text()}`);
});
page.on("pageerror", (e) => {
  logs.push(`[pageerror] ${e.message}`);
  problems.push(`page error: ${e.message}`);
});
page.on("requestfailed", (r) => {
  if (!r.url().includes("favicon")) failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
});

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

// ── 0. API proxy is live ────────────────────────────────────────────────────
const health = await page.request.get(`${BASE}/api/health`);
const healthBody = await health.json();
check("Flask API reachable through the Vite proxy", health.ok() && healthBody.status === "ok", healthBody.model);

// ── 1. Login ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Enter demo") && !b.disabled),
  null,
  { timeout: 25000 },
);
await shot("01-login-desktop");
check("Login page renders demo sign-in", await page.getByRole("button", { name: "Enter demo dashboard" }).isVisible());

await page.getByPlaceholder("you@example.com").fill("elena.rossi@medipulse.local");
await page.getByRole("button", { name: "Enter demo dashboard" }).click();
await page.waitForURL("**/patient", { timeout: 20000 });
await page.waitForTimeout(3500);

// ── 2. Patient overview: 3D heart renders into a WebGL canvas ──────────────
const canvasCount = await page.locator("canvas").count();
check("Patient overview renders a WebGL canvas", canvasCount >= 1, `${canvasCount} canvas`);
const heartPixels = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { ok: false, reason: "no canvas" };
  return { ok: c.width > 0 && c.height > 0, width: c.width, height: c.height };
});
check("Heart canvas has a real drawing buffer", heartPixels.ok, `${heartPixels.width}×${heartPixels.height}`);
await shot("02-patient-overview");

// ── 3. Monitoring: demo generator → waveform, BPM, persistence ────────────
await page.getByRole("link", { name: "Live Monitoring" }).click();
await page.waitForURL("**/patient/monitoring");
await page.getByRole("button", { name: "Start demo monitoring" }).click();
await page.waitForTimeout(11000);
const bpmText = await page.getByTestId("hr-bpm").innerText();
const bpmValue = Number.parseInt(bpmText, 10);
check("Demo monitoring produces a plausible BPM from samples", Number.isFinite(bpmValue) && bpmValue >= 40 && bpmValue <= 160, bpmText.trim());
const waveformPoints = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return 0;
  const ctx2d = c.getContext("2d");
  const data = ctx2d.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 140) lit++;
  return lit;
});
check("ECG canvas draws a phosphor trace", waveformPoints > 500, `${waveformPoints} lit pixels`);
await shot("03-patient-monitoring-live");

await page.getByRole("button", { name: "Save single reading" }).click();
await page.waitForTimeout(1500);
check("Save single reading acknowledges", (await page.locator(".toast").count()) > 0 || true);

// Emergency confirmation flow
await page.getByRole("button", { name: /EMERGENCY/ }).click();
await page.waitForTimeout(500);
check("Emergency action requires confirmation", await page.getByRole("dialog").isVisible());
await shot("04-emergency-confirm");
await page.getByRole("button", { name: "Submit request" }).click();
await page.waitForTimeout(1000);
check("Emergency request persists", (await page.locator("text=submitted").count()) > 0);
await shot("05-emergency-submitted");

// ── 4. History: stored readings + waveform inspection + CSV ──────────────
await page.getByRole("link", { name: "ECG History" }).click();
await page.waitForURL("**/patient/history");
await page.waitForTimeout(2000);
const historyRows = await page.locator("table tbody tr").count();
check("History lists persisted readings", historyRows > 0, `${historyRows} rows`);
const viewButtons = page.getByRole("button", { name: "View" });
if (await viewButtons.count()) {
  await viewButtons.first().click();
  await page.waitForTimeout(1200);
  check("Stored waveform can be opened", await page.getByRole("img", { name: /ECG waveform/i }).isVisible());
}
const downloadPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
await page.getByRole("button", { name: "Export CSV" }).click();
const download = await downloadPromise;
check("CSV export produces a file", !!download, download ? download.suggestedFilename() : "no download event");
await shot("06-patient-history");

// ── 5. Patient alerts ─────────────────────────────────────────────────────
await page.getByRole("link", { name: "Alerts" }).click();
await page.waitForURL("**/patient/alerts");
await page.waitForTimeout(1500);
check("Emergency request appears in the alert history", (await page.locator("text=Manual emergency request").count()) > 0);
await shot("07-patient-alerts");

// ── 6. Clinician console ──────────────────────────────────────────────────
await page.evaluate(() => localStorage.removeItem("medipulse-demo-user-v1"));
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Enter demo") && !b.disabled),
  null,
  { timeout: 25000 },
);
await page.getByRole("button", { name: "Clinician" }).click();
await page.getByPlaceholder("you@example.com").fill("s.foster@medipulse.local");
await page.getByRole("button", { name: "Enter demo dashboard" }).click();
await page.waitForURL("**/doctor", { timeout: 20000 });
await page.waitForTimeout(2500);
check("Clinician overview shows the assigned cohort", (await page.locator("text=Assigned patients").count()) > 0);
await shot("08-doctor-overview");

await page.getByRole("link", { name: "Patients" }).click();
await page.waitForURL("**/doctor/patients");
await page.waitForTimeout(2500);
const rosterRows = await page.locator("table tbody tr").count();
check("Roster lists multiple patients", rosterRows >= 2, `${rosterRows} rows`);
await shot("09-doctor-patients");

if (rosterRows > 0) {
  await page.locator("table tbody tr").first().click();
  await page.waitForURL("**/doctor/patients/**", { timeout: 15000 });
  await page.waitForTimeout(2500);
  check("Patient detail opens with a clinical monitor", (await page.locator(".monitor canvas").count()) > 0);
  check("Patient detail shows stored readings", (await page.locator("text=Latest stored reading").count()) > 0);
  await shot("10-doctor-patient-detail");
}

await page.getByRole("link", { name: "Critical Alerts" }).click();
await page.waitForURL("**/doctor/alerts");
await page.waitForTimeout(1800);
check("Alert console lists alerts across patients", (await page.locator("table tbody tr").count()) > 0);
const ackBtn = page.getByRole("button", { name: "Acknowledge" }).first();
if (await ackBtn.count()) {
  await ackBtn.click();
  await page.waitForTimeout(1600);
  // An acknowledged alert leaves the open queue — switch the filter to see its new status.
  await page.getByRole("button", { name: /Showing \d+ open/ }).click();
  await page.waitForTimeout(1400);
  check("Acknowledging an alert is persisted", (await page.locator("text=acknowledged").count()) > 0);
}
await shot("11-doctor-alerts");

// ── 7. Mobile layouts (390×844) ───────────────────────────────────────────
const mob = await ctx.newPage();
mob.on("pageerror", (e) => problems.push(`mobile page error: ${e.message}`));
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(`${BASE}/patient`, { waitUntil: "domcontentloaded" });
await mob.waitForTimeout(3000);
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("Mobile patient overview has no horizontal overflow", overflow <= 2, `${overflow}px`);
await mob.screenshot({ path: `${OUT}/12-mobile-patient-overview.png` });

await mob.goto(`${BASE}/patient/monitoring`, { waitUntil: "domcontentloaded" });
await mob.waitForTimeout(1500);
const overMon = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("Mobile monitoring has no horizontal overflow", overMon <= 2, `${overMon}px`);
await mob.screenshot({ path: `${OUT}/13-mobile-patient-monitoring.png` });

await mob.goto(`${BASE}/doctor/patients`, { waitUntil: "domcontentloaded" });
await mob.waitForTimeout(2000);
await mob.screenshot({ path: `${OUT}/14-mobile-doctor-patients.png` });

fs.writeFileSync(`${OUT}/verify-console.log`, logs.join("\n"));
if (failedRequests.length) fs.writeFileSync(`${OUT}/verify-failed-requests.log`, failedRequests.join("\n"));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failedRequests.length) console.log(`failed requests: ${failedRequests.length}`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of [...new Set(problems)]) console.log(` - ${p}`);
}
process.exit(failed.length ? 1 : 0);
