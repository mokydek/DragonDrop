// Screenshot tour: node test/ui/shot.mjs <outdir> [only]
import { startDemo, loadPlaywright, newPage } from './harness.mjs';
const out = process.argv[2] || '.';
const only = process.argv[3] || '';
const { chromium } = loadPlaywright();
const demo = await startDemo({ dbName: 'bs_t_shot' });
demo.ctx.live.upgradeDelayMs = 0;
const browser = await chromium.launch();
const base = demo.app.base;
const want = (k) => !only || only.split(',').includes(k);
const log = [];

async function snap(page, name, full = false) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (ov > 0) log.push(`${name}: horizontal overflow ${ov}px`);
}

const { page, errors } = await newPage(browser, base);
await page.waitForSelector('.case-grid');
await page.waitForTimeout(700);
if (want('home')) { await snap(page, '01-home'); await snap(page, '01-home-full', true); }

if (want('case')) {
  await page.click(`[data-case="${demo.bySlug.dragon.id}"]`);
  await page.waitForSelector('#roulette');
  await page.waitForTimeout(300);
  await snap(page, '02-case');
  await snap(page, '02-case-full', true);
  await page.click('[data-act="open"]');
  await page.waitForTimeout(1500);
  await snap(page, '03-spinning');
  await page.waitForSelector('.result', { timeout: 10000 });
  await page.waitForTimeout(700);
  await snap(page, '04-result');
  await page.click('.result [data-act="close-modal"]');
  await page.waitForTimeout(400);
}

if (want('free')) {
  await page.evaluate((id) => (location.hash = '#/case/' + id), demo.bySlug.free.id);
  await page.waitForSelector('.tasks');
  await page.waitForTimeout(400);
  await snap(page, '05-free');
}

if (want('upgrade')) {
  await page.evaluate(() => (location.hash = '#/upgrade'));
  await page.waitForSelector('.gauge');
  await page.waitForTimeout(300);
  await snap(page, '06-upgrade-empty');
  await page.click('[data-act="up-pick"] >> nth=0');
  await page.click('[data-act="up-pick"] >> nth=1');
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="up-target"] >> nth=2');
  await page.waitForTimeout(400);
  await snap(page, '07-upgrade-ready');
}

if (want('profile')) {
  await page.evaluate(() => (location.hash = '#/profile'));
  await page.waitForSelector('.p-card');
  await page.waitForTimeout(300);
  await snap(page, '08-profile');
  await snap(page, '08-profile-full', true);
}

if (want('pops')) {
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  await page.click('#themeBtn');
  await page.waitForTimeout(300);
  await snap(page, '09-theme-pop');
  await page.mouse.click(10, 400);
  await page.click('#langBtn');
  await page.waitForTimeout(300);
  await snap(page, '10-lang-pop');
  await page.mouse.click(10, 400);
  await page.click('[data-act="topup"]');
  await page.waitForTimeout(400);
  await snap(page, '11-topup');
  await page.click('[data-act="tu-stars"]');
  await page.waitForTimeout(300);
  await snap(page, '11-topup-stars');
  await page.click('[data-act="tu-menu"]');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForTimeout(300);
  await snap(page, '11-topup-brainrots');
  await page.click('[data-act="tu-menu"]');
  await page.click('.topup [data-act="promo"]');
  await page.waitForTimeout(400);
  await snap(page, '11-promo');
  await page.click('.modal-backdrop');
  await page.waitForTimeout(300);
}

if (want('withdraw')) {
  await page.evaluate(() => (location.hash = '#/profile'));
  await page.waitForSelector('.p-card');
  await page.click('[data-act="withdraw"]');
  await page.waitForTimeout(400);
  await page.click('[data-wd] >> nth=0');
  await page.click('[data-wd] >> nth=2');
  await page.waitForTimeout(200);
  await snap(page, '15-withdraw');
  await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);
}

if (want('admin')) {
  for (const sub of ['overview', 'deposits', 'withdrawals', 'cases', 'items', 'users', 'promos', 'settings', 'broadcast']) {
    await page.evaluate((s) => (location.hash = '#/admin/' + s), sub);
    await page.waitForTimeout(700);
    await snap(page, `12-admin-${sub}`);
  }
  await page.evaluate((id) => (location.hash = '#/admin/cases/' + id), demo.bySlug.dragon.id);
  await page.waitForSelector('#caseForm');
  await page.waitForTimeout(400);
  await snap(page, '13-admin-case-editor');
  await snap(page, '13-admin-case-editor-full', true);
  await page.evaluate((id) => (location.hash = '#/admin/users/' + id), 6001);
  await page.waitForTimeout(700);
  await snap(page, '14-admin-user');
  const reqs = await demo.ctx.db.many("SELECT id, kind, method FROM bs_requests ORDER BY id");
  const dep = reqs.find((r) => r.kind === 'deposit' && r.method === 'brainrot');
  const wd = reqs.find((r) => r.kind === 'withdraw');
  const st = reqs.find((r) => r.method === 'stars');
  await page.evaluate((id) => (location.hash = '#/admin/deposits/' + id), dep.id);
  await page.waitForSelector('#reqChat');
  await page.waitForTimeout(500);
  await snap(page, '16-admin-deposit');
  await snap(page, '16-admin-deposit-full', true);
  await page.evaluate((id) => (location.hash = '#/admin/withdrawals/' + id), wd.id);
  await page.waitForSelector('#reqChat');
  await page.waitForTimeout(500);
  await snap(page, '17-admin-withdraw-full', true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await snap(page, '17-admin-withdraw-bottom');
  await page.evaluate(() => (location.hash = '#/admin/deposits'));
  await page.waitForSelector('#reqList');
  await page.click('[data-scope="done"]');
  await page.waitForTimeout(500);
  await snap(page, '18-admin-deposits-done');
  await page.evaluate((id) => (location.hash = '#/admin/deposits/' + id), st.id);
  await page.waitForSelector('#reqChat', { state: 'attached' });
  await page.waitForTimeout(400);
  await snap(page, '19-admin-stars');
}

console.log('errors:', errors.length ? errors : 'none');
console.log('layout:', log.length ? log : 'ok');
await browser.close();
await demo.app.close();
