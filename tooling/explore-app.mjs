import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'E:/MediPulse/docs/evidence';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[app][console.${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[app][pageerror] ${e.message}`));

async function shot(name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('shot', name);
}

// ---- 1. Login (desktop) ----
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await shot('01-login-desktop');

// ---- 2. Demo patient login ----
await page.getByPlaceholder('you@example.com').fill('elena.rossi@medipulse.local');
await page.getByRole('button', { name: 'Enter demo dashboard' }).waitFor({ state: 'visible' });
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Enter demo') && !b.disabled), null, { timeout: 20000 });
await page.getByRole('button', { name: 'Enter demo dashboard' }).click();
await page.waitForURL('**/patient', { timeout: 15000 });
await page.waitForTimeout(2500);
await shot('02-patient-overview');

// ---- 3. Live monitoring (demo generator) ----
await page.getByRole('link', { name: 'Live Monitoring' }).click();
await page.waitForURL('**/patient/monitoring');
await page.getByRole('button', { name: 'Start demo monitoring' }).click();
await page.waitForTimeout(9000); // let the BPM estimate settle, persist ~2 readings
await shot('03-patient-monitoring-live');

// emergency modal (confirmation step)
await page.getByRole('button', { name: /EMERGENCY/ }).click();
await page.waitForTimeout(500);
await shot('04-emergency-confirm');
await page.getByRole('button', { name: 'Submit request' }).click();
await page.waitForTimeout(900);
await shot('05-emergency-submitted');

// ---- 4. History + alerts ----
await page.getByRole('link', { name: 'ECG History' }).click();
await page.waitForURL('**/patient/history');
await page.waitForTimeout(1500);
await shot('06-patient-history');
await page.getByRole('link', { name: 'Alerts' }).click();
await page.waitForURL('**/patient/alerts');
await page.waitForTimeout(1200);
await shot('07-patient-alerts');

// ---- 5. Doctor flow ----
await page.evaluate(() => localStorage.removeItem('medipulse-demo-user-v1'));
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Clinician' }).click();
await page.getByPlaceholder('you@example.com').fill('s.foster@medipulse.local');
await page.getByRole('button', { name: 'Enter demo dashboard' }).click();
await page.waitForURL('**/doctor', { timeout: 15000 });
await page.waitForTimeout(2000);
await shot('08-doctor-overview');

await page.getByRole('link', { name: 'Patients' }).click();
await page.waitForURL('**/doctor/patients');
await page.waitForTimeout(2500);
await shot('09-doctor-patients');

const row = page.locator('table tbody tr').first();
if (await row.count()) {
  await row.click();
  await page.waitForTimeout(2500);
  const url = page.url();
  if (url.includes('/doctor/patients/')) await shot('10-doctor-patient-detail');
}
await page.getByRole('link', { name: 'Critical Alerts' }).click();
await page.waitForURL('**/doctor/alerts');
await page.waitForTimeout(1500);
await shot('11-doctor-alerts');

// ---- 6. Mobile viewport on patient flow ----
const mob = await ctx.newPage();
mob.setViewportSize({ width: 390, height: 844 });
mob.on('console', m => logs.push(`[mob][console.${m.type()}] ${m.text()}`));
mob.on('pageerror', e => logs.push(`[mob][pageerror] ${e.message}`));
await mob.goto(BASE + '/patient', { waitUntil: 'domcontentloaded' });
await mob.waitForTimeout(2500);
await mob.screenshot({ path: `${OUT}/12-mobile-patient-overview.png` });
await mob.goto(BASE + '/patient/monitoring', { waitUntil: 'domcontentloaded' });
await mob.waitForTimeout(1200);
await mob.screenshot({ path: `${OUT}/13-mobile-patient-monitoring.png` });

fs.writeFileSync(`${OUT}/14-console.log`, logs.join('\n'));
console.log('console entries:', logs.length);
console.log(logs.filter(l => l.includes('pageerror') || l.includes('console.error')).slice(0, 12).join('\n'));
await browser.close();
