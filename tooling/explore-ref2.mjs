import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'E:/MediPulse/docs/recon-evidence';
const BASE = 'https://strong-lokum-bfb6dc.netlify.app/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { try { logs.push(`[console.${m.type()}] ${m.text().slice(0, 400)}`); } catch {} });
page.on('pageerror', e => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));

const shot = async name => { await page.screenshot({ path: `${OUT}/${name}.png` }).catch(e => logs.push('[shot-error] ' + e.message)); console.log('shot', name); };
const dump = async name => { try { fs.writeFileSync(`${OUT}/${name}.txt`, await page.evaluate(() => document.body.innerText.slice(0, 6000))); } catch (e) { logs.push('[dump-err] ' + e.message); } };

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.getByText('INITIALIZE PORTAL').first().click();
await page.waitForTimeout(1200);

await page.getByPlaceholder('Verified Email').fill('e.rossi@medipulse.io');
await page.waitForTimeout(2500);
await shot('03-patient-initial');
await dump('03-patient-initial');

// survey interactive controls
const ctrls = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,button,textarea,[role=button]')).map(el => ({ tag: el.tagName, type: el.type || '', placeholder: el.placeholder || '', text: (el.textContent || '').slice(0, 70).trim(), cls: (el.className || '').toString().slice(0, 60) })));
fs.writeFileSync(`${OUT}/04-patient-controls.json`, JSON.stringify(ctrls, null, 1));
console.log(JSON.stringify(ctrls.slice(0, 40), null, 1));

// wait for live data
await page.waitForTimeout(6000);
await shot('05-patient-hub');
await dump('05-patient-hub');

// mobile viewport check on same session
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
await shot('06-patient-mobile');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(600);

fs.writeFileSync(`${OUT}/08-console.log`, logs.join('\n'));
await browser.close();
console.log('done');
