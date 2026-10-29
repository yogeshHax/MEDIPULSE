import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'E:/MediPulse/docs/recon-evidence';
const BASE = 'https://strong-lokum-bfb6dc.netlify.app/';
const browser = await chromium.launch();
const logs = [];

async function run(name, email, role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('console', m => { try { logs.push(`[${name}][console.${m.type()}] ${m.text().slice(0, 300)}`); } catch {} });
  page.on('pageerror', e => logs.push(`[${name}][pageerror] ${String(e).slice(0, 300)}`));
  page.on('response', r => { const u = r.url(); if (!/google|firebase|gstatic|fonts/.test(u)) return; reqs.push(`${r.status()} ${u.slice(0, 160)}`); });

  const shot = async n => { await page.screenshot({ path: `${OUT}/${n}.png` }).catch(e => logs.push(`[${name}][shot] ${e.message}`)); console.log('shot', n); };
  const dump = async n => { try { fs.writeFileSync(`${OUT}/${n}.txt`, await page.evaluate(() => document.body.innerText.slice(0, 8000))); } catch (e) { logs.push(`[${name}][dump] ${e.message}`); } };

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.getByText('INITIALIZE PORTAL').first().click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('Legal Full Name').fill(name === 'doctor' ? 'Dr. Silas Foster' : 'Elena Rossi');
  await page.getByPlaceholder('Verified Email').fill(email);
  await page.selectOption('select', { index: role === 'doctor' ? 2 : 1 }).catch(() => logs.push(`[${name}] no select`));
  await page.getByText('LAUNCH HUB').click();
  await page.waitForTimeout(4000);
  await shot(`${role}-10-after-launch`);
  await dump(`${role}-10-after-launch`);
  // wait for telemetry stream to arrive
  await page.waitForTimeout(8000);
  await shot(`${role}-11-live`);
  await dump(`${role}-11-live`);
  const ctrls = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,button,textarea,[role=button],canvas')).map(el => ({ tag: el.tagName, w: el.clientWidth, placeholder: el.placeholder || '', text: (el.textContent || '').slice(0, 80).trim() })));
  fs.writeFileSync(`${OUT}/${role}-11-controls.json`, JSON.stringify(ctrls, null, 1));
  fs.writeFileSync(`${OUT}/${role}-requests.log`, reqs.join('\n'));
  await ctx.close();
}

await run('patient', 'e.rossi@medipulse.io', 'patient');
await run('doctor', 's.foster@medipulse.io', 'doctor');
fs.writeFileSync(`${OUT}/09-console-all.log`, logs.join('\n'));
await browser.close();
console.log('done');
