import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'E:/MediPulse/docs/recon-evidence';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'https://strong-lokum-bfb6dc.netlify.app/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { try { logs.push(`[console.${m.type()}] ${m.text().slice(0, 400)}`); } catch {} });
page.on('pageerror', e => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url().slice(0, 200)} ${r.failure()?.errorText}`));

const shot = async name => { await page.screenshot({ path: `${OUT}/${name}.png` }).catch(e => logs.push('[shot-error] ' + name + ' ' + e.message)); console.log('shot', name); };
const bodyText = async () => page.evaluate(() => document.body.innerText.slice(0, 4000));

await page.goto(BASE, { waitUntil: 'networkidle' }).catch(async () => { await page.goto(BASE, { waitUntil: 'load' }); });
await page.waitForTimeout(3000);
await shot('01-landing-desktop');
fs.writeFileSync(`${OUT}/01-landing-text.txt`, await bodyText());

// click INITIALIZE PORTAL
await page.getByText('INITIALIZE PORTAL').first().click().catch(e => logs.push('[click-err] ' + e.message));
await page.waitForTimeout(1500);
await shot('02-login-desktop');
fs.writeFileSync(`${OUT}/02-login-text.txt`, await bodyText());

// dump all inputs/selects/buttons on login screen
const controls = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,button')).map(el => ({ tag: el.tagName, type: el.type || '', placeholder: el.placeholder || '', id: el.id, name: el.name, text: (el.tagName === 'BUTTON' ? el.textContent || '' : '').slice(0, 60) })));
fs.writeFileSync(`${OUT}/03-login-controls.json`, JSON.stringify(controls, null, 2));
console.log(JSON.stringify(controls, null, 1));

fs.writeFileSync(`${OUT}/console-desktop.log`, logs.join('\n'));
await browser.close();
console.log('done');
