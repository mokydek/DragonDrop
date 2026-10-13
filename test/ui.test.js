// End-to-end UI checks in headless Chromium (skipped when Playwright isn't installed).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDemo, loadPlaywright, newPage, ME } from './ui/harness.mjs';
import { scriptedRng } from './helpers.js';
import { signWebToken } from '../src/auth.js';
import { starsPayload } from '../src/requests.js';

let pw = null;
try {
  pw = loadPlaywright();
} catch {
  pw = null;
}

const skip = !pw && 'playwright not installed';
let demo;
let browser;
const uiRng = scriptedRng(); // queued values decide e.g. where a rocket explodes
const allErrors = [];

before(async () => {
  if (skip) return;
  demo = await startDemo({ dbName: 'bs_t_ui', env: { OWNER_USERNAMES: 'owner_ui' }, rng: uiRng });
  browser = await pw.chromium.launch();
});
after(async () => {
  await browser?.close();
  await demo?.app.close();
});

async function open(opts = {}) {
  const r = await newPage(browser, demo.app.base, opts);
  allErrors.push(r.errors);
  return r;
}
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const apiMe = async () => (await demo.app.get('/api/me', { user: ME })).body;

test('home: header, live drops, top drop, all 12 cases, no errors', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  assert.equal(await page.textContent('.brand-name'), 'DragonDrop');
  assert.equal(num(await page.textContent('#bal')), 1250);
  assert.equal(await page.locator('#online, .online').count(), 0, 'no online counter');
  assert.equal(await page.locator('.free-card').count(), 1);
  assert.equal(await page.locator('.case-card').count(), 11);
  const names = await page.locator('.case-name').allTextContents();
  assert.deepEqual(names, ['DragonDrop в нике', 'Кейс за репосты', 'Нуб кейс', 'Про кейс', 'Рыбный кейс', 'DLC кейс', 'Хэллоуин кейс', 'Летний кейс', 'Драгон кейс', 'Грибной кейс', 'Грифон кейс']);
  const priceTexts = await page.locator('.case-price').allTextContents();
  assert.equal(priceTexts[0].trim(), 'FREE', 'the nick case is free');
  assert.equal(priceTexts[1].trim(), 'FREE', 'the share case is free');
  const prices = priceTexts.slice(2).map(num);
  assert.deepEqual(prices, [10, 25, 65, 200, 250, 350, 450, 750, 2000]);
  assert.ok((await page.locator('#feed .drop').count()) >= 10);
  assert.match(await page.textContent('#top24'), /Топ дроп 24ч/);
  assert.equal(await page.textContent('.live-title span'), 'Последние дропы онлайн');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('opening a paid case: charge, spin, result, sell', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const noob = demo.bySlug.noob;
  await page.click(`[data-case="${noob.id}"]`);
  await page.waitForSelector('#roulette');
  assert.equal(await page.locator('.grid.items .item').count(), noob.items.length);
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="open"]');
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b - 10, before);
  await page.waitForSelector('.result', { timeout: 9000 });
  const name = await page.textContent('.result-name');
  const value = num(await page.textContent('.result-val'));
  const inv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.equal(inv[0].item.name, name, 'shown item is the one the server gave');
  assert.equal(inv[0].item.value, value);
  // the winning tile under the marker is the same item
  assert.equal(await page.textContent('#track .r-tile.win .r-name'), name);
  await page.click('[data-act="sell-won"]');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before - 10 + value);
  assert.equal((await apiMe()).me.balance, before - 10 + value);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('opening a case x3: three strips, one charge of 3 × price, all drops shown', { skip }, async () => {
  await demo.app.setBalance(ME.id, 250); // enough for one x3 only
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const fish = demo.bySlug.fish; // 65
  await page.click(`[data-case="${fish.id}"]`);
  await page.waitForSelector('#countSeg');
  assert.deepEqual(await page.locator('#countSeg button').allTextContents(), ['x1', 'x2', 'x3', 'x5']);
  assert.equal(await page.isDisabled('[data-act="count"][data-n="5"]'), true, '5 × 65 > 250');
  assert.equal(await page.locator('#roulettes .roulette').count(), 1);
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="count"][data-n="3"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 3);
  assert.equal(num(await page.textContent('[data-act="open"]')), 195);
  const invBefore = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  await page.click('[data-act="open"]');
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b - 195, before);
  await page.waitForSelector('.result.multi', { timeout: 10000 });
  await page.waitForTimeout(300);
  // the strips keep showing the drops even though x3 is no longer affordable
  assert.equal(await page.locator('#roulettes .roulette').count(), 3);
  assert.equal(await page.locator('#roulettes .r-tile.win').count(), 3);
  const names = await page.locator('.result-items .item-name').allTextContents();
  assert.equal(names.length, 3);
  const inv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.equal(inv.length, invBefore + 3);
  assert.deepEqual(inv.slice(0, 3).map((i) => i.item.name).sort(), [...names].sort(), 'shown items are the ones the server gave');
  // every strip stopped on its own drop
  const wins = await page.locator('#roulettes .r-tile.win .r-name').allTextContents();
  assert.deepEqual([...wins].sort(), [...names].sort());
  const total = inv.slice(0, 3).reduce((s, i) => s + i.item.value, 0);
  assert.equal(num(await page.textContent('.result.multi [data-act="sell-won"]')), total);
  await page.click('.result.multi [data-act="sell-won"]');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before - 195 + total);
  assert.equal((await demo.app.get('/api/inventory', { user: ME })).body.inventory.length, invBefore);
  // not enough for x3 any more -> that option is disabled and fewer strips are shown
  await demo.app.setBalance(ME.id, 140);
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.reload();
  await page.waitForSelector('.case-grid');
  await page.click(`[data-case="${fish.id}"]`);
  await page.waitForSelector('#countSeg');
  assert.equal(await page.isDisabled('[data-act="count"][data-n="3"]'), true);
  assert.equal(await page.isDisabled('[data-act="count"][data-n="2"]'), false);
  await page.click('[data-act="count"][data-n="2"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 2);
  await page.click('[data-act="count"][data-n="1"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 1);
  await demo.app.setBalance(ME.id, 1250);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('opening a case x5: five strips, 5 × price, five drops', { skip }, async () => {
  const fish = demo.bySlug.fish; // 65
  await demo.app.setBalance(ME.id, 300); // x5 = 325 is too much, x3 = 195 is fine
  const { page, errors } = await open({ path: `/#/case/${fish.id}` });
  await page.waitForSelector('#countSeg');
  assert.equal(await page.isDisabled('[data-act="count"][data-n="5"]'), true);
  await demo.app.setBalance(ME.id, 400);
  await page.reload();
  await page.waitForSelector('#countSeg');
  await page.click('[data-act="count"][data-n="5"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 5);
  assert.equal(num(await page.textContent('[data-act="open"]')), 325);
  // all five strips fit on a phone screen together with the Open button
  const fits = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#roulettes .roulette')].map((e) => e.getBoundingClientRect());
    const b = document.querySelector('[data-act="open"]').getBoundingClientRect();
    return b.bottom - r[0].top <= innerHeight - 60 && r.every((x) => x.width > 300);
  });
  assert.ok(fits, 'strips + button fit in one screen');
  const invBefore = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  await page.click('[data-act="open"]');
  await page.waitForFunction(() => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === 75);
  await page.waitForSelector('.result.multi', { timeout: 10000 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#roulettes .r-tile.win').count(), 5);
  const names = await page.locator('.result-items .item-name').allTextContents();
  assert.equal(names.length, 5);
  const inv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.equal(inv.length, invBefore + 5);
  assert.deepEqual(inv.slice(0, 5).map((i) => i.item.name).sort(), [...names].sort());
  const wins = await page.locator('#roulettes .r-tile.win .r-name').allTextContents();
  assert.deepEqual([...wins].sort(), [...names].sort(), 'every strip stopped on its own drop');
  await page.click('.result.multi [data-act="close-modal"]');
  await page.waitForTimeout(300);
  // 75 left: x5 / x3 / x2 are out of reach, the case falls back to x1
  assert.equal(await page.locator('#countSeg button.on').textContent(), 'x1');
  for (const n of [2, 3, 5]) assert.equal(await page.isDisabled(`[data-act="count"][data-n="${n}"]`), true, `x${n} disabled`);
  assert.equal(num(await page.textContent('[data-act="open"]')), 65);
  await demo.app.setBalance(ME.id, 1250);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('selling the drop re-enables opening when the balance is enough again', { skip }, async () => {
  const noob = demo.bySlug.noob;
  await demo.app.setBalance(ME.id, 10);
  const { page } = await open({ path: `/#/case/${noob.id}` });
  await page.waitForSelector('[data-act="open"]');
  await page.click('[data-act="open"]');
  // tapping Back during the spin is ignored
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__tgBack && window.__tgBack());
  await page.click('.view-head .back');
  await page.waitForSelector('.result', { timeout: 9000 });
  assert.ok(page.url().includes(`#/case/${noob.id}`), 'still on the case page');
  await page.click('[data-act="sell-won"]');
  await page.waitForSelector('.toast.ok');
  const bal = num(await page.textContent('#bal'));
  const btn = page.locator('#openRow .btn');
  assert.equal(await btn.isDisabled(), bal < 10, `balance ${bal}`);
  await demo.app.setBalance(ME.id, 1250);
  await page.context().close();
});

test('theme saved on the server is used on a new device', { skip }, async () => {
  await demo.app.post('/api/prefs', { user: ME, body: { theme: 'mint' } });
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'mint');
  await demo.app.post('/api/prefs', { user: ME, body: { theme: 'sunset' } });
  await page.context().close();
});

test('not enough coins disables the button', { skip }, async () => {
  const { page } = await open({ path: `/#/case/${demo.bySlug.griffin.id}` });
  await page.waitForSelector('#openRow .btn');
  assert.equal(await page.isDisabled('#openRow .btn'), true);
  assert.equal(await page.textContent('#openRow .btn'), 'Недостаточно монет');
  await page.context().close();
});

test('free case: share via Telegram, open, then cooldown', { skip }, async () => {
  const { page, errors } = await open({ path: `/#/case/${demo.bySlug.free.id}` });
  await page.waitForSelector('.tasks');
  assert.equal(await page.isDisabled('[data-act="open"]'), true);
  assert.match(await page.textContent('.task-text'), /Скинь ссылку на бота в любой чат/);
  await page.click('[data-act="share"]');
  await page.waitForSelector('.task.done');
  const calls = await page.evaluate(() => window.__tgCalls.filter((c) => c[0] === 'shareMessage'));
  assert.deepEqual(calls, [['shareMessage', `prep_${ME.id}`]]);
  assert.equal(await page.isDisabled('[data-act="open"]'), false);
  await page.click('[data-act="open"]');
  await page.waitForSelector('.result', { timeout: 9000 });
  await page.click('.result [data-act="close-modal"]');
  await page.waitForSelector('#cooldown');
  assert.match(await page.textContent('#cooldown'), /Следующий бесплатный кейс через 2[34]:\d\d:\d\d/);
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('#freeState');
  assert.match(await page.textContent('#freeState'), /^Через \d\d:\d\d:\d\d$/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('nick case: free with DragonDrop in the Telegram name, a hint without it, then the cooldown', { skip }, async () => {
  const c = demo.ctx.game.nickCase();
  demo.app.tg.state.users.set(ME.id, { first_name: 'Тест', username: 'brainrot_fan' }); // Telegram: no DragonDrop yet
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const card = page.locator(`.case-card[data-case="${c.id}"]`);
  assert.equal(await card.locator('.case-name').textContent(), 'DragonDrop в нике');
  assert.equal((await card.locator('.case-price').textContent()).trim(), 'FREE');
  await card.click();
  await page.waitForSelector('#openRow [data-act="open"]');
  assert.equal(await page.textContent('.vh-price'), 'FREE');
  assert.equal(await page.locator('#countSeg').count(), 0, 'one at a time, no x2 / x3 / x5');
  assert.equal(await page.textContent('#openRow [data-act="open"]'), 'Открыть бесплатно');
  const bal = num(await page.textContent('#bal'));
  // no DragonDrop in the name: a hint, nothing opened
  await page.click('#openRow [data-act="open"]');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Добавь «DragonDrop» в свой ник в Telegram, чтобы открыть этот кейс');
  assert.equal(await page.locator('.result').count(), 0);
  await page.waitForSelector('.toast', { state: 'detached', timeout: 6000 });
  // the player puts it in the Telegram name: opens right away, no reload needed
  demo.app.tg.state.users.set(ME.id, { first_name: 'Тест | DragonDrop', username: 'brainrot_fan' });
  await page.click('#openRow [data-act="open"]');
  await page.waitForSelector('.result', { timeout: 9000 });
  const won = await page.textContent('.result-name');
  assert.ok(c.items.some((e) => demo.ctx.game.catalog.items.get(e.item_id).name === won), won);
  assert.equal(num(await page.textContent('#bal')), bal, 'no coins taken');
  await page.click('.result [data-act="close-modal"]');
  await page.waitForSelector('#cooldown');
  assert.match(await page.textContent('#cooldown'), /Следующий бесплатный кейс через 2[34]:\d\d:\d\d/);
  assert.deepEqual(await demo.ctx.db.one('SELECT source, case_id FROM bs_inventory WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]), {
    source: 'nick',
    case_id: c.id,
  });
  demo.app.tg.state.users.delete(ME.id);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('share case: subscribe, share the bot 5 times (a counter on the task), open for free, then the cooldown', { skip }, async () => {
  const c = demo.ctx.game.shareCase();
  await demo.ctx.db.query('UPDATE bs_users SET share_n = 0, share_last_at = NULL WHERE id = $1', [ME.id]);
  await demo.ctx.settings.update({ channel: '@dragondrop_news' }); // like the FREE case, it needs the subscription too
  demo.app.tg.state.members.delete(ME.id);
  try {
    const { page, errors } = await open();
    await page.waitForSelector('.case-grid');
    const card = page.locator(`.case-card[data-case="${c.id}"]`);
    assert.equal(await card.locator('.case-name').textContent(), 'Кейс за репосты');
    assert.equal((await card.locator('.case-price').textContent()).trim(), 'FREE');
    await card.click();
    await page.waitForSelector('#freeTasks .task');
    assert.equal(await page.textContent('.vh-price'), 'FREE');
    assert.equal(await page.locator('#countSeg').count(), 0, 'one at a time, no x2 / x3 / x5');
    assert.deepEqual(await page.locator('#freeTasks .task-text').allTextContents(), ['Подпишись на наш канал', 'Скинь ссылку на бота в разные чаты 0/5']);
    assert.equal(await page.textContent('#openRow [data-act="open"]'), 'Открыть бесплатно');
    assert.equal(await page.isDisabled('#openRow [data-act="open"]'), true);
    // every share sent through Telegram counts, one by one
    for (let i = 1; i <= 5; i++) {
      await page.click('#freeTasks [data-act="share"]');
      await page.waitForFunction((n) => document.querySelector('#freeTasks .task-count')?.textContent === n, `${i}/5`);
      if (i < 5) assert.equal(await page.isDisabled('#openRow [data-act="open"]'), true, `${i} of 5`);
    }
    const shares = await page.evaluate(() => window.__tgCalls.filter((x) => x[0] === 'shareMessage'));
    assert.deepEqual(shares, Array(5).fill(['shareMessage', `prep_${ME.id}`]));
    assert.equal(await page.locator('#freeTasks .task.done').count(), 1, 'the share task is done');
    assert.equal(await page.locator('#freeTasks [data-act="share"]').count(), 0);
    assert.equal(await page.isDisabled('#openRow [data-act="open"]'), true, 'not subscribed yet');
    // the subscription: a hint until the player joins the channel
    await page.waitForTimeout(3100); // the per-player limit on actions
    await page.click('#freeTasks [data-act="check-sub"]');
    await page.waitForSelector('.toast.error');
    assert.equal(await page.textContent('.toast.error'), 'Подпишись на канал и нажми «Проверить»');
    demo.app.tg.state.members.add(ME.id);
    await page.click('#freeTasks [data-act="check-sub"]');
    await page.waitForFunction(() => document.querySelectorAll('#freeTasks .task.done').length === 2);
    assert.equal(await page.isDisabled('#openRow [data-act="open"]'), false);
    const bal = num(await page.textContent('#bal'));
    await page.click('#openRow [data-act="open"]');
    await page.waitForSelector('.result', { timeout: 9000 });
    const won = await page.textContent('.result-name');
    assert.ok(c.items.some((e) => demo.ctx.game.catalog.items.get(e.item_id).name === won), won);
    assert.equal(num(await page.textContent('#bal')), bal, 'no coins taken');
    await page.click('.result [data-act="close-modal"]');
    await page.waitForSelector('#cooldown');
    assert.match(await page.textContent('#cooldown'), /Следующий бесплатный кейс через 2[34]:\d\d:\d\d/);
    assert.equal(await page.textContent('#freeTasks .task-count'), '0/5', 'the shares are used up');
    assert.deepEqual(await demo.ctx.db.one('SELECT source, case_id FROM bs_inventory WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]), {
      source: 'share',
      case_id: c.id,
    });
    assert.equal((await demo.ctx.db.one('SELECT share_n FROM bs_users WHERE id = $1', [ME.id])).share_n, 0);
    // the admin player card says where it came from
    const inv = await demo.ctx.db.one("SELECT id FROM bs_inventory WHERE user_id = $1 AND source = 'share' ORDER BY id DESC LIMIT 1", [ME.id]);
    await page.evaluate((id) => (location.hash = '#/admin/users/' + id), ME.id);
    await page.waitForSelector(`.row:has([data-inv="${inv.id}"]) .inv-src`);
    assert.match(await page.textContent(`.row:has([data-inv="${inv.id}"]) .inv-src`), /^Кейс за репосты · /);
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    await demo.ctx.settings.update({ channel: '' });
    demo.app.tg.state.members.delete(ME.id);
  }
});

test('upgrader: chance matches the formula and the result matches the server', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector('[data-act="up-pick"]');
  await page.click('[data-act="up-pick"] >> nth=0');
  const betText = await page.textContent('#upSlots .slot:first-child .slot-val');
  const bet = num(betText);
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.click('[data-act="up-target"] >> nth=0');
  const target = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
  // 1.06 times lower than bet / target * 90, and the app shows exactly that
  const expected = Math.floor((Math.min(80, (bet / target) * 90) / 1.06) * 100) / 100;
  const shown = Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, ''));
  assert.equal(shown, expected);
  const invBefore = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  await page.click('#upBtn');
  await page.waitForSelector('.result', { timeout: 9000 });
  const title = await page.textContent('.result-title');
  const last = await demo.ctx.db.one('SELECT won FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.equal(title, last.won ? 'Успех!' : 'Не повезло');
  const invAfter = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  assert.equal(invAfter, invBefore - 1 + (last.won ? 1 : 0));
  await page.click('.result [data-act="close-modal"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-act="up-pick"]').count(), invAfter);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('upgrader: 75% / 50% / 30% buttons pick the target with the closest chance', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector('#upPcts button');
  // bad luck 1.06: the highest chance is 80 / 1.06 = 75.4%, so all three buttons are there
  assert.deepEqual(await page.locator('#upPcts button').allTextContents(), ['75%', '50%', '30%']);
  assert.equal(await page.isDisabled('#upRange'), true, 'slider is off until items are picked');
  await page.click('[data-act="up-pct"][data-p="50"]');
  await page.waitForSelector('.toast');
  assert.equal(await page.textContent('.toast'), 'Выбери предметы');
  await page.click('[data-act="up-pick"] >> nth=0');
  const bet = num(await page.textContent('#upSlots .slot:first-child .slot-val'));
  const { items, upgrade } = (await demo.app.get('/api/catalog', { user: ME })).body;
  assert.equal(upgrade.luck, 1.06);
  const formula = (b, v) => Math.floor((Math.min(upgrade.maxChance, (b / v) * (100 - upgrade.edge)) / upgrade.luck) * 100) / 100;
  const chanceOf = (v) => formula(bet, v);
  const candidates = items.filter((i) => i.value > bet && chanceOf(i.value) >= upgrade.minChance);
  const gauge = async () => Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, ''));
  for (const p of [75, 50, 30]) {
    await page.click(`[data-act="up-pct"][data-p="${p}"]`);
    const target = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    const shown = await gauge();
    assert.equal(shown, chanceOf(target));
    const bestDiff = Math.min(...candidates.map((i) => Math.abs(chanceOf(i.value) - p)));
    assert.ok(Math.abs(Math.abs(shown - p) - bestDiff) < 1e-9, `${p}%: picked ${shown}%, best possible diff ${bestDiff}`);
    assert.equal(await page.getAttribute(`[data-act="up-pct"][data-p="${p}"]`, 'class'), 'on');
    assert.equal(await page.isDisabled('#upBtn'), false);
    assert.equal(await page.inputValue('#upRange'), String(p), 'slider follows the button');
  }
  // the slider: any percentage between min and max chance picks the closest target
  const { min, max } = await page.$eval('#upRange', (el) => ({ min: Number(el.min), max: Number(el.max) }));
  assert.deepEqual({ min, max }, { min: Math.max(1, Math.ceil(upgrade.minChance)), max: Math.floor(upgrade.maxChance / upgrade.luck) });
  assert.equal(max, 75);
  for (const v of [12, 58, 41]) {
    await page.$eval('#upRange', (el, x) => {
      el.value = String(x);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const target = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    const shown = await gauge();
    assert.equal(shown, chanceOf(target));
    const bestDiff = Math.min(...candidates.map((i) => Math.abs(chanceOf(i.value) - v)));
    assert.ok(Math.abs(Math.abs(shown - v) - bestDiff) < 1e-9, `${v}%: picked ${shown}%, best possible diff ${bestDiff}`);
    assert.equal(await page.textContent('#upRangeVal'), `${v}%`);
    assert.equal(await page.locator('#upPcts button.on').count(), 0);
  }
  // dragging it with the mouse/finger works too
  const box = await page.locator('#upRange').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 30, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.inputValue('#upRange'), String(max));
  assert.equal(await page.textContent('#upRangeVal'), `${max}%`);
  {
    const shown = await gauge();
    const bestDiff = Math.min(...candidates.map((i) => Math.abs(chanceOf(i.value) - max)));
    assert.ok(Math.abs(Math.abs(shown - max) - bestDiff) < 1e-9, `dragged to ${max}%: picked ${shown}%`);
  }
  await page.click('[data-act="up-pct"][data-p="30"]');
  // adding an item re-picks the target for the same percentage
  if ((await page.locator('[data-act="up-pick"]').count()) > 1) {
    await page.click('[data-act="up-tab"][data-v="inv"]');
    await page.click('[data-act="up-pick"] >> nth=1');
    const bet2 = num(await page.textContent('#upSlots .slot:first-child .slot-val'));
    const t2 = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    assert.ok(t2 > bet2);
    assert.equal(await page.getAttribute('[data-act="up-pct"][data-p="30"]', 'class'), 'on');
  }
  // the bet changes elsewhere (an item sold in the profile): the same percentage picks again
  await page.click('[data-act="up-tab"][data-v="inv"]');
  const selected = await page.$$eval('[data-act="up-pick"].sel', (els) => els.map((e) => Number(e.dataset.inv)));
  if (selected.length > 1) {
    await page.evaluate(() => (location.hash = '#/profile'));
    await page.waitForSelector(`[data-act="sell"][data-inv="${selected[1]}"]`);
    await page.click(`[data-act="sell"][data-inv="${selected[1]}"]`);
    await page.waitForFunction((id) => !document.querySelector(`[data-act="sell"][data-inv="${id}"]`), selected[1]);
    await page.evaluate(() => (location.hash = '#/upgrade'));
    await page.waitForSelector('#upPcts button');
    const bet3 = num(await page.textContent('#upSlots .slot:first-child .slot-val'));
    const t3 = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    const ch = (v) => formula(bet3, v);
    const cands = items.filter((i) => i.value > bet3 && ch(i.value) >= upgrade.minChance);
    const best = Math.min(...cands.map((i) => Math.abs(ch(i.value) - 30)));
    assert.ok(Math.abs(Math.abs(ch(t3) - 30) - best) < 1e-9, 'target re-picked for 30% with the new bet');
    assert.equal(await gauge(), ch(t3));
    assert.equal(await page.getAttribute('[data-act="up-pct"][data-p="30"]', 'class'), 'on');
  }
  // picking a target by hand drops the percentage highlight
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.click('[data-act="up-target"] >> nth=0');
  assert.equal(await page.locator('#upPcts button.on').count(), 0);
  // with bad luck 1.3 a real 75% doesn't exist (80 / 1.3 = 61%): the button is not offered
  await demo.ctx.settings.update({ upgrade_luck: 1.3 });
  await page.reload();
  await page.waitForSelector('#upPcts button');
  assert.deepEqual(await page.locator('#upPcts button').allTextContents(), ['50%', '30%']);
  assert.equal(await page.getAttribute('#upRange', 'max'), '61');
  await demo.ctx.settings.update({ upgrade_luck: 1.06 });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('upgrader: the chance on screen is the one the server rolls; a changed chance is shown before a new try', { skip }, async () => {
  const give = async (name) => {
    const it = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === name);
    return (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [ME.id, it.id])).id;
  };
  const inv = await give('Chimpanzini Bananini'); // 30
  const spooky = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Spooky and Pumpky'); // 200
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector(`[data-act="up-pick"][data-inv="${inv}"]`);
  await page.click(`[data-act="up-pick"][data-inv="${inv}"]`);
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.click(`[data-act="up-target"][data-id="${spooky.id}"]`);
  const gauge = async () => Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, ''));
  // 30 / 200 * 90 = 13.5%, 1.06 times lower = 12.73%
  assert.equal(await gauge(), 12.73);
  // the main admin changes the bad luck while the player looks at the old chance
  await demo.ctx.settings.update({ upgrade_luck: 2 });
  const upsBefore = (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_upgrades WHERE user_id = $1', [ME.id])).n;
  await page.click('#upBtn');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Шанс изменился — проверь и попробуй ещё раз');
  await page.waitForFunction(() => document.querySelector('#gPct').textContent.replace(/\s/g, '') === '6,75%');
  assert.equal((await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_upgrades WHERE user_id = $1', [ME.id])).n, upsBefore, 'nothing rolled');
  assert.ok(await page.$(`[data-act="up-target"][data-id="${spooky.id}"].sel`), 'the target is still picked');
  assert.equal(num(await page.textContent('#upSlots .slot:first-child .slot-val')), 30, 'and the bet too');
  // the next try uses the new chance; the server rolls with exactly what was shown
  await page.click('#upBtn');
  await page.waitForSelector('.result', { timeout: 9000 });
  const last = await demo.ctx.db.one('SELECT chance FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.equal(Number(last.chance), 6.75);
  await page.click('.result [data-act="close-modal"]');
  await demo.ctx.settings.update({ upgrade_luck: 1.06 });
  assert.deepEqual(errors.filter((e) => !/status of 409/.test(e)), []);
  await page.context().close();
});

test('case strip: before an opening the brainrots drift round after round; the spin goes on from there without a jump; the strip does not grow', { skip }, async () => {
  await demo.app.setBalance(ME.id, 5000);
  const { page, errors } = await open({ path: `/#/case/${demo.bySlug.noob.id}` });
  await page.waitForSelector('#roulette');
  const x = () => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#track')).transform).m41);
  // drifting to the left, slowly
  const a = await x();
  await page.waitForTimeout(1000);
  const speed = a - (await x());
  assert.ok(speed > 30 && speed < 60, `${speed} px/s`);
  // a round of 20 brainrots over and over: the loop has no seam
  const names = await page.$$eval('#track .r-tile .r-name', (els) => els.map((e) => e.textContent));
  assert.ok(names.length >= 40 && names.every((n, i) => i + 20 >= names.length || n === names[i + 20]));
  // the brainrots in view right before the spin starts and right after: the same, in the same place
  await page.evaluate(() => {
    const track = document.querySelector('#track');
    const box = document.querySelector('#roulette');
    const view = () => {
      const br = box.getBoundingClientRect();
      return [...track.children]
        .map((t) => ({ n: t.querySelector('.r-name').textContent, l: t.getBoundingClientRect().left - br.left }))
        .filter((t) => t.l > -130 && t.l < br.width);
    };
    const loop = () => {
      window.__last = view();
      if (!window.__after) requestAnimationFrame(loop);
    };
    loop();
    new MutationObserver(() => {
      if (window.__after) return;
      window.__after = view();
      window.__before = window.__last;
    }).observe(track, { childList: true });
  });
  await page.click('[data-act="open"]');
  await page.waitForFunction(() => window.__after);
  const seam = await page.evaluate(() => ({ before: window.__before, after: window.__after }));
  assert.ok(seam.before.length >= 3);
  assert.deepEqual(seam.after.map((t) => t.n), seam.before.map((t) => t.n));
  seam.after.forEach((t, i) => assert.ok(Math.abs(t.l - seam.before[i].l) <= 3, `${t.n}: ${seam.before[i].l} → ${t.l}`));
  // it lands on what the server gave; the next spin goes on from there; the strip keeps its size
  for (let k = 0; k < 2; k++) {
    await page.waitForSelector('.result', { timeout: 10000 });
    assert.equal(await page.textContent('#track .r-tile.win .r-name'), await page.textContent('.result-name'));
    assert.equal(await page.locator('#track .r-tile.win').count(), 1);
    assert.ok((await page.locator('#track .r-tile').count()) <= 70);
    await page.click('.result [data-act="close-modal"]');
    await page.waitForSelector('.modal-wrap', { state: 'detached' });
    if (k === 0) {
      const still = await x();
      await page.waitForTimeout(400);
      assert.equal(await x(), still, 'stays on the drop until the next opening');
      await page.click('[data-act="open"]');
    }
  }
  assert.deepEqual(errors, []);
  await page.context().close();
  // people who asked for less motion: the strip stands still
  const { page: calm } = await open({ path: `/#/case/${demo.bySlug.noob.id}` });
  await calm.emulateMedia({ reducedMotion: 'reduce' });
  await calm.reload();
  await calm.waitForSelector('#roulette');
  const c0 = await calm.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#track')).transform).m41);
  await calm.waitForTimeout(600);
  assert.equal(await calm.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#track')).transform).m41), c0);
  await calm.context().close();
});

test('fast spin: a switch under Open and Upgrade; the case strip and the upgrader pointer stop in about a second; remembered', { skip }, async () => {
  const { page, errors } = await open({ path: `/#/case/${demo.bySlug.noob.id}` });
  await page.waitForSelector('#openRow [data-act="open"]');
  const sw = page.locator('[data-act="fast"]');
  assert.equal(await sw.count(), 1);
  assert.equal((await sw.textContent()).trim(), 'Быстрая прокрутка');
  assert.equal(await sw.getAttribute('aria-pressed'), 'false', 'off at first: the usual spin');
  await sw.click();
  assert.equal(await sw.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('bs_fast')), '1');
  // the case: the strip stops in about a second, on the drop the server gave
  let t0 = Date.now();
  await page.click('#openRow [data-act="open"]');
  await page.waitForSelector('.result', { timeout: 9000 });
  let took = Date.now() - t0;
  assert.ok(took < 3000, `the case took ${took} ms`);
  assert.match(await page.evaluate(() => document.querySelector('#track').style.transition), /^transform 12[0-6]\dms /);
  const name = await page.textContent('.result-name');
  assert.equal((await demo.app.get('/api/inventory', { user: ME })).body.inventory[0].item.name, name);
  assert.equal(await page.textContent('#track .r-tile.win .r-name'), name);
  await page.click('.result [data-act="close-modal"]');
  // remembered on this device: still on after a reload, and in the upgrader too
  await page.reload();
  await page.waitForSelector('[data-act="fast"]');
  assert.equal(await page.getAttribute('[data-act="fast"]', 'aria-pressed'), 'true');
  await page.evaluate(() => (location.hash = '#/upgrade'));
  await page.waitForSelector('[data-act="up-pick"]');
  assert.equal(await page.getAttribute('[data-act="fast"]', 'aria-pressed'), 'true');
  const upgrade = async () => {
    await page.click('[data-act="up-tab"][data-v="inv"]');
    await page.click('[data-act="up-pick"] >> nth=0');
    await page.click('[data-act="up-tab"][data-v="targets"]');
    await page.click('[data-act="up-target"] >> nth=0');
    await page.click('#upBtn');
  };
  t0 = Date.now();
  await upgrade();
  await page.waitForSelector('.result', { timeout: 9000 });
  took = Date.now() - t0;
  assert.ok(took < 3000, `the upgrade took ${took} ms`);
  assert.match(await page.evaluate(() => document.querySelector('#gPtr').style.transition), /^transform 1\.1s /);
  let last = await demo.ctx.db.one('SELECT won FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.equal(await page.textContent('.result-title'), last.won ? 'Успех!' : 'Не повезло');
  await page.click('.result [data-act="close-modal"]');
  // switched off: the usual spin again
  await page.waitForSelector('[data-act="fast"]');
  await page.click('[data-act="fast"]');
  assert.equal(await page.getAttribute('[data-act="fast"]', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('bs_fast')), '0');
  t0 = Date.now();
  await upgrade();
  await page.waitForFunction(() => /^transform 4\.6s /.test(document.querySelector('#gPtr').style.transition));
  await page.waitForSelector('.result', { timeout: 9000 });
  took = Date.now() - t0;
  assert.ok(took > 4500, `the usual upgrade took ${took} ms`);
  last = await demo.ctx.db.one('SELECT won FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.equal(await page.textContent('.result-title'), last.won ? 'Успех!' : 'Не повезло');
  await page.click('.result [data-act="close-modal"]');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('rocket on brainrots: stake a brainrot, a cash-out pays a brainrot + coins', { skip }, async () => {
  const at = (x, edge = 20) => (max) => Math.floor((1 - (100 - edge) / (100 * x + 0.5)) * max);
  const items = [...demo.ctx.game.catalog.items.values()];
  const spooky = items.find((i) => i.name === 'Spooky and Pumpky'); // 200
  const inv = (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [ME.id, spooky.id])).id;
  const { page, errors } = await open({ path: '/#/crash' });
  await page.waitForSelector('#crSeg');
  await page.click('[data-act="cr-mode"][data-m="brainrots"]');
  await page.waitForSelector('#crGrid');
  assert.equal(await page.isDisabled('#crBtn'), true, 'nothing staked yet');
  await page.click(`[data-act="cr-pick"][data-inv="${inv}"]`);
  assert.equal(num(await page.textContent('#crBetVal')), 200);
  assert.equal(await page.isDisabled('#crBtn'), false);
  demo.app.tg.reset();
  uiRng.queue.push(at(100));
  await page.click('#crBtn');
  await page.waitForSelector('#crBtn.cash');
  // the staked brainrot is gone from the inventory right away
  assert.equal((await demo.ctx.db.one("SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1", [inv])).n, 0);
  await page.waitForFunction(() => parseFloat(document.querySelector('#crMult').textContent.replace(',', '.')) >= 1.3);
  await page.click('#crBtn');
  await page.waitForSelector('.crash-stage.won');
  const r = await demo.ctx.db.one("SELECT win, win_item->>'itemId' AS item, cash_mult FROM bs_crash WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [ME.id]);
  const win = Number(r.win);
  const best = items.filter((i) => i.enabled && i.value <= win).sort((a, b) => b.value - a.value)[0];
  assert.equal(Number(r.item), best.id);
  // the won brainrot is shown in the result and is in the inventory
  assert.ok(await page.$(`.crash-note .cr-win-item`));
  assert.equal(await page.textContent('.cr-win-item b'), best.name);
  const ownInv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.ok(ownInv.some((i) => i.item.id === best.id));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('rocket: launch, the multiplier grows, a cash-out pays what the server counted; an explosion takes the bet', { skip }, async () => {
  const at = (x, edge = 20) => (max) => Math.floor((1 - (100 - edge) / (100 * x + 0.5)) * max);
  await demo.app.setBalance(ME.id, 1000);
  const { page, errors } = await open({ path: '/#/crash' });
  await page.waitForSelector('#crBtn');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Кейсы', 'Апгрейдер', 'Ракета', 'Дайсы', 'Профиль', 'Админ']);
  assert.equal(await page.getAttribute('#tabbar button.on', 'data-tab'), 'crash');
  assert.equal(await page.textContent('#crMult'), '1,00x');
  assert.equal(await page.textContent('#crBtn'), 'Запустить');
  const bal = async () => num(await page.textContent('#bal'));
  // more than the balance
  await page.fill('#crBet', '5000');
  await page.click('#crBtn');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Недостаточно монет');
  await page.waitForSelector('.toast', { state: 'detached', timeout: 6000 });
  await page.fill('#crBet', '0');
  await page.click('#crBtn');
  await page.waitForSelector('.toast.error');
  assert.equal((await page.textContent('.toast.error')).replace(/\s/g, ' '), 'Ставка от 100 до 100 000 монет');
  // fly and cash out
  uiRng.queue.push(at(100));
  await page.fill('#crBet', '100');
  await page.click('#crBtn');
  await page.waitForSelector('#crBtn.cash');
  assert.equal(await bal(), 900);
  assert.equal(await page.isDisabled('#crBet'), true);
  await page.waitForFunction(() => parseFloat(document.querySelector('#crMult').textContent.replace(',', '.')) >= 1.1);
  assert.match(await page.textContent('#crBtn'), /^Забрать\s*\d+$/);
  assert.equal(await page.locator('#tabbar button.on').count(), 1);
  await page.click('#tabbar [data-tab="cases"]');
  assert.equal(await page.getAttribute('#tabbar button.on', 'data-tab'), 'crash', 'tabs wait while the rocket flies');
  await page.click('#crBtn');
  await page.waitForSelector('.crash-stage.won');
  const last = await demo.ctx.db.one('SELECT cash_mult, win FROM bs_crash WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  const won = Number(last.win);
  assert.ok(Number(last.cash_mult) >= 1.1);
  assert.equal(won, Math.floor(100 * Number(last.cash_mult)));
  assert.equal(await page.textContent('#crMult'), `${Number(last.cash_mult).toFixed(2).replace('.', ',')}x`);
  assert.equal(await page.textContent('#crNote .money b'), `+${won}`);
  assert.equal(await bal(), 900 + won);
  assert.equal(await page.textContent('#crBtn'), 'Запустить');
  // an explosion at 1.20x: the bet is lost
  uiRng.queue.push(at(1.2));
  await page.click('#crBtn');
  await page.waitForSelector('.crash-stage.boom', { timeout: 8000 });
  assert.equal(await page.textContent('#crMult'), '1,20x');
  assert.equal(await page.textContent('#crNote'), 'Взорвалась на 1,20x');
  assert.equal(await bal(), 800 + won);
  assert.equal(await page.textContent('#crBtn'), 'Запустить');
  // the app reloaded while the rocket flies: it is still there and can be cashed out
  uiRng.queue.push(at(500));
  await page.click('#crBtn');
  await page.waitForSelector('#crBtn.cash');
  await page.reload();
  await page.waitForSelector('#crBtn.cash');
  await page.waitForFunction(() => parseFloat(document.querySelector('#crMult').textContent.replace(',', '.')) > 1);
  await page.click('#crBtn');
  await page.waitForSelector('.crash-stage.won');
  const again = await demo.ctx.db.one("SELECT status, win FROM bs_crash WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.equal(again.status, 'cashed');
  assert.equal(await bal(), 700 + won + Number(again.win));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('live drops: hovering a tile shows the case or the upgrader it came from (tap on phones)', { skip }, async () => {
  const items = [...demo.ctx.game.catalog.items.values()];
  const it = items.find((i) => i.name === 'Spooky and Pumpky');
  demo.ctx.live.pushDrop(
    { id: 9000001, at: new Date().toISOString(), kind: 'upgrade', value: it.value, item: demo.ctx.game.publicItem(it), user: { name: 'Апгрейдер-тест' }, caseId: null },
    0,
  );
  const visible = (loc) => loc.evaluate((el) => getComputedStyle(el).opacity === '1');
  const caseOf = (id) => demo.ctx.game.catalog.cases.get(id);
  const { feed } = (await demo.app.get('/api/feed')).body;
  const caseDrop = feed.find((d) => d.kind === 'case' && d.caseId);
  assert.ok(caseDrop, 'the demo feed has case drops');

  // computer with a mouse: hover
  {
    const { page, errors } = await open({ width: 1280, height: 860, touch: false });
    await page.waitForSelector('#feed .drop');
    assert.equal(await page.evaluate(() => matchMedia('(hover: hover)').matches), true);
    const tiles = page.locator('#feed .drop');
    const n = await tiles.count();
    const kinds = await tiles.evaluateAll((els) => els.map((e) => e.dataset.src));
    // every tile carries its source, hidden until hovered
    for (let i = 0; i < n; i++) assert.equal(await visible(tiles.nth(i).locator('.drop-src')), false);
    const up = tiles.nth(kinds.indexOf('upgrade'));
    await up.hover();
    await page.waitForTimeout(300);
    assert.equal(await visible(up.locator('.drop-src')), true);
    assert.equal(await up.locator('.src-name').textContent(), 'Апгрейдер');
    assert.equal(await up.locator('.src-art svg').count(), 1);
    // a case drop: that very case, by name
    const feedNow = (await demo.app.get('/api/feed')).body.feed.slice(0, n);
    const ci = feedNow.findIndex((d) => d.kind === 'case');
    const tile = tiles.nth(ci);
    await tile.hover();
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), true);
    assert.equal(await tile.locator('.src-name').textContent(), caseOf(feedNow[ci].caseId).name_ru);
    assert.equal(await visible(up.locator('.drop-src')), false, 'the previous tile went back');
    // moving away restores the drop
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), false);
    // the top drop of the day too
    const top = (await demo.app.get('/api/feed')).body.top24;
    await page.hover('#top24');
    await page.waitForTimeout(300);
    assert.equal(await visible(page.locator('#top24 .drop-src')), true);
    assert.equal(
      await page.textContent('#top24 .src-name'),
      top.kind === 'upgrade' ? 'Апгрейдер' : caseOf(top.caseId).name_ru,
    );
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // phone: a tap shows it, another tap hides it; nothing else happens
  {
    const { page, errors } = await open();
    await page.waitForSelector('#feed .drop');
    assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
    const tile = page.locator('#feed .drop').first();
    await tile.tap();
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), true);
    assert.equal(await tile.locator('.src-name').textContent(), 'Апгрейдер');
    assert.equal(new URL(page.url()).hash, '', 'stays on the main screen');
    const second = page.locator('#feed .drop').nth(1);
    await second.tap();
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), false, 'one at a time');
    assert.equal(await visible(second.locator('.drop-src')), true);
    await second.tap();
    await page.waitForTimeout(300);
    assert.equal(await visible(second.locator('.drop-src')), false);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test('promo code from the balance button', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="topup"]');
  await page.click('.topup [data-act="promo"]');
  await page.fill('#promoInput', 'brainrot100');
  await page.click('#promoForm button');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before + 100);
  await page.click('[data-act="topup"]');
  await page.click('.topup [data-act="promo"]');
  await page.fill('#promoInput', 'brainrot100');
  await page.click('#promoForm button');
  await page.waitForSelector('.toast.error');
  assert.match(await page.textContent('.toast.error'), /Ты уже активировал этот промокод/);
  await page.context().close();
});

test('top-up menu: Stars, brainrots and promo code', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('[data-act="topup"]');
  await page.waitForSelector('.topup .tu-opts');
  assert.equal(await page.textContent('.topup .sheet-title'), 'Пополнение');
  assert.deepEqual(await page.locator('.tu-opt b').allTextContents(), ['Звёзды', 'Брейнроты']);
  assert.equal(await page.textContent('.tu-promo'), 'Промокод');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depForm');
  await page.click('[data-act="tu-menu"]');
  await page.waitForSelector('.tu-opts');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('top-up with Telegram Stars: invoice opens, payment is credited', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.waitForSelector('#starsForm');
  assert.equal(num(await page.textContent('#starsGet')), 100, 'default 100 stars at rate 1');
  await page.fill('#starsInput', '0');
  assert.equal(await page.isDisabled('#starsPay'), true);
  await page.fill('#starsInput', '40');
  assert.equal(num(await page.textContent('#starsGet')), 40);
  assert.equal(num(await page.textContent('#starsPay')), 40);
  demo.app.tg.reset();
  await page.click('#starsPay');
  await page.waitForFunction(() => window.__tgCalls.some((c) => c[0] === 'openInvoice'));
  const link = await page.evaluate(() => window.__tgCalls.find((c) => c[0] === 'openInvoice')[1]);
  assert.match(link, /^https:\/\/t\.me\/\$inv_/);
  const inv = demo.app.tg.calls('createInvoiceLink')[0].payload;
  assert.deepEqual(inv.prices, [{ label: '40 монет', amount: 40 }]);
  // Telegram: pre-checkout, then the payment message, then the Mini App callback
  await demo.app.sendUpdate({ pre_checkout_query: { id: 'pq1', from: { is_bot: false, ...ME }, currency: 'XTR', total_amount: 40, invoice_payload: inv.payload } });
  assert.equal(demo.app.tg.calls('answerPreCheckoutQuery')[0].payload.ok, true);
  await demo.app.sendUpdate({
    message: {
      message_id: 501, date: 0, chat: { id: ME.id, type: 'private' }, from: { is_bot: false, ...ME },
      successful_payment: { currency: 'XTR', total_amount: 40, invoice_payload: inv.payload, telegram_payment_charge_id: 'ui-charge-1', provider_payment_charge_id: '' },
    },
  });
  await page.evaluate(() => window.__invoiceCb('paid'));
  await page.waitForSelector('.toast.ok');
  assert.match(await page.textContent('.toast.ok'), /Баланс пополнен: \+40/);
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b + 40, before);
  await page.waitForSelector('.modal-wrap', { state: 'detached' }); // sheet closed
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('referral codes: an admin makes one, a player types it in when topping up, the admin sees who came', { skip }, async () => {
  const p = demo.others[7];
  await demo.app.post('/api/bootstrap', { user: p });
  // the admin makes a code
  {
    const { page, errors } = await open({ path: '/#/admin/referrals' });
    await page.waitForSelector('#refNew');
    assert.equal(await page.textContent('.adm-tabs .chip.on'), 'Рефералы');
    await page.fill('#refNew [name="code"]', 'vasya');
    await page.fill('#refNew [name="note"]', 'Стример Вася');
    await page.click('#refNew button[type=submit]');
    await page.waitForSelector('.promo-row .code:text("VASYA")');
    assert.equal(await page.textContent('.promo-row:has(.code:text("VASYA")) small:not(.ref-stats)'), 'Стример Вася');
    assert.match(await page.textContent('.promo-row:has(.code:text("VASYA")) .ref-stats'), /^Ур\. 1Игроков: 0Пополнили: 0Пополнений: 0/);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the player types it in when paying with Stars (a wrong one is refused first)
  {
    const { page, errors } = await open({ user: p });
    await page.waitForSelector('.case-grid');
    await page.click('[data-act="topup"]');
    await page.click('[data-act="tu-stars"]');
    await page.waitForSelector('#starsForm #refIn');
    assert.equal(await page.textContent('#starsForm label:has(#refIn)'), 'Промокод или реф-код (если есть)');
    await page.fill('#refIn', 'nope');
    await page.click('#starsPay');
    await page.waitForSelector('.toast.error');
    assert.equal(await page.textContent('.toast.error'), 'Нет такого кода');
    await page.fill('#refIn', 'vasya');
    await page.click('#starsPay');
    await page.waitForFunction(() => window.__tgCalls.some((c) => c[0] === 'openInvoice'));
    await page.evaluate(() => window.__invoiceCb('cancelled'));
    assert.equal((await demo.ctx.db.one('SELECT ref_code FROM bs_users WHERE id = $1', [p.id])).ref_code, 'VASYA');
    // from now on the forms ask only for a promo code (the auto promo code)
    await page.click('.modal-backdrop');
    await page.waitForSelector('.modal-wrap', { state: 'detached' });
    await page.click('[data-act="topup"]');
    await page.click('[data-act="tu-brainrots"]');
    await page.waitForSelector('#depForm #refIn');
    assert.equal(await page.textContent('#depForm label:has(#refIn)'), 'Промокод (если есть)');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the admin: one player came with the code, shown in the code and on the player card
  {
    const { page, errors } = await open({ path: '/#/admin/referrals' });
    await page.waitForSelector('.promo-row .code:text("VASYA")');
    assert.match(await page.textContent('.promo-row:has(.code:text("VASYA")) .ref-stats'), /^Ур\. 1Игроков: 1Пополнили: 0/);
    await page.click('.promo-row:has(.code:text("VASYA")) .row-main');
    await page.waitForSelector('.form-head .code');
    assert.equal(await page.textContent('.form-head .code'), 'VASYA');
    assert.deepEqual(await page.$$eval('#admBody .list .row .row-main > b', (els) => els.map((e) => e.textContent)), [p.first_name]);
    await page.click(`#admBody .list a[href="#/admin/users/${p.id}"]`);
    await page.waitForSelector('[data-flag="is_banned"]');
    assert.equal(await page.textContent('.kv:has(a.code) a.code'), 'VASYA');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  await demo.app.del('/api/admin/referrals/VASYA', { user: ME });
});

// ------------------------------------------------------------------ auto promo code
/** Telegram's messages about a paid invoice. */
const payInvoice = (u, payload, stars, charge) =>
  demo.app.sendUpdate({
    message: {
      message_id: 9500, date: 0, chat: { id: u.id, type: 'private' }, from: { is_bot: false, ...u },
      successful_payment: { currency: 'XTR', total_amount: stars, invoice_payload: payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' },
    },
  });

const AP = [7811, 7812, 7813].map((id, i) => ({ id, first_name: `Промо${i + 1}`, language_code: 'ru' }));

test('auto promo code: a card on the cases screen — code, bonus, time left; «Пополнить» types the code in; paid with the bonus once', { skip }, async () => {
  const p = AP[0];
  await demo.app.post('/api/bootstrap', { user: p });
  await demo.app.setBalance(p.id, 0);
  const cur = await demo.ctx.autoPromo.current();
  const { page, errors } = await open({ user: p });
  await page.waitForSelector('#apCard');
  // above the FREE case, as in the picture: tag, title, time left / code / bonus, three buttons
  assert.deepEqual(await page.$$eval('#view > *', (els) => els.slice(0, 2).map((e) => e.id || e.className)), ['apCard', 'free-card']);
  assert.equal(await page.textContent('.ap-tag'), 'Авто-промокод');
  assert.equal(await page.textContent('.ap-title'), 'Каждые 2 часа новый бонус к пополнению');
  assert.deepEqual(await page.$$eval('.ap-cell small', (els) => els.map((e) => e.textContent)), ['Осталось', 'Промокод', 'Бонус']);
  assert.equal(await page.textContent('#apCode'), cur.code);
  assert.equal(await page.textContent('#apPct'), `+${cur.pct}%`);
  assert.ok(cur.pct >= 5 && cur.pct <= 15);
  assert.deepEqual(await page.$$eval('.ap-btns .btn', (els) => els.map((e) => e.textContent)), ['Открыть кейс', 'Пополнить', 'Промокод']);
  // the time left is what is left of the server's code, and it counts down
  const left = async () => {
    const [h, m, s] = (await page.textContent('#apLeft')).split(':').map(Number);
    return h * 3600 + m * 60 + s;
  };
  const l1 = await left();
  assert.ok(Math.abs(l1 - Math.floor((cur.endsAt - Date.now()) / 1000)) <= 2, String(l1));
  assert.ok(l1 <= 2 * 3600);
  await page.waitForTimeout(1100);
  assert.ok((await left()) < l1, 'counts down');
  // «Открыть кейс»: down to the cases; «Промокод»: the promo code window
  await page.click('[data-act="ap-cases"]');
  await page.waitForFunction(() => window.scrollY > 100);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.ap-btns [data-act="promo"]');
  await page.waitForSelector('#promoInput');
  await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // «Пополнить»: the top-up with the code typed in; paid → the stars' coins + the bonus
  await page.click('[data-act="ap-topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.waitForSelector('#starsForm #refIn');
  assert.equal(await page.inputValue('#refIn'), cur.code);
  assert.equal(await page.textContent('#starsForm label:has(#refIn)'), 'Промокод или реф-код (если есть)');
  await page.fill('#starsInput', '200');
  demo.app.tg.reset();
  await page.click('#starsPay');
  await page.waitForFunction(() => window.__tgCalls.some((c) => c[0] === 'openInvoice'));
  const inv = demo.app.tg.calls('createInvoiceLink')[0].payload;
  await payInvoice(p, inv.payload, 200, 'ui-ap-1');
  await page.evaluate(() => window.__invoiceCb('paid'));
  await page.waitForSelector('.toast.ok');
  const bonus = Math.floor((200 * cur.pct) / 100);
  assert.match(await page.textContent('.toast.ok'), new RegExp(`\\+${200 + bonus}$`));
  await page.waitForFunction((n) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === n, 200 + bonus);
  assert.equal((await demo.ctx.db.one('SELECT ref_code FROM bs_users WHERE id = $1', [p.id])).ref_code, null, 'not tied to a referral code');
  // used: «Пополнить» no longer types it in, by hand it is refused
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  await page.waitForFunction(() => window.__BS.autoPromo && window.__BS.autoPromo.used === true);
  await page.click('[data-act="ap-topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.waitForSelector('#starsForm #refIn');
  assert.equal(await page.inputValue('#refIn'), '');
  await page.fill('#refIn', cur.code.toLowerCase());
  await page.click('#starsPay');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Ты уже активировал этот промокод');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('auto promo code: when the time is up the card shows the next code by itself; a late old code is «expired»; off — no card', { skip }, async () => {
  const p = AP[1];
  await demo.app.post('/api/bootstrap', { user: p });
  const cur = await demo.ctx.autoPromo.current();
  // the code ends in 3 seconds
  await demo.ctx.db.query("UPDATE bs_auto_promos SET ends_at = now() + interval '3 seconds' WHERE id = $1", [cur.id]);
  demo.ctx.autoPromo.reset();
  const { page, errors } = await open({ user: p });
  await page.waitForSelector('#apCard');
  assert.equal(await page.textContent('#apCode'), cur.code);
  assert.match(await page.textContent('#apLeft'), /^00:00:0[0-3]$/);
  await page.waitForFunction((old) => document.querySelector('#apCode') && document.querySelector('#apCode').textContent !== old, cur.code, { timeout: 15000 });
  const next = await demo.ctx.autoPromo.current();
  assert.equal(await page.textContent('#apCode'), next.code);
  assert.equal(await page.textContent('#apPct'), `+${next.pct}%`);
  assert.notEqual(await page.textContent('#apLeft'), '00:00:00');
  // the old code typed in now
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.waitForSelector('#starsForm #refIn');
  await page.fill('#refIn', cur.code);
  await page.click('#starsPay');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Срок действия промокода истёк');
  await page.context().close();
  // switched off by the main admin: no card
  await demo.ctx.settings.update({ auto_promo: false });
  {
    const { page: pg } = await open({ user: p });
    await pg.waitForSelector('.free-card');
    assert.equal(await pg.locator('#apCard').count(), 0);
    await pg.context().close();
  }
  await demo.ctx.settings.update({ auto_promo: true });
  assert.deepEqual(errors, []);
});

test('auto promo code with a brainrot deposit: typed in from the card, the request keeps it, the admin sees it and the credit pays the bonus', { skip }, async () => {
  const p = AP[2];
  await demo.app.post('/api/bootstrap', { user: p });
  const cur = await demo.ctx.autoPromo.current();
  const items = [...demo.ctx.game.catalog.items.values()];
  const it = items.find((i) => i.name === 'Cerberus');
  {
    const { page, errors } = await open({ user: p });
    await page.waitForSelector('#apCard');
    await page.click('[data-act="ap-topup"]');
    await page.click('[data-act="tu-brainrots"]');
    await page.waitForSelector('#depForm #refIn');
    assert.equal(await page.inputValue('#refIn'), cur.code);
    await page.fill('#depForm [name="nick"]', 'PromoRBX');
    await page.click(`[data-dep="${it.id}"]`);
    await page.click('#depBtn');
    await page.waitForSelector('.toast.ok');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  const req = await demo.ctx.db.one("SELECT id, promo_code, promo_pct FROM bs_requests WHERE user_id = $1 AND kind = 'deposit' ORDER BY id DESC LIMIT 1", [p.id]);
  assert.deepEqual([req.promo_code, req.promo_pct], [cur.code, cur.pct]);
  // the admin's request card: the code and its %, then the bonus paid with the credit
  const { page, errors } = await open({ path: `/#/admin/deposits/${req.id}` });
  await page.waitForSelector('#reqAmount');
  assert.equal((await page.textContent('.kv:has-text("Авто-промокод") b')).replace(/\s/g, ' '), `${cur.code} +${cur.pct}%`);
  const b0 = Number((await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [p.id])).balance);
  await page.fill('#reqAmount', '1000');
  await page.click('[data-ra="credit"]');
  await page.click('#confirmYes');
  const bonus = Math.floor((1000 * cur.pct) / 100);
  await page.waitForFunction((t) => [...document.querySelectorAll('.kv')].some((k) => k.textContent.replace(/\s/g, ' ').includes(t)), `бонус ${bonus}`);
  assert.equal(Number((await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [p.id])).balance), b0 + 1000 + bonus);
  assert.deepEqual(errors, []);
  await page.context().close();
});

const BOSS = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
let payN = 0;
/** A Stars payment as Telegram sends it. */
const payStars = (u, stars) =>
  demo.app.sendUpdate({
    message: {
      message_id: 9000 + payN, date: 0, chat: { id: u.id, type: 'private' }, from: { is_bot: false, ...u },
      successful_payment: { currency: 'XTR', total_amount: stars, invoice_payload: starsPayload(u.id, stars, stars, Math.floor(Date.now() / 1000), 'uiref' + String(++payN).padStart(7, '0')), telegram_payment_charge_id: 'ui-ref-' + payN, provider_payment_charge_id: '' },
    },
  });

test('referral levels: a partner opens Referrals from the profile — code, level, stats, players; streamer mode blurs the sums', { skip }, async () => {
  const partner = demo.others[8];
  const players = ['Миша', 'Ваня', 'Глеб'].map((n, i) => ({ id: 7300 + i, first_name: n, language_code: 'ru' }));
  try {
    // not a partner yet: no button, no screen
    {
      const { page, errors } = await open({ user: partner, path: '/#/profile' });
      await page.waitForSelector('.p-card');
      assert.equal(await page.locator('.p-link').count(), 0);
      await page.evaluate(() => (location.hash = '#/refs'));
      await page.waitForSelector('.case-grid');
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    // a code of theirs: two players top up with it (+10% at level 1), one only comes
    assert.equal((await demo.app.post('/api/admin/referrals', { user: ME, body: { code: 'zhenya', owner: String(partner.id) } })).status, 200);
    for (const [i, u] of players.entries()) {
      await demo.app.post('/api/bootstrap', { user: u });
      assert.equal((await demo.app.post('/api/topup/stars', { user: u, body: { stars: 10, ref: 'zhenya' } })).body.ref, 'ZHENYA');
      if (i < 2) await payStars(u, (i + 1) * 100);
    }
    const { page, errors } = await open({ user: partner, path: '/#/profile' });
    await page.waitForSelector('.p-link');
    assert.equal((await page.textContent('.p-link')).trim(), 'Рефералы');
    await page.click('.p-link');
    await page.waitForSelector('.ref-card');
    assert.equal(await page.evaluate(() => location.hash), '#/refs');
    assert.equal(await page.textContent('.vh-title'), 'Рефералы');
    assert.equal(await page.textContent('.ref-lbl'), 'Твой реферальный код');
    assert.equal((await page.textContent('.ref-code')).trim(), 'ZHENYA');
    assert.equal(await page.textContent('.ref-gives'), 'Игроки с этим кодом получают +10% к каждому пополнению');
    assert.equal(await page.locator('.ref-off').count(), 0);
    // came, topped up, top-ups, withdrawals, bets, bonus
    const stats = async () => page.$$eval('.stats .stat', (els) => els.map((e) => [e.querySelector('.s-lbl').textContent, e.querySelector('.s-val').textContent.trim()]));
    assert.deepEqual((await stats()).map(([l, v]) => [l, num(v)]), [
      ['Пришли по коду', 3],
      ['Пополнили баланс', 2],
      ['Пополнения', 300],
      ['Выводы', 0],
      ['Ставки', 0],
      ['Бонус игрокам', 30],
    ]);
    // levels: the first one reached, the way to the second
    assert.equal(await page.textContent('.lvl-next-top span'), 'До уровня 2');
    assert.equal(await page.textContent('.lvl-next-top b'), '2 / 50');
    assert.deepEqual(await page.$$eval('.lvl', (els) => els.map((e) => [e.className, e.querySelector('.lvl-main b').textContent, e.querySelector('.lvl-main small').textContent, e.querySelector('.lvl-pct').textContent])), [
      ['lvl on', 'Уровень 1', 'от 0 игроков', '+10%'],
      ['lvl', 'Уровень 2', 'от 50 игроков', '+25%'],
      ['lvl', 'Уровень 3', 'от 150 игроков', '+35%'],
    ]);
    assert.equal(await page.locator('.lvl.on .lvl-mark svg').count(), 1, 'the current level is checked');
    // the players, newest first
    const rows = async () => page.$$eval('.ref-players .row', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('.badge').textContent]));
    assert.deepEqual(await rows(), [
      ['Глеб', 'Без пополнений'],
      ['Ваня', 'Пополнял'],
      ['Миша', 'Пополнял'],
    ]);
    assert.equal(await page.textContent('.sec-title:has(.cnt) .cnt'), '3');
    // the code is copied by a tap
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('.ref-code');
    await page.waitForSelector('.toast.ok');
    assert.equal(await page.textContent('.toast.ok'), 'Скопировано');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'ZHENYA');
    // back to the profile
    await page.click('.view-head .back');
    await page.waitForSelector('.p-card');

    // streamer mode: the sums are blurred; the players' names and the code stay
    await page.click('[data-act="streamer"]');
    await page.click('.p-link');
    await page.waitForSelector('.ref-card');
    await page.waitForTimeout(250);
    const blur = (sel) => page.$$eval(sel, (els) => els.map((e) => /^blur\(/.test(getComputedStyle(e).filter)));
    assert.deepEqual(await blur('.stats .stat .s-val'), [false, false, false, false, false, false]);
    assert.deepEqual(await blur('.stats .stat .s-val b'), [true, true, true, true], 'deposits, withdrawals, bets, bonus');
    assert.deepEqual(await blur('.ref-players .row b'), [false, false, false]);
    assert.deepEqual(await blur('.ref-code'), [false]);
    assert.equal((await page.textContent('.ref-code')).trim(), 'ZHENYA');
    await page.click('.view-head .back');
    await page.click('[data-act="streamer"]');

    // the main admin gives the code its own %: shown instead of the level's
    await demo.app.post('/api/bootstrap', { user: BOSS });
    assert.equal((await demo.app.put('/api/admin/referrals/ZHENYA', { user: BOSS, body: { bonusPct: 12 } })).status, 200);
    await page.click('.p-link');
    await page.waitForFunction(() => document.querySelector('.ref-gives')?.textContent.includes('+12%'));
    assert.equal(await page.textContent('.ref-own'), 'Индивидуальные условия: +12% к пополнениям независимо от уровня');
    // switched off: the partner still sees it, marked
    await demo.app.put('/api/admin/referrals/ZHENYA', { user: ME, body: { active: false } });
    await page.reload();
    await page.waitForSelector('.ref-off');
    assert.equal(await page.textContent('.ref-off'), 'Код выключен: новые игроки не могут его ввести');
    // a small phone: nothing sticks out
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
    assert.deepEqual(errors, []);
    await page.context().close();

    // unlinked: the button goes away
    await demo.app.put('/api/admin/referrals/ZHENYA', { user: ME, body: { owner: '' } });
    const p2 = await open({ user: partner, path: '/#/profile' });
    await p2.page.waitForSelector('.p-card');
    assert.equal(await p2.page.locator('.p-link').count(), 0);
    assert.deepEqual(p2.errors, []);
    await p2.page.context().close();
  } finally {
    await demo.app.del('/api/admin/referrals/ZHENYA', { user: ME });
  }
});

test('referral levels: the main admin edits the levels and a code\'s own %; an admin links the partner; regular admins see no levels or %', { skip }, async () => {
  const partner = demo.others[4];
  await demo.app.post('/api/bootstrap', { user: BOSS });
  const DEF = [
    { from: 0, pct: 10 },
    { from: 50, pct: 25 },
    { from: 150, pct: 35 },
  ];
  try {
    // a regular admin: no levels, no own %, but can link a partner
    {
      const { page, errors } = await open({ path: '/#/admin/referrals' });
      await page.waitForSelector('#refNew');
      assert.equal(await page.locator('#refLevels').count(), 0);
      assert.equal(await page.locator('#refNew [name="bonusPct"]').count(), 0);
      assert.equal(await page.getAttribute('#refNew [name="owner"]', 'placeholder'), '@username или ID');
      await page.fill('#refNew [name="code"]', 'lesha');
      await page.fill('#refNew [name="owner"]', '@nobody_here_ui');
      await page.click('#refNew button[type=submit]');
      await page.waitForSelector('.toast.error');
      assert.equal(await page.textContent('.toast.error'), 'Партнёр не найден: он должен сначала открыть бота');
      await page.fill('#refNew [name="owner"]', String(partner.id));
      await page.click('#refNew button[type=submit]');
      await page.waitForSelector('.promo-row .code:text("LESHA")');
      assert.equal(await page.textContent('.promo-row:has(.code:text("LESHA")) .code'), 'LESHA', 'no % for a regular admin');
      assert.equal(await page.textContent('.promo-row:has(.code:text("LESHA")) small:not(.ref-stats)'), 'Партнёр: Лёша');
      await page.click('.promo-row:has(.code:text("LESHA")) .row-main');
      await page.waitForSelector('#refOwnerIn');
      assert.equal(await page.locator('#refBonusIn').count(), 0);
      assert.equal(await page.inputValue('#refOwnerIn'), String(partner.id));
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    assert.equal(Number((await demo.ctx.db.one("SELECT owner_id FROM bs_ref_codes WHERE code = 'LESHA'")).owner_id), partner.id);
    assert.equal((await demo.ctx.db.one("SELECT bonus_pct FROM bs_ref_codes WHERE code = 'LESHA'")).bonus_pct, null, 'by level');

    // the main admin: the levels
    const { page, errors } = await open({ user: BOSS, path: '/#/admin/referrals' });
    await page.waitForSelector('#refLevels .lvl-row');
    const levels = () => page.$$eval('#refLevels .lvl-row', (els) => els.map((e) => [e.querySelector('.lvl-n').textContent, e.querySelector('[name=from]').value, e.querySelector('[name=pct]').value]));
    assert.deepEqual(await levels(), [
      ['Ур. 1', '0', '10'],
      ['Ур. 2', '50', '25'],
      ['Ур. 3', '150', '35'],
    ]);
    assert.equal(await page.getAttribute('#refLevels .lvl-row:nth-child(1) [name=from]', 'readonly'), '', 'the first level is always from 0');
    assert.equal(await page.isDisabled('#refLevels .lvl-row:nth-child(1) [data-lvl-del]'), true);
    // one more level (50 players after the last one), then the second one goes
    await page.click('#lvlAdd');
    assert.deepEqual((await levels())[3], ['Ур. 4', '200', '35']);
    await page.fill('#refLevels .lvl-row:nth-child(4) [name=from]', '300');
    await page.fill('#refLevels .lvl-row:nth-child(4) [name=pct]', '50');
    await page.click('#refLevels .lvl-row:nth-child(2) [data-lvl-del]');
    assert.deepEqual(await levels(), [
      ['Ур. 1', '0', '10'],
      ['Ур. 2', '150', '35'],
      ['Ур. 3', '300', '50'],
    ]);
    await page.click('#refLevels button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.deepEqual(demo.ctx.settings.get('ref_levels'), [
      { from: 0, pct: 10 },
      { from: 150, pct: 35 },
      { from: 300, pct: 50 },
    ]);
    await page.waitForSelector('.toast', { state: 'detached', timeout: 8000 });
    // the same number of players twice is refused, nothing changes
    await page.fill('#refLevels .lvl-row:nth-child(3) [name=from]', '150');
    await page.click('#refLevels button[type=submit]');
    await page.waitForSelector('.toast.error');
    assert.equal(await page.textContent('.toast.error'), 'Уровни: первый — от 0 игроков, каждый следующий — от большего числа, бонус от 0 до 500%');
    assert.equal(demo.ctx.settings.get('ref_levels')[2].from, 300);
    // the code: +10% by level 1; its own % on the code page
    assert.equal(await page.textContent('.promo-row:has(.code:text("LESHA")) .code'), 'LESHA +10%');
    assert.match(await page.textContent('.promo-row:has(.code:text("LESHA")) .ref-stats'), /^Ур\. 1Игроков: 0Пополнили: 0/);
    await page.click('.promo-row:has(.code:text("LESHA")) .row-main');
    await page.waitForSelector('#refBonusIn');
    const kv = (label) => page.textContent(`.kv:has(span:text-is("${label}")) b`);
    assert.equal(await kv('Бонус, % к пополнению'), '+10% · по уровню');
    assert.equal(await kv('Уровень'), '1');
    assert.equal(await kv('До уровня 2'), '0 / 150');
    assert.equal(await kv('Партнёр'), 'Лёша');
    assert.equal(await page.getAttribute('#refBonusIn', 'placeholder'), 'по уровню');
    await page.fill('#refBonusIn', '7.5');
    await page.click('#refBonusSave');
    await page.waitForFunction(() => document.querySelector('#admBody').textContent.includes('+7,5% · свой'));
    assert.equal(Number((await demo.ctx.db.one("SELECT bonus_pct FROM bs_ref_codes WHERE code = 'LESHA'")).bonus_pct), 7.5);
    // empty: by level again
    await page.fill('#refBonusIn', '');
    await page.click('#refBonusSave');
    await page.waitForFunction(() => document.querySelector('#admBody').textContent.includes('+10% · по уровню'));
    assert.equal((await demo.ctx.db.one("SELECT bonus_pct FROM bs_ref_codes WHERE code = 'LESHA'")).bonus_pct, null);
    // the partner: empty unlinks
    await page.fill('#refOwnerIn', '');
    await page.click('#refOwnerSave');
    await page.waitForFunction(() => [...document.querySelectorAll('.kv')].some((k) => k.textContent === 'Партнёр—'));
    assert.equal((await demo.ctx.db.one("SELECT owner_id FROM bs_ref_codes WHERE code = 'LESHA'")).owner_id, null);
    // a small phone: the levels and the code page fit
    await page.setViewportSize({ width: 360, height: 740 });
    for (const h of ['#/admin/referrals', '#/admin/referrals/LESHA']) {
      await page.evaluate((x) => (location.hash = x), h);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, h);
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    await demo.ctx.settings.update({ ref_levels: DEF });
    await demo.app.del('/api/admin/referrals/LESHA', { user: ME });
  }
});

test('website mode: Stars invoice opens as a Telegram link and the balance updates by itself', { skip }, async () => {
  const u = await demo.ctx.db.one('SELECT id, web_ver FROM bs_users WHERE id = $1', [ME.id]);
  const token = signWebToken(u.id, u.web_ver, demo.ctx.config.sessionSecret);
  const { page, context, errors } = await open({ stub: false, path: `/?login=${token}` });
  await context.route('https://t.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>Telegram</title>' }));
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.fill('#starsInput', '15');
  await page.click('#starsPay');
  await page.waitForSelector('#starsLink');
  // changing the amount drops the link made for the old amount
  await page.fill('#starsInput', '500');
  await page.waitForSelector('#starsPay');
  assert.equal(await page.locator('#starsLink').count(), 0);
  assert.equal(num(await page.textContent('#starsPay')), 500);
  await page.fill('#starsInput', '15');
  demo.app.tg.reset();
  await page.click('#starsPay');
  await page.waitForSelector('#starsLink');
  assert.match(await page.getAttribute('#starsLink', 'href'), /^https:\/\/t\.me\/\$inv_/);
  assert.equal(await page.getAttribute('#starsLink', 'target'), '_blank');
  const inv = demo.app.tg.calls('createInvoiceLink')[0].payload;
  assert.deepEqual(inv.prices.map((p) => p.amount), [15]);
  const [tab] = await Promise.all([context.waitForEvent('page'), page.click('#starsLink')]);
  await tab.close();
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  await demo.app.sendUpdate({
    message: {
      message_id: 502, date: 0, chat: { id: ME.id, type: 'private' }, from: { is_bot: false, ...ME },
      successful_payment: { currency: 'XTR', total_amount: 15, invoice_payload: inv.payload, telegram_payment_charge_id: 'ui-charge-web', provider_payment_charge_id: '' },
    },
  });
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b + 15, before, { timeout: 8000 });
  await page.waitForSelector('.toast.ok');
  assert.deepEqual(errors, []);
  await context.close();
});

test('deposit by brainrots: nickname + brainrots picked from the list, request reaches the admins', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depForm');
  // no text field any more: a list of brainrots to pick from
  assert.equal(await page.locator('#depForm textarea').count(), 0);
  const total = await page.locator('#depGrid [data-dep]').count();
  assert.equal(total, (await demo.app.get('/api/catalog', { user: ME })).body.items.length, 'every brainrot can be picked');
  assert.equal(await page.isDisabled('#depBtn'), true, 'nothing picked yet');
  const items = [...demo.ctx.game.catalog.items.values()];
  const idOf = (n) => items.find((i) => i.name === n).id;
  const visibleNames = () => page.$$eval('#depGrid [data-dep]:not(.hidden) .item-name', (els) => els.map((e) => e.textContent));
  // search
  await page.fill('#depSearch', 'trala');
  const found = await visibleNames();
  assert.ok(found.length >= 1 && found.length < total);
  assert.ok(found.every((n) => n.toLowerCase().includes('trala')), found.join(', '));
  await page.click(`[data-dep="${idOf('Tralalero Tralala')}"]`);
  const isSel = (n) => page.$eval(`[data-dep="${idOf(n)}"]`, (el) => el.classList.contains('sel'));
  assert.equal(await isSel('Tralalero Tralala'), true);
  assert.equal(await page.isDisabled('#depBtn'), false);
  // how many: + / −
  const row = (n) => page.locator(`#depSel [data-row="${idOf(n)}"]`);
  await row('Tralalero Tralala').locator('[data-dep-inc]').click();
  await row('Tralalero Tralala').locator('[data-dep-inc]').click();
  assert.equal(await row('Tralalero Tralala').locator('.dep-cnt b').textContent(), '3');
  await page.fill('#depSearch', 'cerberus');
  assert.deepEqual(await visibleNames(), ['Cerberus']);
  await page.click(`[data-dep="${idOf('Cerberus')}"]`);
  assert.equal(await page.locator('#depSel .dep-row').count(), 2);
  await row('Cerberus').locator('[data-dep-dec]').click(); // 1 -> removed
  assert.equal(await page.locator('#depSel .dep-row').count(), 1);
  assert.equal(await isSel('Cerberus'), false);
  await page.click(`[data-dep="${idOf('Cerberus')}"]`);
  await page.fill('#depSearch', '');
  assert.equal((await visibleNames()).length, total);
  // nickname is still required
  await page.fill('#depForm [name=nick]', '');
  await page.click('#depBtn');
  await page.waitForSelector('.toast.error');
  assert.match(await page.textContent('.toast.error'), /ник в Roblox/);
  await page.fill('#depForm [name=nick]', 'TestRoblox');
  await page.click('#depBtn');
  await page.waitForSelector('.toast.ok');
  const req = await demo.ctx.db.one("SELECT * FROM bs_requests WHERE user_id = $1 AND kind = 'deposit' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.equal(req.nick, 'TestRoblox');
  assert.deepEqual(
    req.offer.map((e) => [e.name, e.count]),
    [['Tralalero Tralala', 3], ['Cerberus', 1]],
  );
  assert.equal(req.details, 'Tralalero Tralala ×3, Cerberus');
  assert.equal(await page.textContent('.toast.ok'), `Заявка #${req.id} отправлена`);
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // the nickname is remembered
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  assert.equal(await page.inputValue('#depForm [name=nick]'), 'TestRoblox');
  await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // the admin sees exactly what was picked
  await page.evaluate((id) => (location.hash = '#/admin/deposits/' + id), req.id);
  await page.waitForSelector('.req .offer-n');
  assert.deepEqual(await page.locator('.req .offer-n').allTextContents(), ['×3', '×1']);
  const sum = req.offer.reduce((s, e) => s + e.value * e.count, 0);
  assert.equal(num(await page.textContent('.req .kv:has-text("На сумму") b')), sum);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: «Можно пополнять» in the item editor decides which brainrots players can deposit', { skip }, async () => {
  const cer = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Cerberus');
  const { page, errors } = await open({ path: '/#/admin/items' });
  await page.waitForSelector(`[data-item="${cer.id}"]`);
  await page.click(`[data-item="${cer.id}"]`);
  await page.waitForSelector('#itemForm [name="depositable"]', { state: 'attached' });
  assert.equal(await page.isChecked('#itemForm [name="depositable"]'), true, 'on by default');
  assert.ok((await page.textContent('#itemForm')).includes('Можно пополнять'));
  await page.click('#itemForm label.switch:has([name="depositable"])');
  await page.click('#itemForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  assert.equal(demo.ctx.game.catalog.items.get(cer.id).depositable, false);
  // the player no longer sees it in the deposit list (after the app reloads its data)
  await page.reload();
  await page.waitForSelector('#admBody');
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depGrid [data-dep]');
  assert.equal(await page.locator(`#depGrid [data-dep="${cer.id}"]`).count(), 0);
  const shown = await page.locator('#depGrid [data-dep]').count();
  assert.equal(shown, (await demo.app.get('/api/catalog', { user: ME })).body.depositIds.length);
  await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // switched back on
  await page.click(`[data-item="${cer.id}"]`);
  await page.waitForSelector('#itemForm [name="depositable"]', { state: 'attached' });
  assert.equal(await page.isChecked('#itemForm [name="depositable"]'), false);
  await page.click('#itemForm label.switch:has([name="depositable"])');
  await page.click('#itemForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  assert.equal(demo.ctx.game.catalog.items.get(cer.id).depositable, true);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('withdrawal from the profile: listed brainrots go as they are, others are exchanged with a remainder', { skip }, async () => {
  const give = async (name) => {
    const it = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === name);
    return (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [ME.id, it.id])).id;
  };
  const garama = await give('Garama and Madundung');
  const croc = await give('Bombardiro Crocodilo'); // 75, can't be withdrawn
  const goose = await give('Bombombini Gusini'); // 85, can't be withdrawn
  const cerberus = await give('Cerberus');
  const { page, errors } = await open({ path: '/#/profile' });
  await page.waitForSelector('.p-card');
  const before = await page.locator('.grid.items .item').count();
  const bal = num(await page.textContent('#bal'));

  // 1) only listed brainrots: straight to a request
  await page.click('[data-act="withdraw"]');
  await page.waitForSelector('#wdForm');
  assert.equal(await page.isDisabled('#wdBtn'), true);
  assert.equal(await page.locator('[data-wd]').count(), before);
  await page.click(`[data-wd="${cerberus}"]`);
  assert.equal(num(await page.textContent('#wdBtn')), 150);
  await page.fill('#wdForm [name=nick]', 'TestRoblox');
  await page.click('#wdBtn');
  await page.waitForSelector('.toast.ok');
  let row = await demo.ctx.db.one("SELECT * FROM bs_requests WHERE user_id = $1 AND kind = 'withdraw' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.deepEqual(row.items.map((i) => i.name), ['Cerberus']);
  assert.equal(row.exchange, null);
  await page.waitForFunction((n) => document.querySelectorAll('.grid.items .item').length === n, before - 1);
  await page.waitForSelector('.toast', { state: 'detached' });

  // 2) others picked: choose one of the listed brainrots, the remainder is shown and credited
  await page.click('[data-act="withdraw"]');
  await page.waitForSelector('#wdForm');
  assert.equal(await page.inputValue('#wdForm [name=nick]'), 'TestRoblox', 'nickname remembered');
  for (const id of [garama, croc, goose]) await page.click(`[data-wd="${id}"]`);
  await page.click('#wdBtn');
  await page.waitForSelector('#wdSwap:not(.hidden) [data-wt]');
  assert.equal(await page.textContent('#wdSwap .sheet-title'), 'Выбери, кого вывести');
  const names = await page.locator('#wdTargets .item-name').allTextContents();
  assert.deepEqual([...names].sort(), ['Burguro and Fryuro', 'Capitano Moby', 'Cerberus', 'Dragon Cannelloni', 'Garama and Madundung']);
  const id = (n) => [...demo.ctx.game.catalog.items.values()].find((i) => i.name === n).id;
  assert.equal(await page.isDisabled(`[data-wt="${id('Dragon Cannelloni')}"]`), true, '1100 > 160');
  assert.equal(await page.textContent(`[data-wt="${id('Cerberus')}"] .wd-rest`), 'Остаток +10');
  assert.equal(await page.textContent(`[data-wt="${id('Burguro and Fryuro')}"] .wd-rest`), 'Остаток +60');
  assert.equal(await page.isDisabled('#wdGo'), true);
  // back to the list keeps the selection
  await page.click('#wdBack');
  assert.equal(await page.locator('#wdGrid .item.sel').count(), 3);
  await page.click('#wdBtn');
  await page.click(`[data-wt="${id('Cerberus')}"]`);
  await page.click('#wdGo');
  await page.waitForSelector('.toast.ok');
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b + 10, bal);
  row = await demo.ctx.db.one("SELECT * FROM bs_requests WHERE user_id = $1 AND kind = 'withdraw' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.deepEqual(row.items.map((i) => i.name), ['Cerberus', 'Garama and Madundung']);
  assert.equal(row.exchange.rest, 10);
  await page.waitForFunction((n) => document.querySelectorAll('.grid.items .item').length === n, before - 4);
  assert.equal((await demo.app.get('/api/inventory', { user: ME })).body.inventory.length, before - 4);
  await demo.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE user_id = $1 AND kind = 'withdraw' AND status = 'new'", [ME.id]);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: deposits tab — conversation with the player, coins, completion', { skip }, async () => {
  const kira = demo.others[1];
  const req = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE user_id = $1 AND kind = 'deposit'", [kira.id]);
  const { page, errors } = await open({ path: '/#/admin/deposits' });
  await page.waitForSelector('#reqList .req-row');
  await page.waitForFunction(() => document.querySelector('.chip-n[data-cnt="deposit"]')?.textContent !== '');
  assert.ok(Number(await page.textContent('.chip-n[data-cnt="deposit"]')) >= 1);
  assert.match(await page.textContent(`[data-req="${req.id}"]`), /KiraPlays/);
  await page.click(`[data-req="${req.id}"]`);
  await page.waitForSelector('#reqChat .msg');
  assert.equal(await page.textContent('.req .form-head b'), `Пополнение #${req.id}`);
  assert.equal(await page.textContent('.req .code'), 'KiraPlays');
  const bubbles = () => page.locator('#reqChat .msg').allTextContents();
  assert.match((await bubbles()).join('|'), /Добавила, ник KiraPlays/);

  // admin -> player through the bot
  demo.app.tg.reset();
  await page.fill('#reqMsg', 'Отправил трейд, прими');
  await page.click('#reqForm button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('#reqChat .msg.admin')].some((m) => m.textContent.includes('Отправил трейд, прими')));
  const toKira = demo.app.tg.calls('sendMessage').find((c) => Number(c.payload.chat_id) === kira.id);
  assert.match(toKira.payload.text, /Отправил трейд, прими/);
  assert.equal(await page.inputValue('#reqMsg'), '', 'draft cleared after sending');

  // player answers in the bot -> shows up in the open card by itself
  await page.fill('#reqMsg', 'черновик');
  await demo.app.sendUpdate({
    callback_query: { id: 'cb2', from: { is_bot: false, ...kira }, chat_instance: 'x', data: `rq:${req.id}`, message: { message_id: 1, date: 0, chat: { id: kira.id, type: 'private' }, text: 'x' } },
  });
  await demo.app.message(kira, 'Принял, спасибо!');
  await page.waitForFunction(() => [...document.querySelectorAll('#reqChat .msg.user')].some((m) => m.textContent.includes('Принял, спасибо!')), null, { timeout: 9000 });
  assert.equal(await page.inputValue('#reqMsg'), 'черновик', 'typing is not lost when new messages arrive');

  // credit coins — while a slow background refresh is on its way (it must not undo the result on screen)
  const bal = (await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [kira.id])).balance;
  let slowed = 0;
  await page.route(/\/api\/admin\/requests\/\d+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    // the server answers now, the answer reaches the page 6 s later
    const response = await route.fetch();
    slowed++;
    await new Promise((r) => setTimeout(r, 6000));
    await route.fulfill({ response }).catch(() => {});
  });
  await new Promise((r) => setTimeout(r, 5200)); // a refresh (every 5 s) is now pending
  await page.fill('#reqAmount', '75');
  await page.click('[data-ra="credit"]');
  await page.click('#confirmYes');
  await page.waitForFunction(() => [...document.querySelectorAll('#reqChat .msg.sys')].some((m) => m.textContent.includes('Начислено +75')));
  assert.equal((await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [kira.id])).balance, bal + 75);
  await new Promise((r) => setTimeout(r, 6500)); // the stale refresh has arrived by now
  assert.ok(slowed >= 1, 'a refresh was in flight');
  assert.ok((await page.textContent('#admBody')).includes('Начислено +75'), 'stale refresh did not overwrite the card');
  assert.match(await page.textContent('.req .kv:has-text("Начислено")'), /75/);
  await page.unroute(/\/api\/admin\/requests\/\d+$/);

  // complete
  await page.click('[data-ra="done"]');
  await page.click('#confirmYes');
  await page.waitForFunction(() => document.querySelector('.req .badge')?.textContent === 'Выполнена');
  assert.equal(await page.locator('[data-ra]').count(), 0, 'no actions on a closed request');
  assert.equal((await demo.ctx.db.one('SELECT status FROM bs_requests WHERE id = $1', [req.id])).status, 'done');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: requests are split into «Работает» / «Выполнено» / «Отклонено» (deposits and withdrawals)', { skip }, async () => {
  const someone = demo.others[0];
  const rejected = await demo.ctx.db.one(
    "INSERT INTO bs_requests (user_id, kind, status, nick, details) VALUES ($1, 'deposit', 'rejected', 'NoThanks', 'отклонённая') RETURNING id",
    [someone.id],
  );
  const { page, errors } = await open({ path: '/#/admin/deposits' });
  await page.waitForSelector('#reqList');
  const tabs = () => page.locator('.adm-seg button').allTextContents();
  const badges = () => page.locator('#reqList .badge').allTextContents();
  const rowIds = () => page.$$eval('#reqList [data-req]', (els) => els.map((e) => Number(e.dataset.req)));
  const fromDb = async (kind, statuses) =>
    (await demo.ctx.db.many('SELECT id FROM bs_requests WHERE kind = $1 AND status = ANY($2::text[]) ORDER BY id', [kind, statuses])).map((r) => Number(r.id));
  const sorted = (a) => [...a].sort((x, y) => x - y);
  for (const [section, kind] of [['deposits', 'deposit'], ['withdrawals', 'withdraw']]) {
    await page.evaluate((s) => (location.hash = '#/admin/' + s), section);
    await page.waitForSelector('#reqList');
    assert.deepEqual(await tabs(), ['Работает', 'Выполнено', 'Отклонено']);
    for (const [scope, statuses, labels] of [
      ['active', ['new', 'active'], ['Новая', 'В работе']],
      ['done', ['done'], ['Выполнена']],
      ['rejected', ['rejected'], ['Отклонена']],
    ]) {
      await page.click(`.adm-seg [data-scope="${scope}"]`);
      await page.waitForSelector(`.adm-seg [data-scope="${scope}"].on`);
      await page.waitForSelector('#reqList');
      const want = await fromDb(kind, statuses);
      assert.deepEqual(sorted(await rowIds()), want, `${kind}/${scope}: exactly these requests`);
      assert.ok((await badges()).every((b) => labels.includes(b)), `${kind}/${scope}: ${await badges()}`);
      if (!want.length) assert.ok(await page.isVisible('#reqList .empty-box'));
    }
  }
  // the chosen tab stays when switching sections; the declined deposit is there
  await page.evaluate(() => (location.hash = '#/admin/deposits'));
  await page.waitForSelector('.adm-seg [data-scope="rejected"].on');
  await page.waitForSelector(`#reqList [data-req="${rejected.id}"]`);
  await page.click('.adm-seg [data-scope="active"]');
  await page.waitForSelector('.adm-seg [data-scope="active"].on');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: bot notification link opens the request (?go=…)', { skip }, async () => {
  const wd = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'withdraw' AND status = 'new' ORDER BY id LIMIT 1");
  const { page, errors } = await open({ path: `/?go=admin/withdrawals/${wd.id}` });
  await page.waitForSelector('#reqChat', { state: 'attached' });
  assert.equal(await page.textContent('.req .form-head b'), `Вывод #${wd.id}`);
  assert.ok(!page.url().includes('go='));
  assert.ok((await page.locator('.req .list .row').count()) >= 1, 'held brainrots listed');
  // decline -> brainrots return to the player
  const owner = (await demo.ctx.db.one('SELECT user_id, items FROM bs_requests WHERE id = $1', [wd.id]));
  const invBefore = (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [owner.user_id])).n;
  await page.click('[data-ra="rejected"]');
  assert.match(await page.textContent('.confirm p'), /Брейнроты вернутся в инвентарь игрока/);
  await page.click('#confirmYes');
  await page.waitForFunction(() => document.querySelector('.req .badge')?.textContent === 'Отклонена');
  const invAfter = (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [owner.user_id])).n;
  assert.equal(invAfter, invBefore + owner.items.length);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('language switch: UA and EN texts, saved on the server', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('#langBtn');
  await page.click('[data-lang="en"]');
  await page.waitForSelector('.case-grid');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Cases', 'Upgrader', 'Rocket', 'Dice', 'Profile', 'Admin']);
  assert.equal(await page.textContent('.case-name >> nth=0'), 'DragonDrop in nick');
  assert.equal(await page.textContent('.case-name >> nth=1'), 'Share case');
  assert.equal(await page.textContent('.case-name >> nth=2'), 'Noob case');
  assert.equal(await page.textContent('.live-title span'), 'Live drops');
  assert.equal(await page.textContent('.ap-title'), 'A new top-up bonus every 2 hours');
  assert.deepEqual(await page.$$eval('.ap-btns .btn', (els) => els.map((e) => e.textContent)), ['Open a case', 'Top up', 'Promo code']);
  await page.waitForTimeout(300);
  assert.equal((await apiMe()).me.lang, 'en');
  await page.click('#langBtn');
  await page.click('[data-lang="uk"]');
  await page.waitForSelector('.case-grid');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Кейси', 'Апгрейдер', 'Ракета', 'Дайси', 'Профіль', 'Адмін']);
  assert.equal(await page.textContent('.case-name >> nth=0'), 'DragonDrop у ніку');
  assert.equal(await page.textContent('.case-name >> nth=1'), 'Кейс за репости');
  assert.equal(await page.textContent('.case-name >> nth=4'), 'Рибний кейс');
  assert.equal(await page.textContent('.ap-title'), 'Кожні 2 години новий бонус до поповнення');
  assert.equal(await page.textContent('#langBtn'), 'UA');
  await page.click('#langBtn');
  await page.click('[data-lang="ru"]');
  await page.waitForTimeout(300);
  assert.equal((await apiMe()).me.lang, 'ru');
  await page.context().close();
});

test('theme switch: 6 colours, applied instantly and saved', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('#themeBtn');
  assert.equal(await page.locator('.swatch').count(), 6);
  assert.deepEqual(await page.locator('.swatch span').allTextContents(), ['Жёлто-оранжевый', 'Серо-чёрный', 'Зелёно-синий', 'Красно-синий', 'Фиолетово-розовый', 'Океан']);
  await page.click('[data-theme="redblue"]');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--a1').trim()), '#FF4D6D');
  const header = await page.evaluate(() => window.__tgCalls.filter((c) => c[0] === 'setHeaderColor').at(-1));
  assert.deepEqual(header, ['setHeaderColor', '#070a1c']);
  await page.waitForTimeout(300);
  assert.equal((await apiMe()).me.theme, 'redblue');
  await page.click('[data-theme="sunset"]');
  await page.waitForTimeout(300);
  await page.context().close();
});

test('profile shows the same stats as the server', { skip }, async () => {
  const { page } = await open({ path: '/#/profile' });
  await page.waitForSelector('.stats');
  const s = (await apiMe()).stats;
  const vals = await page.locator('.stats .s-val').allTextContents();
  assert.equal(num(vals[0]), s.casesOpened);
  assert.equal(num(vals[1]), s.totalWon);
  assert.equal(await page.textContent('.best-name'), s.bestDrop.name);
  assert.equal(await page.locator('.grid.items .item').count(), s.inventoryCount);
  await page.context().close();
});

test('live feed updates when someone else opens a case', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('#feed .drop');
  await page.waitForTimeout(500);
  const other = demo.others[4];
  await demo.app.post(`/api/case/${demo.bySlug.summer.id}/open`, { user: other });
  await page.waitForFunction((n) => document.querySelector('#feed .drop .drop-user')?.textContent === n, other.first_name, { timeout: 5000 });
  await page.context().close();
});

test('admin: edit a case price from the panel and players see it', { skip }, async () => {
  const { page, errors } = await open({ path: `/#/admin/cases/${demo.bySlug.pro.id}` });
  await page.waitForSelector('#caseForm');
  await page.fill('#cPrice', '30');
  const rtp = await page.textContent('#lootSum');
  assert.match(rtp, /75%/, 'return recalculated live (22.5 / 30)');
  await page.click('#caseForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  const pub = (await demo.app.get('/api/catalog', { user: demo.others[0] })).body.cases.find((c) => c.slug === 'pro');
  assert.equal(pub.price, 30);
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  assert.equal(num(await page.textContent('.case-price >> nth=3')), 30); // after the nick case, the share case and the Noob case
  // restore
  await page.evaluate((id) => (location.hash = '#/admin/cases/' + id), demo.bySlug.pro.id);
  await page.waitForSelector('#caseForm');
  await page.fill('#cPrice', '25');
  await page.click('#caseForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  // every admin section renders
  for (const s of ['overview', 'deposits', 'withdrawals', 'items', 'users', 'promos', 'settings', 'broadcast']) {
    await page.evaluate((x) => (location.hash = '#/admin/' + x), s);
    await page.waitForSelector('#admBody > :not(.spinner)');
  }
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: categories — make one, drop cases in, players see them under the heading', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/admin/cases' });
  await page.waitForSelector('[data-cat-edit="new"]');
  await page.click('[data-cat-edit="new"]');
  await page.waitForSelector('#catForm');
  await page.fill('#catForm [name=name]', 'Топовые');
  await page.check(`#catForm input[name=case][value="${demo.bySlug.griffin.id}"]`);
  await page.check(`#catForm input[name=case][value="${demo.bySlug.dragon.id}"]`);
  await page.click('#catForm button[type=submit]');
  await page.waitForSelector('.cat-head');
  assert.equal(await page.textContent('.cat-head .sec-title'), 'Топовые');
  assert.equal(await page.locator('.cat-head + .list .row').count(), 2);
  // move one more case there from its editor
  await page.evaluate((id) => (location.hash = '#/admin/cases/' + id), demo.bySlug.mushroom.id);
  await page.waitForSelector('#caseForm [name=category_id]');
  await page.selectOption('#caseForm [name=category_id]', { label: 'Топовые' });
  await page.waitForSelector('.toast', { state: 'detached' }); // the earlier "Saved" toast is gone
  await page.click('#caseForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  // players: cases without a category first, then the titled block
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-cat');
  assert.equal(await page.textContent('.case-cat .cat-title'), 'Топовые');
  assert.deepEqual(await page.locator('.case-cat .case-name').allTextContents(), ['Драгон кейс', 'Грибной кейс', 'Грифон кейс']);
  assert.equal(await page.locator('.case-card').count(), 11, 'every case still listed once');
  assert.ok(!(await page.locator('.case-grid').first().textContent()).includes('Грифон'));
  // delete: the cases go back to the common grid
  await page.evaluate(() => (location.hash = '#/admin/cases'));
  await page.waitForSelector('.cat-head [data-cat-edit]');
  await page.click('.cat-head [data-cat-edit]');
  await page.waitForSelector('#catDel');
  await page.click('#catDel');
  await page.click('#confirmYes');
  await page.waitForFunction(() => !document.querySelector('.cat-head'));
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  assert.equal(await page.locator('.case-cat').count(), 0);
  assert.equal(await page.locator('.case-card').count(), 11);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: case picture upload shows on the case card, removal brings the chest back', { skip }, async () => {
  const id = demo.bySlug.summer.id;
  const { page, errors } = await open({ path: `/#/admin/cases/${id}` });
  await page.waitForSelector('#caseForm #cImgRow');
  assert.equal(await page.$('#cImgDel'), null, 'nothing to remove yet');
  // unsaved edit in the form must survive the upload
  await page.fill('#cPrice', '351');
  const jpg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1360;
    c.height = 1157;
    const g = c.getContext('2d');
    g.fillStyle = '#1d6b3a';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffd23f';
    g.fillRect(300, 250, 700, 600);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.setInputFiles('#cImgFile', { name: 'summer.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await page.waitForSelector('#cImgDel');
  await page.waitForSelector('#cPreview img.case-img');
  assert.equal(await page.inputValue('#cPrice'), '351', 'form edits kept');
  const adm = (await demo.app.get('/api/admin/cases', { user: ME })).body.cases.find((c) => c.id === id);
  assert.match(adm.image, /^\/api\/img\/case\//);
  assert.equal(adm.price, 350, 'price not saved by the upload');
  // stored picture is downscaled to 512px
  const size = await page.evaluate(async (src) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    return [im.naturalWidth, im.naturalHeight];
  }, await page.getAttribute('#cPreview img.case-img', 'src'));
  assert.deepEqual(size, [512, 436]);

  // players see the picture instead of the chest
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  const card = page.locator(`.case-card[data-case="${id}"]`);
  assert.equal(await card.locator('img.case-img').count(), 1);
  assert.equal(await card.locator('svg.chest').count(), 0);
  const box = await card.locator('img.case-img').boundingBox();
  const cardBox = await card.boundingBox();
  assert.ok(box.width > cardBox.width * 0.7 && box.width <= cardBox.width, `picture fills the card (${box.width} of ${cardBox.width})`);
  assert.ok(await card.locator('img.case-img').evaluate((im) => im.complete && im.naturalWidth > 0), 'picture loaded');
  // other cases keep the chest
  assert.equal(await page.locator(`.case-card[data-case="${demo.bySlug.noob.id}"] svg.chest`).count(), 1);

  // remove it again
  await page.evaluate((x) => (location.hash = '#/admin/cases/' + x), id);
  await page.waitForSelector('#cImgDel');
  await page.click('#cImgDel');
  await page.waitForSelector('#cPreview svg.chest');
  assert.equal((await demo.app.get('/api/admin/cases', { user: ME })).body.cases.find((c) => c.id === id).image, null);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: the player card shows where each brainrot came from', { skip }, async () => {
  const p = demo.others[2];
  const items = [...demo.ctx.game.catalog.items.values()];
  const byName = (n) => items.find((i) => i.name === n);
  const noob = demo.bySlug.noob;
  await demo.app.setBalance(p.id, 1000);
  const opened = await demo.app.post(`/api/case/${noob.id}/open`, { user: p });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const gift = await demo.app.post(`/api/admin/users/${p.id}/give`, { user: ME, body: { itemId: byName('Tim Cheese').id } });
  const target = byName('Spooky and Pumpky');
  const up = await demo.ctx.db.one(
    'INSERT INTO bs_upgrades (user_id, bet_value, target_item_id, chance, roll, won) VALUES ($1, 287, $2, 64.57, 12.5, TRUE) RETURNING id',
    [p.id, target.id],
  );
  const row = async (source, itemId, ref) =>
    (await demo.ctx.db.one('INSERT INTO bs_inventory (user_id, item_id, source, ref_id) VALUES ($1, $2, $3, $4) RETURNING id', [p.id, itemId, source, ref])).id;
  const upInv = await row('upgrade', target.id, up.id);
  const dep = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'deposit' ORDER BY id LIMIT 1");
  const depInv = await row('deposit', byName('Cerberus').id, dep.id);
  const wd = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'withdraw' ORDER BY id LIMIT 1");
  const refInv = await row('refund', byName('Capitano Moby').id, wd.id);
  const diceInv = await row('dice', byName('Cerberus').id, null);

  const { page, errors } = await open({ path: `/#/admin/users/${p.id}` });
  await page.waitForSelector('.inv-src');
  const src = (invId) => page.textContent(`.row:has([data-inv="${invId}"]) .inv-src`);
  const when = / · \d{1,2} [а-я]+\.?, \d{2}:\d{2}$/;
  const caseName = demo.ctx.game.catalog.cases.get(noob.id).name_ru;
  assert.match(await src(opened.body.invId), new RegExp(`^${caseName}${when.source}`), 'the name already says «кейс»');
  // a case named without the word gets «Кейс «…»»
  await demo.ctx.db.query("UPDATE bs_cases SET name_ru = 'Сокровища' WHERE id = $1", [noob.id]);
  await page.reload();
  await page.waitForSelector('.inv-src');
  assert.match(await src(opened.body.invId), new RegExp(`^Кейс «Сокровища»${when.source}`));
  await demo.ctx.db.query('UPDATE bs_cases SET name_ru = $2 WHERE id = $1', [noob.id, caseName]);
  assert.match(await src(gift.body.invId), new RegExp(`^Выдал админ ${ME.first_name}${when.source}`));
  assert.match(await src(upInv), new RegExp(`^Апгрейдер · шанс 64,57% · ставка\\s*287${when.source}`));
  assert.match(await src(depInv), new RegExp(`^Пополнение #${dep.id}${when.source}`));
  assert.match(await src(refInv), new RegExp(`^Возврат с вывода #${wd.id}${when.source}`));
  assert.match(await src(diceInv), new RegExp(`^Колор дайсы${when.source}`));
  // the request number opens the request
  await page.click(`.row:has([data-inv="${depInv}"]) .src-link`);
  await page.waitForSelector('.req .form-head b');
  assert.equal(await page.textContent('.req .form-head b'), `Пополнение #${dep.id}`);
  await page.goBack();
  await page.waitForSelector('.inv-src');
  // English admin panel
  await page.evaluate(() => (location.hash = '#/profile'));
  await page.click('[data-act="lang"]');
  await page.click('[data-lang="en"]');
  await page.evaluate((id) => (location.hash = '#/admin/users/' + id), p.id);
  await page.waitForSelector('.inv-src');
  const en = demo.ctx.game.catalog.cases.get(noob.id).name_en;
  assert.ok((await src(opened.body.invId)).startsWith(en));
  assert.ok((await src(upInv)).startsWith('Upgrader · 64.57% chance · bet'));
  await page.click('[data-act="lang"]');
  await page.click('[data-lang="ru"]');
  // the language is saved on the server in the background: wait for it, later tests expect Russian
  for (let i = 0; i < 50 && (await apiMe()).me.lang !== 'ru'; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await apiMe()).me.lang, 'ru');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('main admin: shown as a plain admin, a ban attempt just fails', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const { page, errors } = await open({ path: '/#/admin/users' });
  await page.waitForSelector('#uList .row');
  const html = (sel) => page.$eval(sel, (el) => el.querySelector('.row-side').innerHTML.replace(/<b[^>]*>[^<]*<\/b>/, ''));
  // same badge markup as any other admin (only the balance differs)
  assert.equal(await html(`a[href="#/admin/users/${boss.id}"]`), await html(`a[href="#/admin/users/${ME.id}"]`));
  assert.equal(await page.textContent(`a[href="#/admin/users/${boss.id}"] .badge`), 'Админ');
  await page.click(`a[href="#/admin/users/${boss.id}"]`);
  await page.waitForSelector('[data-flag="is_banned"]');
  assert.equal(await page.textContent('[data-flag="is_banned"]'), 'Забанить');
  assert.equal(await page.textContent('[data-flag="is_admin"]'), 'Снять админа');
  await page.click('[data-flag="is_banned"]');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Что-то пошло не так');
  await page.click('[data-flag="is_admin"]');
  await page.waitForTimeout(400);
  const r = await demo.ctx.db.one('SELECT is_admin, is_banned FROM bs_users WHERE id = $1', [boss.id]);
  assert.deepEqual(r, { is_admin: true, is_banned: false });
  assert.equal(await page.textContent('[data-flag="is_banned"]'), 'Забанить');
  assert.deepEqual(errors.filter((e) => !/status of 403/.test(e)), []);
  await page.context().close();
});

test('Stars rate: the field is only in the main admin\'s settings', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const rate = () => demo.ctx.settings.get('stars_rate');
  const before = rate();
  // a regular admin: no field, saving the rest keeps the rate
  {
    const { page, errors } = await open({ path: '/#/admin/settings' });
    await page.waitForSelector('#setForm');
    assert.equal(await page.locator('[name="stars_rate"]').count(), 0);
    assert.ok(!(await page.textContent('#setForm')).includes('Курс звёзд'));
    await page.fill('[name="start_balance"]', '3');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(demo.ctx.settings.get('start_balance'), 3);
    assert.equal(rate(), before);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the main admin: the field is there and works
  {
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setForm');
    assert.equal(await page.inputValue('[name="stars_rate"]'), String(before));
    assert.ok((await page.textContent('#setForm')).includes('Курс звёзд: монет за 1 ⭐'));
    await page.fill('[name="stars_rate"]', '3');
    await page.fill('[name="start_balance"]', '0');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(rate(), 3);
    // the top-up sheet uses the new rate right away
    await page.click('[data-act="topup"]');
    await page.click('[data-act="tu-stars"]');
    await page.waitForSelector('#starsInput');
    await page.fill('#starsInput', '10');
    await page.waitForFunction(() => document.querySelector('#starsGet').textContent.replace(/\D/g, '') === '30');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  await demo.ctx.settings.update({ stars_rate: before, start_balance: 0 });
});

test('admin: a regular admin edits case odds; the upgrader settings only the main admin', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const noob = demo.bySlug.noob;
  const loot = () => demo.ctx.game.catalog.cases.get(noob.id).items.map((e) => [e.item_id, e.chance]);
  const before = loot();
  const edge = demo.ctx.settings.get('upgrade_edge');
  {
    const { page, errors } = await open({ path: `/#/admin/cases/${noob.id}` });
    await page.waitForSelector('#caseForm .lr-chance');
    await page.fill('#caseForm .lr-chance >> nth=0', '33');
    await page.click('#caseForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.ok(loot().some(([, c]) => c === 33), 'new chance saved');
    await page.evaluate(() => (location.hash = '#/admin/settings'));
    await page.waitForSelector('#setForm [name="upgrade_edge"]');
    assert.equal(await page.locator('[name="upgrade_luck"]').count(), 0, 'bad luck is not shown to regular admins');
    await page.waitForSelector('.toast.ok', { state: 'detached', timeout: 6000 }); // the case was saved
    await page.fill('[name="upgrade_edge"]', '25');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.error');
    assert.equal(await page.textContent('.toast.error'), 'Что-то пошло не так');
    assert.equal(demo.ctx.settings.get('upgrade_edge'), edge);
    assert.deepEqual(errors.filter((e) => !/status of 403/.test(e)), []);
    await page.context().close();
  }
  {
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setForm [name="upgrade_luck"]');
    assert.equal(await page.inputValue('[name="upgrade_luck"]'), '1.06');
    assert.ok((await page.textContent('#setForm')).includes('Невезение апгрейдера: шанс ниже в N раз'));
    await page.fill('[name="upgrade_edge"]', '25');
    await page.fill('[name="upgrade_luck"]', '1.5');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(demo.ctx.settings.get('upgrade_edge'), 25);
    assert.equal(demo.ctx.settings.get('upgrade_luck'), 1.5);
    assert.deepEqual((await demo.app.get('/api/catalog', { user: ME })).body.upgrade, { edge: 25, minChance: 1, maxChance: 80, luck: 1.5 });
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // restore
  const c = demo.ctx.game.catalog.cases.get(noob.id);
  await demo.app.put(`/api/admin/cases/${noob.id}`, {
    user: ME,
    body: { name_ru: c.name_ru, name_uk: c.name_uk, name_en: c.name_en, emoji: c.emoji, color: c.color, sort: c.sort, enabled: c.enabled, price: c.price, category_id: c.category_id, items: before.map(([itemId, chance]) => ({ itemId, chance })) },
  });
  await demo.ctx.settings.update({ upgrade_edge: edge, upgrade_luck: 1.06 });
  assert.deepEqual(loot(), before);
});

test('main admin: bad luck for one account from the player card; that player sees and gets the lower chance', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const p = demo.others[4];
  await demo.app.post('/api/bootstrap', { user: p });
  const luckOf = async () => Number((await demo.ctx.db.one('SELECT upgrade_luck FROM bs_users WHERE id = $1', [p.id])).upgrade_luck);
  // a regular admin: no such control
  {
    const { page, errors } = await open({ path: `/#/admin/users/${p.id}` });
    await page.waitForSelector('[data-flag="is_banned"]');
    assert.equal(await page.locator('#uLuck, #uLuckIn, [data-luck]').count(), 0);
    assert.ok(!(await page.content()).includes('Невезение аккаунта'));
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the main admin sets it in the player card
  {
    const { page, errors } = await open({ user: boss, path: `/#/admin/users/${p.id}` });
    await page.waitForSelector('#uLuckIn');
    assert.equal(await page.textContent('.kv:has(#uLuck) span'), 'Невезение аккаунта: шанс в апгрейдере ниже ещё в N раз');
    assert.equal(await page.textContent('#uLuck'), '×1');
    assert.equal(await page.inputValue('#uLuckIn'), '1');
    await page.fill('#uLuckIn', '2');
    await page.click('[data-luck]');
    await page.waitForSelector('.toast.ok');
    await page.waitForFunction(() => document.querySelector('#uLuck')?.textContent === '×2');
    assert.equal(await page.inputValue('#uLuckIn'), '2');
    assert.equal(await luckOf(), 2);
    // out of range: refused, nothing changes
    await page.waitForSelector('.toast.ok', { state: 'detached', timeout: 6000 });
    await page.fill('#uLuckIn', '50');
    await page.click('[data-luck]');
    await page.waitForSelector('.toast.error');
    assert.equal(await luckOf(), 2);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the player: 30 / 200 * 90 = 13.5%, 1.06 × 2 = 2.12 times lower = 6.36% (other players: 12.73%)
  const items = [...demo.ctx.game.catalog.items.values()];
  const chimp = items.find((i) => i.name === 'Chimpanzini Bananini');
  const spooky = items.find((i) => i.name === 'Spooky and Pumpky');
  const inv = (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [p.id, chimp.id])).id;
  {
    const { page, errors } = await open({ user: p, path: '/#/upgrade' });
    await page.waitForSelector(`[data-act="up-pick"][data-inv="${inv}"]`);
    await page.click(`[data-act="up-pick"][data-inv="${inv}"]`);
    await page.click('[data-act="up-tab"][data-v="targets"]');
    await page.click(`[data-act="up-target"][data-id="${spooky.id}"]`);
    assert.equal(Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, '')), 6.36);
    await page.click('#upBtn');
    await page.waitForSelector('.result', { timeout: 9000 });
    const last = await demo.ctx.db.one('SELECT chance FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [p.id]);
    assert.equal(Number(last.chance), 6.36, 'rolled with the chance on the screen');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  assert.equal((await demo.app.post(`/api/admin/users/${p.id}/luck`, { user: boss, body: { luck: 1 } })).status, 200);
  assert.equal(await luckOf(), 1);
});

test('main admin: switches off sections for the other admins; they lose those tabs', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const chips = (page) => page.$$eval('.adm-tabs .chip', (els) => els.map((e) => e.firstChild.textContent));
  const doneDeposits = async (page) => {
    await page.evaluate(() => (location.hash = '#/admin/deposits'));
    await page.waitForSelector('.adm-seg [data-scope="done"]');
    if (!(await page.$('.adm-seg [data-scope="done"].on'))) await page.click('.adm-seg [data-scope="done"]');
    await page.waitForSelector('.adm-seg [data-scope="done"].on');
    await page.waitForSelector('#reqList .req-row, #reqList .empty-box');
    return page.$$eval('#reqList .req-row', (els) => els.map((e) => e.textContent));
  };
  const ALL_TABS = ['Обзор', 'Пополнения', 'Выводы', 'Кейсы', 'Предметы', 'Игроки', 'Рефералы', 'Промо', 'Настройки', 'Рассылка'];
  // a regular admin sees everything and has no such switches
  {
    const { page, errors } = await open({ path: '/#/admin/settings' });
    await page.waitForSelector('#setForm');
    assert.deepEqual(await chips(page), ALL_TABS);
    assert.equal(await page.locator('[data-sec]').count(), 0);
    assert.ok(!(await page.textContent('#setForm')).includes('Что видят обычные админы'));
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the main admin switches off cases, Stars deposits and broadcasts
  {
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setForm [data-sec]', { state: 'attached' });
    const labels = await page.$$eval('#setForm label:has([data-sec])', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(labels, ['Обзор', 'Пополнения брейнротами', 'Пополнения звёздами', 'Выводы', 'Кейсы', 'Предметы', 'Игроки', 'Рефералы', 'Промо', 'Настройки', 'Рассылка']);
    assert.ok((await page.textContent('#setForm')).includes('Что видят обычные админы'));
    assert.equal(await page.locator('[data-sec]:checked').count(), 11, 'all on by default');
    for (const x of ['cases', 'deposits_stars', 'broadcast']) await page.click(`label:has([data-sec="${x}"])`);
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.deepEqual(demo.ctx.settings.get('admin_hidden'), ['deposits_stars', 'cases', 'broadcast']);
    assert.deepEqual(await chips(page), ALL_TABS, 'the main admin keeps every tab');
    await page.reload();
    await page.waitForSelector('#setForm [data-sec]', { state: 'attached' });
    assert.deepEqual(
      await page.$$eval('[data-sec]', (els) => els.filter((e) => !e.checked).map((e) => e.dataset.sec)),
      ['deposits_stars', 'cases', 'broadcast'],
      'saved',
    );
    // the main admin still sees the Stars payment among the done deposits
    assert.ok((await doneDeposits(page)).some((x) => x.includes('⭐')));
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the regular admin: no Cases / Broadcast tabs; an old link to cases opens the first tab instead
  {
    const { page, errors } = await open({ path: `/#/admin/cases/${demo.bySlug.noob.id}` });
    await page.waitForSelector('.adm-tabs .chip.on');
    assert.deepEqual(await chips(page), ['Обзор', 'Пополнения', 'Выводы', 'Предметы', 'Игроки', 'Рефералы', 'Промо', 'Настройки']);
    assert.equal(await page.textContent('.adm-tabs .chip.on'), 'Обзор');
    await page.waitForSelector('.adm-stats');
    // deposits: brainrot requests only, no Stars payments
    assert.ok(!(await doneDeposits(page)).some((x) => x.includes('⭐')), 'no Stars payments');
    assert.ok((await page.textContent('#admBody')).length > 0);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  await demo.ctx.settings.update({ admin_hidden: [] });
});

test('non-admins have no admin tab and cannot open it', { skip }, async () => {
  const { page } = await open({ user: demo.others[1], path: '/#/admin/cases' });
  await page.waitForSelector('.case-grid');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Кейсы', 'Апгрейдер', 'Ракета', 'Дайсы', 'Профиль']);
  await page.context().close();
});

test('website mode: login link works outside Telegram and is removed from the URL', { skip }, async () => {
  const u = await demo.ctx.db.one('SELECT id, web_ver FROM bs_users WHERE id = $1', [ME.id]);
  const token = signWebToken(u.id, u.web_ver, demo.ctx.config.sessionSecret);
  const { page } = await open({ stub: false, path: `/?login=${token}`, width: 1280, height: 860 });
  await page.waitForSelector('.case-grid');
  assert.ok(!page.url().includes('login='));
  assert.equal(await page.textContent('.brand-name'), 'DragonDrop');
  const box = await page.locator('#app').boundingBox();
  assert.ok(box.width <= 560 && box.x > 300, 'centred column on desktop');
  await page.reload();
  await page.waitForSelector('.case-grid'); // token kept in localStorage
  await page.context().close();

  const anon = await open({ stub: false });
  await anon.page.waitForSelector('.splash a.btn');
  assert.equal(await anon.page.getAttribute('.splash a.btn', 'href'), 'https://t.me/DragonDrop_Bot');
  assert.equal(await anon.page.textContent('.splash-name'), 'DragonDrop');
  await anon.page.context().close();
});

test('streamer mode: a switch in the profile blurs every coin amount (balance, prices, wins, sums); names, nicks and brainrots stay; pointing at an amount shows it; remembered', { skip }, async () => {
  // a computer with a mouse, as when streaming
  const { page, errors } = await open({ path: '/#/profile', width: 1100, height: 900, touch: false });
  await page.waitForSelector('.p-card');
  await page.waitForSelector('#feed .drop');
  const sw = page.locator('[data-act="streamer"]');
  assert.equal((await sw.textContent()).trim(), 'Режим стримера');
  assert.equal(await sw.getAttribute('aria-pressed'), 'false', 'off at first');
  const me = (await apiMe()).me;
  const blurred = (sel) => page.$$eval(sel, (els) => els.map((e) => /^blur\(/.test(getComputedStyle(e).filter)));
  const settle = () => page.waitForTimeout(250); // the blur fades in / out
  const AMOUNTS = ['#bal', '.p-bal .priv', '.inv-sum .priv', '#feed .drop-val .priv', '#top24 .top24-val .priv', '#view .sell-btn .priv'];
  const SHOWN = ['.p-name', '.p-sub', '.p-card .avatar', '#feed .drop-user', '#top24 .top24-user', '#feed .drop-art', '#top24 .top24-art', '#view .grid.items .item-art', '#view .grid.items .item-name'];
  const check = async (on) => {
    for (const sel of AMOUNTS) {
      const b = await blurred(sel);
      assert.ok(b.length && b.every((x) => x === on), `${sel} ${on ? 'blurred' : 'clear'}`);
    }
    const sums = await page.$$eval('.stats .stat', (els) => els.filter((e) => /Выиграно|Продано на/.test(e.textContent)).map((e) => /^blur\(/.test(getComputedStyle(e.querySelector('.s-val .priv')).filter)));
    assert.deepEqual(sums, [on, on], 'won / sold for');
    for (const sel of SHOWN) {
      const b = await blurred(sel);
      assert.ok(b.length && b.every((x) => !x), `${sel} never blurred`);
    }
  };
  // off: nothing blurred, the real values are there
  await check(false);
  assert.equal(num(await page.textContent('#bal')), me.balance);

  await sw.click();
  await settle();
  assert.equal(await sw.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('bs_streamer')), '1');
  await check(true);
  assert.equal(await page.textContent('.p-name'), me.name);
  assert.match(await page.textContent('.p-sub'), new RegExp(`ID ${me.id}$`));
  // the values are the real ones under the blur: pointing at one shows it
  await page.hover('.p-bal .money');
  await settle();
  assert.deepEqual(await blurred('.p-bal .priv'), [false]);
  assert.equal(num(await page.textContent('.p-bal .priv')), me.balance);
  assert.deepEqual(await blurred('#bal'), [true], 'only what is pointed at');
  await page.hover('.bal');
  await settle();
  assert.deepEqual(await blurred('#bal'), [false], 'the balance button');
  await page.mouse.move(5, 895);
  await settle();
  assert.deepEqual(await blurred('#bal'), [true]);
  // a drop arriving live: its value is blurred, its player's name is not
  const other = demo.others[1];
  await demo.app.setBalance(other.id, 100);
  const before = await page.locator('#feed .drop').count();
  assert.equal((await demo.app.post(`/api/case/${demo.bySlug.noob.id}/open`, { user: other, body: {} })).status, 200);
  await page.waitForFunction((n) => document.querySelectorAll('#feed .drop.enter').length > 0 || document.querySelectorAll('#feed .drop').length > n, before);
  assert.deepEqual(await blurred('#feed .drop >> nth=0 >> .drop-val .priv'), [true]);
  assert.deepEqual(await blurred('#feed .drop >> nth=0 >> .drop-user'), [false]);
  assert.equal(await page.textContent('#feed .drop >> nth=0 >> .drop-user'), other.first_name);
  // the balance stays blurred when it changes
  await page.click('.sell-btn >> nth=0');
  await page.waitForSelector('.toast.ok');
  await settle();
  assert.deepEqual(await blurred('#bal'), [true]);
  assert.equal(num(await page.textContent('#bal')), (await apiMe()).me.balance);
  // the Roblox nick is a nick: not blurred
  await page.click('[data-act="withdraw"]');
  await page.waitForSelector('#wdForm [name=nick]');
  await page.fill('#wdForm [name=nick]', 'MyRobloxNick');
  await settle();
  assert.deepEqual(await blurred('#wdForm [name=nick]'), [false]);
  await page.evaluate(() => document.querySelector('.modal-backdrop').click());
  await page.waitForSelector('#wdForm', { state: 'detached' });
  // remembered on this device
  await page.reload();
  await page.waitForSelector('.p-card');
  await page.waitForSelector('#feed .drop');
  await page.mouse.move(5, 895);
  await settle();
  assert.equal(await page.getAttribute('[data-act="streamer"]', 'aria-pressed'), 'true');
  await check(true);
  // the cases: their prices blurred, names and the auto promo card not
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  await settle();
  const prices = await blurred('.case-card .case-price .priv');
  assert.ok(prices.length >= 5 && prices.every(Boolean), 'case prices');
  assert.ok((await blurred('.case-card .case-name')).every((b) => !b));
  assert.ok((await blurred('#apCard, #apCard *')).every((b) => !b));
  // a case: its price, the Open button sum and the brainrots' prices blurred, the brainrots not
  await page.evaluate((id) => (location.hash = '#/case/' + id), demo.bySlug.noob.id);
  await page.waitForSelector('#caseItems');
  await page.click('[data-act="odds"]');
  await settle();
  assert.deepEqual(await blurred('.vh-price .priv'), [true]);
  assert.ok((await blurred('#openRow .priv')).every(Boolean) && (await blurred('#openRow .priv')).length > 0, 'the Open button');
  assert.ok((await blurred('#caseItems .item-val .priv')).every(Boolean));
  assert.ok((await blurred('#caseItems .item-name, #caseItems .item-art, #caseItems .item-chance')).every((b) => !b));
  // switched off: nothing blurred
  await page.evaluate(() => (location.hash = '#/profile'));
  await page.waitForSelector('[data-act="streamer"]');
  await page.click('[data-act="streamer"]');
  await settle();
  assert.equal(await page.getAttribute('[data-act="streamer"]', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('bs_streamer')), '0');
  await check(false);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('streamer')), false);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('streamer mode on a phone: a tap on a blurred amount shows it for a moment', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/profile' });
  await page.waitForSelector('.p-card');
  await page.click('[data-act="streamer"]');
  await page.waitForTimeout(300);
  const blurred = (sel) => page.$eval(sel, (e) => /^blur\(/.test(getComputedStyle(e).filter));
  assert.equal(await blurred('.p-bal .priv'), true);
  assert.equal(await blurred('.p-name'), false, 'names are never blurred');
  await page.tap('.p-bal .money');
  await page.waitForTimeout(250);
  assert.equal(await blurred('.p-bal .priv'), false, 'shown');
  assert.equal(await blurred('#bal'), true);
  await page.waitForTimeout(2700);
  assert.equal(await blurred('.p-bal .priv'), true, 'blurred again');
  await page.click('[data-act="streamer"]');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('Halloween: an admin switches it on — night sky, webs, spider, pumpkin by the logo, the Halloween case first; off brings the usual look back', { skip }, async () => {
  const isOn = (pg) => pg.evaluate(() => document.documentElement.classList.contains('halloween'));
  const shown = (pg, sel) => pg.evaluate((x) => getComputedStyle(document.querySelector(x)).display !== 'none', sel);
  const bg1 = (pg) => pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim().toLowerCase());
  const deco = ['.logo-pk', '.hw-web.l', '.hw-web.r', '.hw-spider'];
  try {
    const { page, errors } = await open({ path: '/#/admin/settings' });
    await page.waitForSelector('#setForm [name=halloween]', { state: 'attached' });
    assert.equal(await page.getAttribute('#setForm label.switch >> nth=0 >> input', 'name'), 'halloween', 'the first setting');
    assert.equal(await page.textContent('#setForm label.switch:has([name=halloween])'), 'Хэллоуин: праздничное оформление у всех игроков и в боте');
    assert.equal(await page.isChecked('#setForm [name=halloween]'), false, 'off by default');
    assert.equal(await isOn(page), false);
    for (const sel of deco) assert.equal(await shown(page, sel), false, sel);
    await page.click('#setForm label.switch:has([name=halloween])');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(demo.ctx.settings.get('halloween'), true);
    // the admin sees it right away
    await page.waitForFunction(() => document.documentElement.classList.contains('halloween'));
    for (const sel of deco) assert.equal(await shown(page, sel), true, sel);
    assert.equal(await bg1(page), '#0b0614', 'night sky');
    assert.equal(await page.evaluate(() => localStorage.getItem('bs_hw')), '1');
    assert.deepEqual(errors, []);
    await page.context().close();

    // a player opening the app
    const p2 = await open();
    await p2.page.waitForSelector('.case-grid');
    assert.equal(await isOn(p2.page), true);
    for (const sel of deco) assert.equal(await shown(p2.page, sel), true, sel);
    const names = await p2.page.locator('.case-name').allTextContents();
    assert.equal(names[0], 'Хэллоуин кейс', names.join(', '));
    assert.equal(names.filter((n) => n === 'Хэллоуин кейс').length, 1, 'listed once');
    assert.equal(names.length, 11, 'every case still there');
    assert.deepEqual(names.slice(1, 4), ['DragonDrop в нике', 'Кейс за репосты', 'Нуб кейс']);
    // the player's colour theme still works, on the night sky
    await p2.page.click('#themeBtn');
    await p2.page.click('[data-theme="mint"]');
    assert.equal(await p2.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--a1').trim().toLowerCase()), '#34f5a4');
    assert.equal(await bg1(p2.page), '#0b0614');
    await p2.page.click('#themeBtn');
    await p2.page.click('[data-theme="sunset"]');
    await p2.page.waitForTimeout(300);
    // small phones: the decorations don't widen the page
    const p3 = await open({ width: 360, height: 740 });
    await p3.page.waitForSelector('.case-grid');
    assert.equal(await p3.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
    await p3.page.context().close();

    // switched off: the usual look again on the next open
    assert.equal((await demo.app.put('/api/admin/settings', { user: ME, body: { halloween: false } })).status, 200);
    await p2.page.reload();
    await p2.page.waitForSelector('.case-grid');
    assert.equal(await isOn(p2.page), false);
    for (const sel of deco) assert.equal(await shown(p2.page, sel), false, sel);
    assert.equal(await bg1(p2.page), '#03131f', 'the sunset theme sky');
    assert.equal((await p2.page.locator('.case-name').allTextContents())[0], 'DragonDrop в нике');
    assert.equal(await p2.page.evaluate(() => localStorage.getItem('bs_hw')), '0');
    assert.deepEqual(p2.errors, []);
    await p2.page.context().close();
  } finally {
    await demo.ctx.settings.update({ halloween: false });
  }
});

// What the app plays is rendered offline and measured: the page's audio is swapped for an
// OfflineAudioContext before the first tap; `bs:sfx` events name each sound.
const OFFLINE_AUDIO = () => {
  const oac = new OfflineAudioContext(1, 44100 * 4, 44100);
  window.__oac = oac;
  window.__sfx = [];
  addEventListener('bs:sfx', (e) => window.__sfx.push(e.detail));
  window.AudioContext = function () {
    return oac;
  };
};
// The same, but the offline clock follows the real one: sounds land in the recording when they were
// played (a spinning case strip ticks for seconds, all at once they would add up).
const OFFLINE_AUDIO_TIMED = () => {
  const oac = new OfflineAudioContext(1, 44100 * 14, 44100);
  const t0 = performance.now();
  Object.defineProperty(oac, 'currentTime', { get: () => (performance.now() - t0) / 1000 });
  window.__oac = oac;
  window.__sfx = [];
  addEventListener('bs:sfx', (e) => window.__sfx.push(e.detail));
  window.AudioContext = function () {
    return oac;
  };
};
const MEASURE_AUDIO = async () => {
  const d = (await window.__oac.startRendering()).getChannelData(0);
  let peak = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    if (a > 0.01) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return { sfx: window.__sfx, peak, seconds: last > first ? (last - first) / 44100 : 0 };
};
const giveMe = async (...names) => {
  for (const n of names) {
    const it = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === n);
    await demo.ctx.db.query("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'demo')", [ME.id, it.id]);
  }
};

test('sound: coins when a brainrot is sold (one, all); the Sound switch in the profile turns it off and is remembered', { skip }, async () => {
  await giveMe('Tim Cheese', 'Cerberus', 'Tralalero Tralala');
  const { page, errors } = await open({ path: '/#/profile' });
  await page.waitForSelector('[data-act="sound"]');
  // on by default, next to streamer mode
  assert.equal(await page.getAttribute('[data-act="sound"]', 'aria-pressed'), 'true');
  assert.equal((await page.textContent('[data-act="sound"]')).trim(), 'Звук');
  assert.deepEqual(await page.$$eval('.p-tools > *', (els) => els.map((e) => e.dataset.act || e.className)), ['streamer', 'sound']);
  // one brainrot: a few coins, heard (not silent, not clipping)
  await page.evaluate(OFFLINE_AUDIO);
  await page.click('[data-act="sell"]');
  await page.waitForSelector('.toast.ok');
  let a = await page.evaluate(MEASURE_AUDIO);
  assert.deepEqual(a.sfx, ['coins']);
  assert.ok(a.peak > 0.1 && a.peak < 0.99, `peak ${a.peak}`);
  assert.ok(a.seconds > 0.25 && a.seconds < 1, `${a.seconds}s`);
  const one = a.seconds;
  await page.waitForSelector('.toast', { state: 'detached', timeout: 8000 });
  // all of them: a bigger handful
  await page.reload();
  await page.waitForSelector('[data-act="sell-all"]');
  await page.evaluate(OFFLINE_AUDIO);
  await page.click('[data-act="sell-all"]');
  await page.click('#confirmYes');
  await page.waitForFunction(() => window.__sfx.length > 0);
  a = await page.evaluate(MEASURE_AUDIO);
  assert.deepEqual(a.sfx, ['coins']);
  assert.ok(a.peak > 0.1 && a.peak < 0.99, `peak ${a.peak}`);
  assert.ok(a.seconds > one, `${a.seconds}s > ${one}s`);
  // the switch: off → selling is silent, also after a reload
  await giveMe('Tim Cheese', 'Cerberus');
  await page.reload();
  await page.waitForSelector('[data-act="sell"]');
  await page.evaluate(OFFLINE_AUDIO);
  await page.click('[data-act="sound"]');
  assert.equal(await page.getAttribute('[data-act="sound"]', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('bs_sound')), '0');
  await page.click('[data-act="sell"]');
  await page.waitForSelector('.toast.ok');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.__sfx), []);
  await page.reload();
  await page.waitForSelector('[data-act="sell"]');
  assert.equal(await page.getAttribute('[data-act="sound"]', 'aria-pressed'), 'false');
  await page.evaluate(OFFLINE_AUDIO);
  await page.click('[data-act="sell"]');
  await page.waitForSelector('.toast.ok');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.__sfx), []);
  // on again
  await page.click('[data-act="sound"]');
  assert.equal(await page.evaluate(() => localStorage.getItem('bs_sound')), '1');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('sound: coins when the brainrot from a case is sold right away', { skip }, async () => {
  await demo.app.setBalance(ME.id, 5000);
  const { page, errors } = await open({ path: `/#/case/${demo.bySlug.noob.id}` });
  await page.waitForSelector('#openRow [data-act="open"]');
  await page.evaluate(OFFLINE_AUDIO_TIMED);
  if ((await page.getAttribute('[data-act="fast"]', 'aria-pressed')) !== 'true') await page.click('[data-act="fast"]');
  await page.click('#openRow [data-act="open"]');
  await page.waitForSelector('[data-act="sell-won"]', { timeout: 15000 });
  await page.click('[data-act="sell-won"]');
  await page.waitForFunction(() => window.__sfx.includes('coins'));
  const a = await page.evaluate(MEASURE_AUDIO);
  assert.deepEqual(a.sfx.filter((x) => x !== 'tick'), ['coins'], 'the strip ticked before');
  assert.ok(a.peak > 0.1 && a.peak < 0.99, `peak ${a.peak}`);
  await page.click('[data-act="fast"]');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('sound: the case strip ticks for every brainrot under the marker, rarer as it slows down; silent with the switch off', { skip }, async () => {
  await demo.app.setBalance(ME.id, 5000);
  const listen = () => {
    window.__ticks = [];
    addEventListener('bs:sfx', (e) => {
      if (e.detail === 'tick') window.__ticks.push(performance.now());
    });
  };
  const { page, errors } = await open({ path: `/#/case/${demo.bySlug.noob.id}` });
  await page.waitForSelector('#openRow [data-act="open"]');
  await page.evaluate(OFFLINE_AUDIO_TIMED);
  await page.evaluate(listen);
  if ((await page.getAttribute('[data-act="fast"]', 'aria-pressed')) === 'true') await page.click('[data-act="fast"]');
  await page.click('#openRow [data-act="open"]');
  await page.waitForSelector('.result', { timeout: 15000 });
  const ticks = await page.evaluate(() => window.__ticks);
  assert.ok(ticks.length >= 20 && ticks.length <= 49, `${ticks.length} ticks`);
  const gaps = ticks.slice(1).map((x, i) => x - ticks[i]);
  const avg = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  assert.ok(avg(gaps.slice(-4)) > avg(gaps.slice(0, 8)) * 3, `${Math.round(avg(gaps.slice(0, 8)))} ms → ${Math.round(avg(gaps.slice(-4)))} ms`);
  assert.ok(ticks.at(-1) - ticks[0] > 3000, 'until the strip stops');
  const a = await page.evaluate(MEASURE_AUDIO);
  assert.equal(a.sfx.filter((x) => x === 'tick').length, ticks.length);
  assert.ok(a.peak > 0.05 && a.peak < 0.99, `peak ${a.peak}`);
  // the Sound switch off: the strip spins in silence
  await page.evaluate(() => localStorage.setItem('bs_sound', '0'));
  await page.reload();
  await page.waitForSelector('#openRow [data-act="open"]');
  await page.evaluate(OFFLINE_AUDIO_TIMED);
  await page.evaluate(listen);
  await page.click('#openRow [data-act="open"]');
  await page.waitForSelector('.result', { timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => window.__ticks), []);
  await page.evaluate(() => localStorage.setItem('bs_sound', '1'));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('upgrader win: a victory sound and fireworks over the screen (taps go through); a loss has neither; no sound with the switch off', { skip }, async () => {
  await giveMe('Tim Cheese', 'Cerberus', 'Tim Cheese');
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector('[data-act="up-pick"]');
  const go = async (roll) => {
    await page.click('[data-act="up-pick"] >> nth=0');
    await page.click('[data-act="up-tab"][data-v="targets"]');
    await page.click('[data-act="up-target"] >> nth=0');
    uiRng.queue.push(roll);
    await page.click('#upBtn');
    await page.waitForSelector('.result', { timeout: 9000 });
  };
  const lit = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas.fireworks');
      if (!c) return -1;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
      return n;
    });
  // win (roll 0)
  await page.evaluate(OFFLINE_AUDIO);
  await go(0);
  assert.equal(await page.textContent('.result-title'), 'Успех!');
  await page.waitForSelector('canvas.fireworks', { state: 'attached', timeout: 2000 });
  assert.deepEqual(await page.$eval('canvas.fireworks', (c) => [getComputedStyle(c).position, getComputedStyle(c).pointerEvents, Number(getComputedStyle(c).zIndex) > 50]), ['fixed', 'none', true]);
  await page.waitForTimeout(1000);
  assert.ok((await lit()) > 5000, 'sparks on screen');
  // the result's OK works through the fireworks
  await page.click('.result [data-act="close-modal"]');
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('canvas.fireworks'), null, { timeout: 8000 });
  const a = await page.evaluate(MEASURE_AUDIO);
  assert.equal(a.sfx[0], 'win');
  assert.ok(a.sfx.filter((x) => x === 'pop').length >= 4, a.sfx.join());
  assert.ok(a.peak > 0.1 && a.peak < 0.99, `peak ${a.peak}`);
  assert.ok(a.seconds > 0.8, `${a.seconds}s`);
  // loss (the highest roll): nothing
  await page.evaluate(OFFLINE_AUDIO);
  await go(99999);
  assert.equal(await page.textContent('.result-title'), 'Не повезло');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('canvas.fireworks').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__sfx), []);
  await page.click('.result [data-act="close-modal"]');
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // sound off: fireworks, but silent
  await page.evaluate(() => localStorage.setItem('bs_sound', '0'));
  await page.reload();
  await page.waitForSelector('[data-act="up-pick"]');
  await page.evaluate(OFFLINE_AUDIO);
  await go(0);
  await page.waitForSelector('canvas.fireworks', { state: 'attached', timeout: 2000 });
  await page.waitForTimeout(1600);
  assert.deepEqual(await page.evaluate(() => window.__sfx), []);
  await page.evaluate(() => localStorage.setItem('bs_sound', '1'));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('case odds: hidden on the case page until «Шансы» is tapped; then the real chances show; another tap hides them', { skip }, async () => {
  const c = demo.bySlug.dragon;
  const { page, errors } = await open({ path: `/#/case/${c.id}` });
  await page.waitForSelector('#caseItems .item');
  const visible = () => page.$$eval('#caseItems .item-chance', (els) => els.filter((e) => e.offsetParent !== null).length);
  const n = await page.locator('#caseItems .item').count();
  assert.ok(n > 3);
  assert.equal(await visible(), 0, 'no percentages at first');
  assert.equal((await page.textContent('[data-act="odds"]')).trim(), 'Шансы');
  assert.equal(await page.getAttribute('[data-act="odds"]', 'aria-pressed'), 'false');
  assert.equal(await page.textContent('.sec-row .sec-title'), 'Содержимое кейса');
  await page.click('[data-act="odds"]');
  assert.equal(await visible(), n);
  assert.equal(await page.getAttribute('[data-act="odds"]', 'aria-pressed'), 'true');
  // exactly the chances the server draws with
  const shown = (await page.$$eval('#caseItems .item-chance', (els) => els.map((e) => e.textContent))).map((x) => Number(x.replace('%', '').replace(',', '.')));
  const api = (await demo.app.get('/api/catalog', { user: ME })).body.cases.find((x) => x.id === c.id).items.map((e) => e.chance);
  assert.deepEqual(shown, api);
  assert.ok(Math.abs(api.reduce((a, b) => a + b, 0) - 100) < 0.05);
  const w = demo.ctx.game.catalog.cases.get(c.id).items;
  const W = w.reduce((a, e) => a + e.chance, 0);
  const byAsc = (a, b) => a - b;
  assert.deepEqual([...api].sort(byAsc), w.map((e) => Math.round((e.chance / W) * 100000) / 1000).sort(byAsc));
  await page.click('[data-act="odds"]');
  assert.equal(await visible(), 0);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('brainrot deposits: an admin closes them in «Пополнения»; players see «Временно закрыто», an open form is refused; opened again', { skip }, async () => {
  const p = { id: 7400, first_name: 'Ника', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: p });
  try {
    // a player has the brainrot form open
    const pl = await open({ user: p });
    await pl.page.waitForSelector('.case-grid');
    await pl.page.click('[data-act="topup"]');
    await pl.page.click('[data-act="tu-brainrots"]');
    await pl.page.waitForSelector('#depForm');
    // the admin closes deposits
    const ad = await open({ path: '/#/admin/deposits' });
    await ad.page.waitForSelector('.dep-gate');
    assert.equal(await ad.page.isChecked('#depGate'), true);
    assert.equal(await ad.page.textContent('.dep-gate span'), 'Пополнение брейнротами: открыто');
    await ad.page.click('.dep-gate');
    await ad.page.waitForSelector('.toast.ok');
    assert.equal(await ad.page.textContent('.dep-gate span'), 'Пополнение брейнротами: закрыто');
    assert.equal(await ad.page.isChecked('#depGate'), false);
    assert.equal(demo.ctx.settings.get('deposits_brainrots_open'), false);
    // the open form: refused with a clear message, back to the choice
    await pl.page.fill('#depForm [name="nick"]', 'NikaRBX');
    await pl.page.click('#depForm [data-dep] >> nth=0');
    await pl.page.click('#depBtn');
    await pl.page.waitForSelector('.toast.error');
    assert.equal(await pl.page.textContent('.toast.error'), 'Пополнение брейнротами временно закрыто');
    await pl.page.waitForSelector('.tu-opt.brainrots.closed');
    // a fresh start: the option is off, marked
    await pl.page.reload();
    await pl.page.waitForSelector('.case-grid');
    await pl.page.click('[data-act="topup"]');
    await pl.page.waitForSelector('.tu-opt.brainrots');
    assert.equal(await pl.page.isDisabled('.tu-opt.brainrots'), true);
    assert.equal(await pl.page.textContent('.tu-opt.brainrots small'), 'Временно закрыто');
    await pl.page.waitForTimeout(400); // the sheet slides up
    await pl.page.click('.tu-opt.brainrots', { force: true });
    await pl.page.waitForTimeout(300);
    assert.equal(await pl.page.locator('#depForm').count(), 0);
    assert.equal(await pl.page.isDisabled('.tu-opt.stars'), false, 'Stars still work');
    // the admin opens them again
    await ad.page.click('.dep-gate');
    await ad.page.waitForFunction(() => document.querySelector('.dep-gate span').textContent === 'Пополнение брейнротами: открыто');
    assert.equal(demo.ctx.settings.get('deposits_brainrots_open'), true);
    await pl.page.reload();
    await pl.page.waitForSelector('.case-grid');
    await pl.page.click('[data-act="topup"]');
    await pl.page.click('[data-act="tu-brainrots"]');
    await pl.page.waitForSelector('#depForm');
    assert.deepEqual(ad.errors, []);
    assert.deepEqual(pl.errors, []);
    await ad.page.context().close();
    await pl.page.context().close();
  } finally {
    await demo.ctx.settings.update({ deposits_brainrots_open: true });
  }
});

// ------------------------------------------------------------------ buffs on deposited brainrots
const pctNum = (s) => Number(s.replace('−', '-').replace(/[^\d,-]/g, '').replace(',', '.'));
const buffChips = (page, tier) =>
  page.$$eval(`#buffs [data-tier="${tier}"] .buff`, (els) => els.map((e) => [e.querySelector('.buff-name').textContent, e.querySelector('.buff-pct').textContent]));

test('brainrot deposit: «Доплата за бафы» as in Brainrot Battle — groups by %, «Снижают» open (Claws −7,5%, Taco −15%), the others open on a tap; the player picks nothing', { skip }, async () => {
  const p = { id: 7851, first_name: 'Бафер', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: p });
  const buffs = demo.ctx.settings.get('buffs');
  const { page, errors } = await open({ user: p, width: 360, height: 760 });
  await page.waitForSelector('.case-grid');
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depForm #buffs');
  // one line under the code field until it is tapped
  assert.equal(await page.$eval('#buffs', (d) => d.open), false);
  assert.match(await page.textContent('#buffs > summary'), /Доплата за бафы/);
  assert.equal(await page.isVisible('.buffs-note'), false);
  assert.ok(await page.$eval('#buffs', (d) => d.previousElementSibling.textContent.includes('Промокод') && d.nextElementSibling.textContent === 'Что хочешь пополнить'));
  await page.click('#buffs > summary');
  assert.equal(
    await page.textContent('.buffs-note'),
    'Доплата считается от цены брейнрота и начисляется автоматически — выбирать ничего не нужно. Проценты бафов складываются.',
  );
  const tiers = await page.$$eval('#buffs .bt', (els) =>
    els.map((e) => ({ key: e.dataset.tier, name: getComputedStyle(e.querySelector('.bt-name')).textTransform === 'uppercase' ? e.querySelector('.bt-name').textContent : '?', sub: e.querySelector('summary small').textContent, n: Number(e.querySelector('.bt-n').textContent), open: e.open })),
  );
  const count = (f) => buffs.filter((b) => f(b.pct)).length;
  assert.deepEqual(tiers, [
    { key: 'low', name: 'Снижают', sub: 'цена ниже', n: count((x) => x < 0), open: true },
    { key: 'top', name: 'Топ', sub: '+30% и выше', n: count((x) => x >= 30), open: false },
    { key: 'high', name: 'Высокие', sub: 'от +15%', n: count((x) => x >= 15 && x < 30), open: false },
    { key: 'mid', name: 'Средние', sub: 'от +5%', n: count((x) => x >= 5 && x < 15), open: false },
    { key: 'base', name: 'Базовые', sub: 'до +5%', n: count((x) => x >= 0 && x < 5), open: false },
  ]);
  assert.equal(tiers.reduce((s, x) => s + x.n, 0), buffs.length, 'every buff is in a group');
  assert.deepEqual(await buffChips(page, 'low'), [['Claws', '−7,5%'], ['Taco', '−15%']]);
  const color = (sel) => page.$eval(sel, (e) => getComputedStyle(e).color);
  assert.equal(await color('#buffs [data-tier="low"] .buff-pct'), 'rgb(255, 138, 138)', 'red: a lower price');
  // a tap opens a group: from the biggest extra down, in green
  assert.equal(await page.isVisible('#buffs [data-tier="top"] .buff'), false);
  await page.click('#buffs [data-tier="top"] > summary');
  const top = await buffChips(page, 'top');
  assert.deepEqual(top[0], ['Eclipse', '+50%']);
  assert.deepEqual(top.map(([, x]) => pctNum(x)), top.map(([, x]) => pctNum(x)).sort((a, b) => b - a));
  assert.equal(await color('#buffs [data-tier="top"] .buff-pct'), 'rgb(110, 240, 160)');
  for (const k of ['high', 'mid', 'base']) await page.click(`#buffs [data-tier="${k}"] > summary`);
  const shown = (await page.$$eval('#buffs .buff', (els) => els.map((e) => [e.querySelector('.buff-name').textContent, e.querySelector('.buff-pct').textContent])));
  assert.equal(shown.length, buffs.length);
  for (const b of buffs) assert.ok(shown.some(([n, x]) => n === b.name && pctNum(x) === b.pct), b.name);
  // the names are never cut, not even on a 360px phone; nothing sticks out of the sheet
  assert.deepEqual(await page.$$eval('#buffs .buff-name', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent)), []);
  assert.ok(await page.$eval('#buffs', (d) => d.scrollWidth <= d.clientWidth + 1));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  // nothing to pick: no buttons or fields, a tap on a buff changes nothing
  assert.equal(await page.locator('#buffs button, #buffs input').count(), 0);
  await page.click('#buffs [data-tier="low"] .buff');
  assert.equal(await page.isDisabled('#depBtn'), true);
  // folds back with a tap; the request is sent as before
  await page.click('#buffs > summary');
  assert.equal(await page.$eval('#buffs', (d) => d.open), false);
  await page.fill('#depSearch', 'cerberus');
  await page.click(`[data-dep="${[...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Cerberus').id}"]`);
  await page.fill('#depForm [name=nick]', 'BuffKid');
  await page.click('#depBtn');
  await page.waitForSelector('.toast.ok');
  const req = await demo.ctx.db.one("SELECT offer FROM bs_requests WHERE user_id = $1 AND kind = 'deposit' ORDER BY id DESC LIMIT 1", [p.id]);
  assert.deepEqual(req.offer.map((e) => [e.name, e.count]), [['Cerberus', 1]]);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('brainrot deposit with buffs: the admin ticks what the brainrots have — each buff adds its % of the price (Taco takes 15% off), ×2 for two of them; the sum goes into «Начислить» and is credited', { skip }, async () => {
  const p = { id: 7852, first_name: 'Мутант', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: p });
  const items = [...demo.ctx.game.catalog.items.values()];
  const a = items.find((i) => i.name === 'La Vacca Saturno Saturnita');
  const b = items.find((i) => i.name === 'Tralalero Tralala');
  const sent = await demo.app.post('/api/requests/deposit', { user: p, body: { nick: 'MutantRBX', offer: [{ itemId: a.id, count: 1 }, { itemId: b.id, count: 2 }] } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const id = sent.body.request.id;
  await demo.app.setBalance(p.id, 0);
  const { page, errors } = await open({ path: `/#/admin/deposits/${id}` });
  await page.waitForSelector('#offerBox [data-buffs]');
  assert.equal(await page.locator('#offerBox [data-buffs]').count(), 2, 'a «+ Бафы» button for each brainrot');
  assert.equal(await page.textContent(`[data-offer="${a.id}"] [data-buffs]`), '+ Бафы');
  assert.equal(await page.locator('.kv.buffed').count(), 0);
  assert.equal(await page.inputValue('#reqAmount'), '');
  const closeSheet = async () => {
    await page.click('.buff-pick [data-act="close-modal"]');
    await page.waitForSelector('.modal-wrap', { state: 'detached' });
  };
  const ticked = () => page.$$eval('#bpTiers .buff-btn.on', (els) => els.map((e) => e.dataset.buff + (e.querySelector('.buff-k') ? e.querySelector('.buff-k').textContent : '')));
  // La Vacca (one of it): Rainbow +30%, Taco −15%; a second tap takes a buff off
  await page.click(`[data-offer="${a.id}"] [data-buffs]`);
  await page.waitForSelector('#bpTiers');
  assert.equal(await page.textContent('.buff-pick .note'), 'Отметь бафы этого брейнрота — сумма к начислению посчитается сама.');
  assert.deepEqual(await page.$$eval('#bpTiers .bt-name', (els) => els.map((e) => e.textContent)), ['Снижают', 'Топ', 'Высокие', 'Средние', 'Базовые']);
  await page.click('#bpTiers [data-buff="Rainbow"]');
  await page.click('#bpTiers [data-buff="Taco"]');
  await page.click('#bpTiers [data-buff="Eclipse"]');
  assert.deepEqual(await ticked(), ['Taco', 'Eclipse', 'Rainbow']);
  await page.click('#bpTiers [data-buff="Eclipse"]');
  assert.deepEqual(await ticked(), ['Taco', 'Rainbow']);
  // the card behind follows at once
  const want1 = a.value + (a.value * (30 - 15)) / 100 + b.value * 2;
  assert.equal(num(await page.textContent('#buffTotal')), Math.round(want1));
  await closeSheet();
  assert.equal(Number(await page.inputValue('#reqAmount')), Math.round(want1));
  assert.match(await page.textContent('.kv.buffed span'), /С бафами/);
  // Tralalero ×2: Gold on both of them, Claws on one; after ×2 one more tap takes Gold off
  await page.click(`[data-offer="${b.id}"] [data-buffs]`);
  await page.waitForSelector('#bpTiers');
  assert.match(await page.textContent('.buff-pick .note'), /нажми ещё раз \(×2, ×3…\); после ×2 он снимается/);
  for (let i = 0; i < 3; i++) await page.click('#bpTiers [data-buff="Gold"]');
  assert.deepEqual(await ticked(), []);
  await page.click('#bpTiers [data-buff="Gold"]');
  await page.click('#bpTiers [data-buff="Gold"]');
  await page.click('#bpTiers [data-buff="Claws"]');
  assert.deepEqual(await ticked(), ['Claws', 'Gold×2']);
  await closeSheet();
  const lineA = a.value + (a.value * 15) / 100;
  const lineB = b.value * 2 + (b.value * (2 * 2 - 7.5)) / 100;
  const want2 = Math.round(lineA + lineB);
  assert.equal(num(await page.textContent('#buffTotal')), want2);
  assert.equal(Number(await page.inputValue('#reqAmount')), want2);
  assert.equal(num(await page.textContent(`[data-offer="${a.id}"] .offer-sum`)), Math.round(lineA));
  assert.equal(num(await page.textContent(`[data-offer="${b.id}"] .offer-sum`)), Math.round(lineB));
  const chipsOf = (it) => page.$$eval(`[data-offer="${it.id}"] .offer-buffs .buff`, (els) => els.map((e) => e.textContent));
  assert.deepEqual(await chipsOf(a), ['🌈Rainbow+30%', '🌮Taco−15%']);
  assert.deepEqual(await chipsOf(b), ['🥇Gold+2%×2', '🦀Claws−7,5%']);
  assert.equal(num(await page.textContent('.req .kv:has-text("На сумму") b')), a.value + b.value * 2, 'the plain sum is still there');
  // the card redraws by itself (here: the player's balance changed) — the ticks and the amount stay
  await demo.app.setBalance(p.id, 123);
  await page.waitForFunction(() => document.querySelector('.req .row .row-side')?.textContent.replace(/\D/g, '') === '123', null, { timeout: 9000 });
  assert.deepEqual(await chipsOf(b), ['🥇Gold+2%×2', '🦀Claws−7,5%']);
  assert.equal(Number(await page.inputValue('#reqAmount')), want2);
  // credited: the player gets the sum with the buffs, the ticks are cleared
  await page.click('[data-ra="credit"]');
  assert.match(await page.textContent('.confirm p'), new RegExp(`Начислить \\+${want2} игроку Мутант`));
  await page.click('#confirmYes');
  await page.waitForFunction((n) => [...document.querySelectorAll('#reqChat .msg.sys')].some((m) => m.textContent.includes('Начислено +' + n)), String(want2));
  assert.equal((await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [p.id])).balance, 123 + want2);
  assert.equal(await page.locator('.offer-buffs .buff').count(), 0);
  assert.equal(await page.locator('.kv.buffed').count(), 0);
  assert.equal(await page.inputValue('#reqAmount'), '');
  // a closed request: no buff buttons
  await page.click('[data-ra="done"]');
  await page.click('#confirmYes');
  await page.waitForFunction(() => document.querySelector('.req .badge')?.textContent === 'Выполнена');
  assert.equal(await page.locator('[data-buffs]').count(), 0);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('buffs: the main admin edits the list in Settings (a %, one more, one less) and players see it at once; regular admins have no editor', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const before = demo.ctx.settings.get('buffs');
  try {
    {
      const { page, errors } = await open({ path: '/#/admin/settings' });
      await page.waitForSelector('#setForm');
      assert.equal(await page.locator('#setBuffs').count(), 0, 'a regular admin');
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setBuffs');
    assert.match(await page.textContent('#setBuffs > summary'), new RegExp(`Бафы при пополнении брейнротами\\s*${before.length}`));
    assert.equal(await page.isVisible('#buffRows'), false, 'folded until tapped');
    await page.click('#setBuffs > summary');
    assert.equal(await page.locator('#buffRows .buff-row').count(), before.length);
    const row = (name) => page.locator('#buffRows .buff-row', { has: page.locator(`[name="b_name"][value="${name}"]`) });
    assert.equal(await row('Taco').locator('[name="b_pct"]').inputValue(), '-15');
    await row('Taco').locator('[name="b_pct"]').fill('−12,5');
    await row('Claws').locator('[data-buff-del]').click();
    await page.click('#buffAdd');
    const last = page.locator('#buffRows .buff-row').last();
    assert.ok(await last.locator('[name="b_name"]').evaluate((e) => e === document.activeElement), 'the new row is ready to type in');
    await last.locator('[name="b_emoji"]').fill('🦴');
    await last.locator('[name="b_name"]').fill('Bone');
    await last.locator('[name="b_pct"]').fill('6');
    assert.equal(await page.textContent('#setBuffs .cnt'), String(before.length));
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    const now = demo.ctx.settings.get('buffs');
    assert.equal(now.length, before.length);
    assert.deepEqual(now.find((x) => x.name === 'Taco'), { name: 'Taco', pct: -12.5, emoji: '🌮' });
    assert.ok(!now.some((x) => x.name === 'Claws'));
    assert.deepEqual(now.at(-1), { name: 'Bone', pct: 6, emoji: '🦴' });
    // the same name twice: refused with a message, nothing saved
    await page.click('#buffAdd');
    await page.locator('#buffRows .buff-row').last().locator('[name="b_name"]').fill('gold');
    await page.locator('#buffRows .buff-row').last().locator('[name="b_pct"]').fill('3');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.error');
    assert.equal(await page.textContent('.toast.error'), 'Бафы: у каждого своё название (до 32 символов) и % от −90 до 500');
    assert.deepEqual(demo.ctx.settings.get('buffs'), now);
    await page.locator('#buffRows .buff-row').last().locator('[data-buff-del]').click();
    // the player's form shows the new list right away
    await page.click('[data-act="topup"]');
    await page.click('[data-act="tu-brainrots"]');
    await page.waitForSelector('#buffs');
    await page.click('#buffs > summary');
    assert.deepEqual(await buffChips(page, 'low'), [['Taco', '−12,5%']]);
    await page.click('#buffs [data-tier="mid"] > summary');
    assert.ok((await buffChips(page, 'mid')).some(([n, x]) => n === 'Bone' && x === '+6%'));
    assert.deepEqual(errors.filter((e) => !/status of 400/.test(e)), []);
    await page.context().close();
  } finally {
    await demo.ctx.settings.update({ buffs: before });
  }
});

// ------------------------------------------------------------------ colour dice
const DC = { red: 0, yellow: 1, green: 2, blue: 3, purple: 4, pink: 5 }; // colour -> the random number that throws it
const DC_HEX = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899' };
const diceFaces = (...c) => uiRng.queue.push(...c.map((x) => DC[x]));
// the three dice on screen: their colour and whether they are the player's colour
const diceShown = (page) =>
  page.$$eval('#dcStage .die', (ds) => ds.map((d) => [d.style.getPropertyValue('--dc').trim(), d.classList.contains('hit') ? 'hit' : d.classList.contains('miss') ? 'miss' : '']));
const hexes = (...c) => c.map((x) => DC_HEX[x]);

test('colour dice: a tab of its own; pick a colour, stake coins; the dice land on what the server threw; 1 / 2 / 3 of the colour pay ×2 / ×3 / ×4, none takes the stake', { skip }, async () => {
  await demo.app.setBalance(ME.id, 1000);
  const { page, errors } = await open({ path: '/#/dice' });
  await page.waitForSelector('#dcBtn');
  await page.evaluate(OFFLINE_AUDIO);
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Кейсы', 'Апгрейдер', 'Ракета', 'Дайсы', 'Профиль', 'Админ']);
  assert.equal(await page.getAttribute('#tabbar button.on', 'data-tab'), 'dice');
  // before the first throw: three blank dice, six colours (red picked), what 1 / 2 / 3 dice pay
  assert.deepEqual(await page.locator('#dcStage .die').allTextContents(), ['?', '?', '?']);
  assert.deepEqual(await page.locator('.dc-chip span').allTextContents(), ['Красный', 'Жёлтый', 'Зелёный', 'Синий', 'Фиолетовый', 'Розовый']);
  assert.equal(await page.getAttribute('.dc-chip.on', 'data-c'), 'red');
  assert.deepEqual((await page.locator('.dice-pays span').allTextContents()).map((s) => s.replace(/\s+/g, ' ')), ['1 кубик ×2', '2 кубика ×3', '3 кубика ×4']);
  assert.equal(await page.textContent('#dcBtn'), 'Бросить');
  assert.equal(await page.inputValue('#dcBet'), '100');
  const bal = async () => num(await page.textContent('#bal'));
  const thrown = async () => (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_dice WHERE user_id = $1', [ME.id])).n;
  // refused in the app: more than the balance, less than the smallest stake
  await page.fill('#dcBet', '5000');
  await page.click('#dcBtn');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Недостаточно монет');
  await page.waitForSelector('.toast', { state: 'detached', timeout: 6000 });
  await page.fill('#dcBet', '4');
  await page.click('#dcBtn');
  await page.waitForSelector('.toast.error');
  assert.equal((await page.textContent('.toast.error')).replace(/\s/g, ' '), 'Ставка от 5 до 100 000 монет');
  assert.equal(await thrown(), 0);
  assert.equal(await bal(), 1000);
  // blue for 200: blue · red · blue — two dice, ×3
  await page.click('[data-act="dc-color"][data-c="blue"]');
  assert.equal(await page.getAttribute('.dc-chip.on', 'data-c'), 'blue');
  assert.equal(await page.locator('.dc-chip[aria-pressed="true"]').count(), 1);
  await page.fill('#dcBet', '200');
  diceFaces('blue', 'red', 'blue');
  await page.click('#dcBtn');
  await page.waitForSelector('#dcStage .die.rolling');
  assert.equal(await page.locator('#dcStage .die.rolling').count(), 3, 'all three tumble');
  assert.equal(await page.isDisabled('#dcBtn'), true, 'one throw at a time');
  await page.waitForSelector('#dcNote .dn-won');
  assert.deepEqual(await diceShown(page), [[DC_HEX.blue, 'hit'], [DC_HEX.red, 'miss'], [DC_HEX.blue, 'hit']]);
  assert.equal(await page.textContent('#dcNote .dn-won'), 'Совпало 2 — ×3');
  assert.equal(await page.textContent('#dcNote .money b'), '+600');
  await page.waitForFunction(() => document.querySelector('#bal').textContent.replace(/\D/g, '') === '1400');
  assert.equal(await page.isDisabled('#dcBtn'), false);
  assert.deepEqual(await page.evaluate(() => window.__sfx), ['coins'], 'a win jingles coins');
  // pink for 100: red · yellow · green — none, the stake is gone
  await page.click('[data-act="dc-color"][data-c="pink"]');
  await page.fill('#dcBet', '100');
  diceFaces('red', 'yellow', 'green');
  await page.click('#dcBtn');
  await page.waitForSelector('#dcNote .dn-lost');
  assert.deepEqual(await diceShown(page), [[DC_HEX.red, 'miss'], [DC_HEX.yellow, 'miss'], [DC_HEX.green, 'miss']]);
  assert.equal(await page.textContent('#dcNote'), 'Мимо — цвет не выпал');
  await page.waitForFunction(() => document.querySelector('#bal').textContent.replace(/\D/g, '') === '1300');
  assert.deepEqual(await page.evaluate(() => window.__sfx), ['coins'], 'a miss is silent');
  // green for 100: all three — ×4
  await page.click('[data-act="dc-color"][data-c="green"]');
  diceFaces('green', 'green', 'green');
  await page.click('#dcBtn');
  await page.waitForSelector('#dcNote .dn-won');
  assert.deepEqual(await diceShown(page), hexes('green', 'green', 'green').map((h) => [h, 'hit']));
  assert.equal(await page.textContent('#dcNote .dn-won'), 'Совпало 3 — ×4');
  assert.equal(await page.textContent('#dcNote .money b'), '+400');
  await page.waitForFunction(() => document.querySelector('#bal').textContent.replace(/\D/g, '') === '1600'); // 1300 − 100 + 400
  // the server: every throw stored as shown, the balance matches
  const rows = await demo.ctx.db.many('SELECT color, dice, matches, mult, bet, win, bet_kind FROM bs_dice WHERE user_id = $1 ORDER BY id', [ME.id]);
  assert.deepEqual(
    rows.map((r) => [r.color, r.dice.join(' '), r.matches, r.mult, Number(r.bet), Number(r.win), r.bet_kind]),
    [
      ['blue', 'blue red blue', 2, 3, 200, 600, 'coins'],
      ['pink', 'red yellow green', 0, 0, 100, 0, 'coins'],
      ['green', 'green green green', 3, 4, 100, 400, 'coins'],
    ],
  );
  assert.equal(Number((await apiMe()).me.balance), 1600);
  // another tab and back: the last throw, the colour and the stake are still there
  await page.click('#tabbar [data-tab="cases"]');
  await page.waitForSelector('.case-grid');
  await page.click('#tabbar [data-tab="dice"]');
  await page.waitForSelector('#dcBtn');
  assert.deepEqual(await diceShown(page), hexes('green', 'green', 'green').map((h) => [h, 'hit']));
  assert.equal(await page.textContent('#dcNote .dn-won'), 'Совпало 3 — ×4');
  assert.equal(await page.getAttribute('.dc-chip.on', 'data-c'), 'green');
  assert.equal(await page.inputValue('#dcBet'), '100');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('colour dice on brainrots: the staked ones leave the inventory; a win gives the best brainrot it covers and the rest in coins; too cheap a stake is refused', { skip }, async () => {
  await demo.app.setBalance(ME.id, 0);
  const items = [...demo.ctx.game.catalog.items.values()];
  const spooky = items.find((i) => i.name === 'Spooky and Pumpky'); // 200
  const cheap = items.find((i) => i.enabled && i.value < 5);
  const add = async (it) => Number((await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [ME.id, it.id])).id);
  const inv = await add(spooky);
  const small = await add(cheap);
  const { page, errors } = await open({ path: '/#/dice' });
  await page.waitForSelector('#dcBtn');
  await page.click('[data-act="dc-mode"][data-m="brainrots"]');
  await page.waitForSelector('#dcGrid');
  assert.equal(await page.isDisabled('#dcBtn'), true, 'nothing staked yet');
  // too cheap: refused in the app, the brainrot stays
  await page.click(`[data-act="dc-pick"][data-inv="${small}"]`);
  assert.equal(num(await page.textContent('#dcBetVal')), cheap.value);
  await page.click('#dcBtn');
  await page.waitForSelector('.toast.error');
  assert.equal((await page.textContent('.toast.error')).replace(/\s/g, ' '), 'Ставка от 5 до 100 000 монет');
  assert.equal((await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1', [small])).n, 1);
  await page.click(`[data-act="dc-pick"][data-inv="${small}"]`);
  // Spooky and Pumpky (200) on purple: purple · purple · pink — ×3 = 600
  await page.click(`[data-act="dc-pick"][data-inv="${inv}"]`);
  assert.equal(num(await page.textContent('#dcBetVal')), 200);
  assert.equal(await page.isDisabled('#dcBtn'), false);
  await page.click('[data-act="dc-color"][data-c="purple"]');
  diceFaces('purple', 'purple', 'pink');
  await page.click('#dcBtn');
  await page.waitForSelector('#dcNote .dn-won');
  const win = 600;
  const best = items.filter((i) => i.enabled && i.value <= win).sort((a, b) => b.value - a.value)[0];
  assert.deepEqual(await diceShown(page), [[DC_HEX.purple, 'hit'], [DC_HEX.purple, 'hit'], [DC_HEX.pink, 'miss']]);
  assert.equal(await page.textContent('#dcNote .dn-won'), 'Совпало 2 — ×3');
  assert.equal(await page.textContent('#dcNote .cr-win-item b'), best.name);
  const rest = win - best.value;
  if (rest > 0) assert.equal(await page.textContent('#dcNote .money b'), `+${rest}`);
  else assert.equal(await page.locator('#dcNote .money').count(), 0);
  await page.waitForFunction((n) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === n, rest);
  // the staked one is gone, the won one is in the inventory and on the grid; nothing is staked now
  assert.equal((await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1', [inv])).n, 0);
  const won = await demo.ctx.db.one("SELECT id, item_id FROM bs_inventory WHERE user_id = $1 AND source = 'dice' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.equal(won.item_id, best.id);
  await page.waitForSelector(`#dcGrid [data-inv="${won.id}"]`);
  assert.equal(await page.locator(`#dcGrid [data-inv="${inv}"]`).count(), 0);
  assert.equal(await page.locator('#dcGrid .item.sel').count(), 0);
  assert.equal(await page.isDisabled('#dcBtn'), true);
  assert.equal(num(await page.textContent('#dcBetVal')), 0);
  // the result stays on the dice after the grid is redrawn
  assert.equal(await page.textContent('#dcNote .cr-win-item b'), best.name);
  const r = await demo.ctx.db.one('SELECT bet, bet_kind, win, bet_items, win_item FROM bs_dice WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.deepEqual([Number(r.bet), r.bet_kind, Number(r.win), r.bet_items.map((x) => x.name), r.win_item.itemId], [200, 'brainrots', 600, ['Spooky and Pumpky'], best.id]);
  // a miss: the staked brainrot is lost
  await page.click(`[data-act="dc-pick"][data-inv="${won.id}"]`);
  await page.click('[data-act="dc-color"][data-c="yellow"]');
  diceFaces('red', 'blue', 'green');
  await page.click('#dcBtn');
  await page.waitForSelector('#dcNote .dn-lost');
  assert.equal((await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1', [won.id])).n, 0);
  await page.waitForFunction((id) => !document.querySelector(`#dcGrid [data-inv="${id}"]`), won.id);
  assert.equal(num(await page.textContent('#bal')), rest);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('small phones (360px): no horizontal scrolling anywhere', { skip }, async () => {
  // the biggest possible top drop must still fit its card
  const top = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Strawberry Elephant');
  await demo.ctx.db.query("INSERT INTO bs_drops (user_id, item_id, value, kind) VALUES ($1, $2, $3, 'case')", [demo.others[9].id, top.id, top.value]);
  await demo.ctx.live.refreshTop();
  const { page } = await open({ width: 360, height: 740 });
  await page.waitForSelector('.case-grid');
  assert.match(await page.textContent('.top24-val'), /50\s000/);
  const fits = await page.evaluate(() => {
    const card = document.querySelector('.top24').getBoundingClientRect();
    const val = document.querySelector('.top24-val').getBoundingClientRect();
    return val.right <= card.right - 4;
  });
  assert.ok(fits, 'top drop value fits inside the card');
  const reqIds = await demo.ctx.db.many('SELECT id, kind FROM bs_requests ORDER BY id');
  const reqHashes = reqIds.map((r) => `#/admin/${r.kind === 'deposit' ? 'deposits' : 'withdrawals'}/${r.id}`);
  for (const h of ['#/cases', `#/case/${demo.bySlug.dragon.id}`, `#/case/${demo.bySlug.free.id}`, '#/upgrade', '#/dice', '#/profile', '#/admin/cases', `#/admin/cases/${demo.bySlug.noob.id}`, '#/admin/users', '#/admin/settings', '#/admin/deposits', '#/admin/withdrawals', ...reqHashes]) {
    await page.evaluate((x) => (location.hash = x), h);
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.equal(over, 0, `${h} overflows by ${over}px`);
  }
  // six tabs (an admin) fit the bar, also on a 320px phone; the dice colour names are not cut
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => (location.hash = '#/dice'));
    await page.waitForSelector('.dc-chip');
    const fit = await page.evaluate(() => {
      const bar = document.querySelector('#tabbar').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('#tabbar button')];
      return {
        n: tabs.length,
        inBar: tabs.every((b) => b.getBoundingClientRect().left >= bar.left && b.getBoundingClientRect().right <= bar.right),
        labels: tabs.every((b) => b.querySelector('span').getBoundingClientRect().width <= b.getBoundingClientRect().width),
        chips: [...document.querySelectorAll('.dc-chip span')].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
        over: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert.deepEqual(fit, { n: 6, inBar: true, labels: true, chips: [], over: 0 }, `${width}px`);
  }
  // top-up and withdrawal sheets
  for (const steps of [['[data-act="topup"]'], ['[data-act="topup"]', '[data-act="tu-stars"]'], ['[data-act="topup"]', '[data-act="tu-brainrots"]']]) {
    await page.evaluate(() => (location.hash = '#/cases'));
    await page.waitForSelector('.case-grid');
    for (const sel of steps) await page.click(sel);
    await page.waitForTimeout(350);
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.sheet *')].map((e) => e.getBoundingClientRect().right - window.innerWidth)));
    assert.ok(over <= 0, `${steps.join(' > ')} overflows by ${over}px`);
    await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
  }
  await page.context().close();
});

test('maintenance: only the main admin has the switch; players see one line and come back by themselves when it is over', { skip }, async () => {
  const PLAYER = { id: 7301, first_name: 'Игрок', username: 'maint_player', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: PLAYER });
  await demo.app.setBalance(PLAYER.id, 1000);

  // a usual admin: no switch in the overview
  const mine = await open({ path: '/#/admin/overview' });
  await mine.page.waitForSelector('.adm-stats');
  assert.equal(await mine.page.locator('#maintGate').count(), 0);
  await mine.page.context().close();

  // the main admin: the switch at the top of the overview, off
  const adm = await open({ user: BOSS, path: '/#/admin/overview' });
  await adm.page.waitForSelector('.adm-stats');
  assert.equal(await adm.page.isChecked('#maintGate'), false);
  assert.equal(await adm.page.textContent('.maint-gate span'), 'Технические работы: выключены');
  const above = await adm.page.evaluate(() => document.querySelector('.maint-gate').getBoundingClientRect().bottom <= document.querySelector('.adm-stats').getBoundingClientRect().top);
  assert.ok(above, 'the switch is above the numbers');

  // a player has the app open; the main admin switches the maintenance on
  const pl = await open({ user: PLAYER });
  await pl.page.waitForSelector('.case-grid');
  await adm.page.click('.maint-gate');
  await adm.page.waitForFunction(() => document.querySelector('.maint-gate span').textContent === 'Технические работы: включены');
  assert.equal(await adm.page.isChecked('#maintGate'), true);
  assert.equal(demo.app.ctx.settings.get('maintenance'), true);
  await adm.page.screenshot({ path: '/tmp/claude-0/-home-claude/cc3b924b-8798-56ab-9683-fedc79375953/scratchpad/maint-admin.png' });

  // the player's next step: the app turns into one line (no tabs, no buttons)
  await pl.page.click(`[data-case="${demo.bySlug.noob.id}"]`);
  await pl.page.waitForSelector('[data-act="open"]');
  await pl.page.click('[data-act="open"]');
  await pl.page.waitForSelector('.splash-note');
  assert.equal(await pl.page.textContent('.splash-note'), 'Технические работы — скоро вернёмся');
  assert.equal(await pl.page.locator('#tabbar, .splash .btn, .modal-wrap').count(), 0);
  // a player who opens the app now gets the same; in English for an English player
  const late = await open({ user: { id: 7302, first_name: 'Late', language_code: 'en' } });
  await late.page.waitForSelector('.splash-note');
  assert.equal(await late.page.textContent('.splash-note'), 'Maintenance — back soon');
  assert.equal(await late.page.locator('#tabbar, .splash .btn').count(), 0);
  await late.page.screenshot({ path: '/tmp/claude-0/-home-claude/cc3b924b-8798-56ab-9683-fedc79375953/scratchpad/maint-player.png' });
  await late.page.context().close();

  // the main admin still uses the app
  await adm.page.reload();
  await adm.page.waitForSelector('.adm-stats');
  assert.equal(await adm.page.isChecked('#maintGate'), true);
  assert.equal(await adm.page.locator('#tabbar').count(), 1);

  // off: the player's app comes back by itself (it asks every 15 s)
  await adm.page.click('.maint-gate');
  await adm.page.waitForFunction(() => document.querySelector('.maint-gate span').textContent === 'Технические работы: выключены');
  assert.equal(demo.app.ctx.settings.get('maintenance'), false);
  await pl.page.waitForSelector('.case-grid', { timeout: 25000 });
  assert.equal(await pl.page.locator('#tabbar').count(), 1);
  await pl.page.context().close();
  await adm.page.context().close();
});

test('no console errors in any UI test', { skip }, () => {
  assert.deepEqual(allErrors.flat(), []);
});
