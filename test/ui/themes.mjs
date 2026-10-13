// Screenshots of every theme + languages: node test/ui/themes.mjs <outdir>
import { startDemo, loadPlaywright, newPage } from './harness.mjs';
const out = process.argv[2] || '.';
const { chromium } = loadPlaywright();
const demo = await startDemo({ dbName: 'bs_t_themes' });
const browser = await chromium.launch();
const { page, errors } = await newPage(browser, demo.app.base, { height: 700 });
await page.waitForSelector('.case-grid');
for (const th of ['graphite', 'mint', 'redblue', 'violet', 'ocean', 'sunset']) {
  await page.click('#themeBtn');
  await page.click(`[data-theme="${th}"]`);
  await page.mouse.click(5, 600);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/theme-${th}.png` });
}
for (const l of ['en', 'uk']) {
  await page.click('#langBtn');
  await page.click(`[data-lang="${l}"]`);
  await page.waitForTimeout(300);
  await page.evaluate((id) => (location.hash = '#/case/' + id), demo.bySlug.free.id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/lang-${l}-free.png` });
  await page.evaluate(() => (location.hash = '#/profile'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/lang-${l}-profile.png` });
}
const small = await newPage(browser, demo.app.base, { width: 360, height: 740 });
await small.page.waitForSelector('.case-grid');
await small.page.waitForTimeout(500);
await small.page.screenshot({ path: `${out}/small-360.png` });
const desk = await newPage(browser, demo.app.base, { width: 1280, height: 800 });
await desk.page.waitForSelector('.case-grid');
await desk.page.waitForTimeout(500);
await desk.page.screenshot({ path: `${out}/desktop.png` });
console.log('errors', errors, small.errors, desk.errors);
await browser.close();
await demo.app.close();
