// Admin panel (loaded only for admins).

const SECTIONS = ['overview', 'deposits', 'withdrawals', 'cases', 'items', 'users', 'referrals', 'promos', 'settings', 'broadcast'];
const REQ_KIND = { deposits: 'deposit', withdrawals: 'withdraw' };
// what the main admin can switch off for the other admins (the same list as src/access.js) and
// the tab each one is in
const ADMIN_SECTIONS = ['overview', 'deposits_brainrots', 'deposits_stars', 'withdrawals', 'cases', 'items', 'users', 'referrals', 'promos', 'settings', 'broadcast'];
const TAB_NEEDS = { deposits: ['deposits_brainrots', 'deposits_stars'] };
const SECTION_LABEL = { deposits_brainrots: 'a.sec.depBrainrots', deposits_stars: 'a.sec.depStars' };
/** Does this admin see the section? (the server decides; the main admin sees everything) */
const can = (section) => !C.S.adminSections || C.S.adminSections.includes(section);
const visibleTabs = () => SECTIONS.filter((tab) => (TAB_NEEDS[tab] || [tab]).some(can));
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'];

let C = null; // context from app.js
let bcastTimer = null;
let reqTimer = null;
let reqScope = 'active';
let reqSeq = 0; // the latest list/card load wins

function stopReqTimer() {
  if (reqTimer) clearInterval(reqTimer);
  reqTimer = null;
}

function h(...a) {
  return C.html(...a);
}

function adminError(e) {
  const code = e && e.code;
  if (code) {
    const key = 'a.e.' + code;
    const txt = C.t(key, { f: (e.data && (e.data.field || e.data.key || e.data.message)) || '' });
    if (txt !== key) {
      C.toast(txt, 'error');
      return;
    }
  }
  C.showError(e);
}

export function renderAdmin(view, route, ctx) {
  C = ctx;
  if (bcastTimer) {
    clearInterval(bcastTimer);
    bcastTimer = null;
  }
  stopReqTimer();
  const tabs = visibleTabs();
  if (!tabs.length) return C.go('#/cases');
  const sub = tabs.includes(route.sub) ? route.sub : tabs[0];
  if (sub !== route.sub) route = { ...route, id: undefined };
  view.onclick = null;
  C.render(
    view,
    h`<div class="adm">
      <div class="adm-tabs">${tabs.map(
        (s) => h`<a class="chip ${s === sub ? 'on' : ''}" href="#/admin/${s}">${C.t('a.' + s)}${REQ_KIND[s] ? h`<i class="chip-n" data-cnt="${REQ_KIND[s]}"></i>` : ''}</a>`,
      )}</div>
      <div id="admBody" class="adm-body"><div class="spinner"></div></div>
    </div>`,
  );
  if (sub !== 'overview') C.$('.adm-tabs .chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  refreshCounts();
  const body = C.$('#admBody');
  const run = {
    overview: () => overview(body),
    deposits: () => (route.id ? reqDetail(body, 'deposit', Number(route.id)) : reqList(body, 'deposit')),
    withdrawals: () => (route.id ? reqDetail(body, 'withdraw', Number(route.id)) : reqList(body, 'withdraw')),
    cases: () => (route.id ? caseEditor(body, route.id) : casesList(body)),
    items: () => itemsList(body),
    users: () => (route.id ? userDetail(body, Number(route.id)) : usersList(body)),
    referrals: () => (route.id ? refDetail(body, decodeURIComponent(route.id)) : referrals(body)),
    promos: () => promos(body),
    settings: () => settingsForm(body),
    broadcast: () => broadcast(body),
  }[sub];
  Promise.resolve(run()).catch(adminError);
}

// ------------------------------------------------------------------ overview
async function overview(body) {
  const o = await C.API.get('/admin/overview');
  if (!body.isConnected) return;
  const keys = ['users', 'new24', 'online', 'opened24', 'upgrades24', 'coins', 'items_value'];
  C.render(
    body,
    h`<div class="stats adm-stats">${keys.map(
      (k) => h`<div class="stat"><div class="s-val">${k === 'coins' || k === 'items_value' ? C.money(o[k], 15) : C.fmt(o[k])}</div><div class="s-lbl">${C.t('a.st.' + k)}</div></div>`,
    )}</div>`,
  );
}

// ------------------------------------------------------------------ cases
/** The free cases (FREE, nick, share): no price, no category, can't be deleted. */
const noPrice = (c) => !!(c.is_free || c.is_nick || c.is_share);

async function casesList(body) {
  const { cases, categories } = await C.API.get('/admin/cases');
  if (!body.isConnected) return;
  const lang = document.documentElement.lang || 'ru';
  const row = (c) => h`<a class="row" href="#/admin/cases/${c.id}">
        <span class="row-art">${C.caseArt(c, 44)}</span>
        <span class="row-main"><b>${c['name_' + lang] || c.name_ru}</b><small>${noPrice(c) ? 'FREE' : C.money(c.price, 12)} · ${C.t('a.rtp')}: ${c.rtp === null ? '—' : C.fmt(c.rtp) + '%'}</small></span>
        <span class="badge ${c.enabled ? 'ok' : 'off'}">${c.enabled ? C.t('a.on') : C.t('a.off')}</span>
      </a>`;
  const known = new Set(categories.map((k) => k.id));
  const loose = cases.filter((c) => noPrice(c) || !c.category_id || !known.has(c.category_id));
  C.render(
    body,
    h`<div class="adm-actions"><a class="btn small" href="#/admin/cases/new">+ ${C.t('a.newCase')}</a><button type="button" class="btn small ghost" data-cat-edit="new">+ ${C.t('a.category')}</button></div>
    ${categories.length ? h`<h4 class="sec-title">${C.t('a.noCategory')}</h4>` : ''}
    <div class="list">${loose.map(row)}</div>
    ${categories.map(
      (k) => h`<div class="cat-head" data-cat="${k.id}"><h4 class="sec-title">${k.name}</h4><button type="button" class="btn small ghost" data-cat-edit="${k.id}">${C.t('a.edit')}</button></div>
        <div class="list">${cases.filter((c) => !noPrice(c) && c.category_id === k.id).map(row)}</div>`,
    )}`,
  );
  body.onclick = (e) => {
    const b = e.target.closest('[data-cat-edit]');
    if (!b) return;
    const id = b.dataset.catEdit === 'new' ? null : Number(b.dataset.catEdit);
    categoryEditor(categories.find((k) => k.id === id) || null, cases, () => casesList(body).catch(adminError));
  };
}

/** Create / edit a category: name, order and which cases are in it. */
function categoryEditor(cat, cases, done) {
  const lang = document.documentElement.lang || 'ru';
  const paid = cases.filter((c) => !noPrice(c));
  const sheet = C.openModal(
    h`<form class="form" id="catForm" autocomplete="off">
      <div class="sheet-title">${cat ? cat.name : C.t('a.newCategory')}</div>
      <div class="grid3">
        <label class="span2">${C.t('a.catName')}<input class="input" name="name" maxlength="40" value="${cat ? cat.name : ''}"></label>
        <label>${C.t('a.sort')}<input class="input" name="sort" type="number" step="1" value="${cat ? cat.sort : 0}"></label>
      </div>
      <h4 class="sec-title">${C.t('a.catCases')}</h4>
      <div class="list cat-cases">${paid.map(
        (c) => h`<label class="row cat-case"><input type="checkbox" name="case" value="${c.id}" ${cat && c.category_id === cat.id ? C.raw('checked') : ''}>
          <span class="row-art">${C.caseArt(c, 40)}</span>
          <span class="row-main"><b>${c['name_' + lang] || c.name_ru}</b><small>${C.money(c.price, 11)}</small></span>
        </label>`,
      )}</div>
      <div class="form-foot">
        ${cat ? h`<button type="button" class="btn ghost danger" id="catDel">${C.t('a.delete')}</button>` : ''}
        <button type="submit" class="btn primary">${C.t('a.save')}</button>
      </div>
    </form>`,
    { cls: 'tall' },
  );
  const form = sheet.querySelector('#catForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = { name: String(f.get('name') || '').trim(), sort: Number(f.get('sort') || 0), caseIds: f.getAll('case').map(Number) };
    if (!payload.name) return adminError({ code: 'bad_field', data: { field: C.t('a.catName') } });
    try {
      if (cat) await C.API.put(`/admin/categories/${cat.id}`, payload);
      else await C.API.post('/admin/categories', payload);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
  sheet.querySelector('#catDel')?.addEventListener('click', async () => {
    if (!(await C.confirmModal(C.t('a.deleteCategory')))) return;
    try {
      await C.API.del(`/admin/categories/${cat.id}`);
      await C.reloadCatalog();
      done();
    } catch (err) {
      adminError(err);
    }
  });
}

async function caseEditor(body, id) {
  let data;
  const listed = await C.API.get('/admin/cases');
  if (!body.isConnected) return;
  const categories = listed.categories || [];
  if (id === 'new') {
    data = { id: null, name_ru: '', name_uk: '', name_en: '', price: 100, is_free: false, emoji: '📦', color: '#f59e0b', sort: 100, enabled: true, category_id: null, items: [] };
  } else {
    data = listed.cases.find((c) => c.id === Number(id));
    if (!data) return C.go('#/admin/cases');
  }
  const items = new Map(C.S.items.map((i) => [i.id, i]));
  // disabled items are not in the public list — fetch the full catalogue
  const all = await C.API.get('/admin/items');
  if (!body.isConnected) return;
  for (const i of all.items) items.set(i.id, i);
  const loot = data.items.map((e) => ({ ...e }));

  function summary() {
    const sum = loot.reduce((s, e) => s + (Number(e.chance) || 0), 0);
    const ev = sum ? loot.reduce((s, e) => s + ((Number(e.chance) || 0) / sum) * (items.get(e.itemId)?.value || 0), 0) : 0;
    const price = Number(body.querySelector('#cPrice')?.value || data.price) || 0;
    const rtp = price > 0 ? (ev / price) * 100 : null;
    return h`<div class="sum-row ${Math.abs(sum - 100) < 0.0001 ? 'ok' : 'bad'}"><span>${C.t('a.sum')}</span><b>${C.fmt(Math.round(sum * 10000) / 10000)}%</b></div>
      <div class="sum-row"><span>${C.t('a.ev')}</span><b>${C.money(Math.round(ev * 100) / 100, 13)}</b></div>
      ${rtp === null ? '' : h`<div class="sum-row"><span>${C.t('a.rtp')}</span><b>${C.fmt(Math.round(rtp * 100) / 100)}%</b></div>`}`;
  }

  function caseImgRow() {
    return h`<span class="img-lbl">${C.t('a.image')}</span>
      <label class="btn small ghost file-btn">${C.t('a.upload')}<input type="file" accept="image/*" id="cImgFile" hidden></label>
      ${data.image ? h`<button type="button" class="btn small ghost" id="cImgDel">${C.t('a.removeImg')}</button>` : ''}`;
  }

  function lootRows() {
    loot.sort((a, b) => (items.get(b.itemId)?.value || 0) - (items.get(a.itemId)?.value || 0));
    return h`${loot.map((e, i) => {
      const it = items.get(e.itemId);
      return h`<div class="loot-row r-${it ? it.rarity : 'common'}">
        <span class="lr-art">${it ? C.art(it) : '?'}</span>
        <span class="lr-name"><b>${it ? it.name : '#' + e.itemId}</b><small>${it ? C.money(it.value, 11) : ''}</small></span>
        <input class="input lr-chance" type="number" inputmode="decimal" step="any" min="0.0001" max="100" value="${e.chance}" data-i="${i}" aria-label="${C.t('a.chancePct')}">
        <button class="icon-btn small" data-rm="${i}" aria-label="${C.t('a.delete')}">×</button>
      </div>`;
    })}`;
  }

  C.render(
    body,
    h`<form class="form" id="caseForm" autocomplete="off">
      <div class="form-head"><a class="back" href="#/admin/cases">‹</a><span id="cPreview">${C.caseArt(data, 56)}</span><b>${data.id ? data['name_' + (document.documentElement.lang || 'ru')] : C.t('a.newCase')}</b></div>
      <label>${C.t('a.nameRu')}<input class="input" name="name_ru" maxlength="60" value="${data.name_ru}" required></label>
      <label>${C.t('a.nameUk')}<input class="input" name="name_uk" maxlength="60" value="${data.name_uk}" required></label>
      <label>${C.t('a.nameEn')}<input class="input" name="name_en" maxlength="60" value="${data.name_en}" required></label>
      <div class="grid3">
        ${noPrice(data) ? '' : h`<label>${C.t('a.price')}<input class="input" id="cPrice" name="price" type="number" min="1" step="1" value="${data.price}" required></label>`}
        <label>${C.t('a.emoji')}<input class="input" name="emoji" maxlength="16" value="${data.emoji}" required></label>
        <label>${C.t('a.color')}<input class="input color" name="color" type="color" value="${data.color}"></label>
        <label>${C.t('a.sort')}<input class="input" name="sort" type="number" step="1" value="${data.sort}"></label>
      </div>
      ${noPrice(data)
        ? ''
        : h`<label>${C.t('a.category')}<select class="input" name="category_id"><option value="">—</option>${categories.map(
            (k) => h`<option value="${k.id}" ${data.category_id === k.id ? C.raw('selected') : ''}>${k.name}</option>`,
          )}</select></label>`}
      ${data.id ? h`<div class="img-row" id="cImgRow">${caseImgRow()}</div>` : ''}
      <label class="switch"><input type="checkbox" name="enabled" ${data.enabled ? C.raw('checked') : ''}><i></i>${C.t('a.enabled')}</label>
      <h4 class="sec-title">${C.t('a.loot')}</h4>
      <div id="lootRows" class="loot">${lootRows()}</div>
      <div class="adm-actions">
        <button type="button" class="btn small ghost" id="addLoot">+ ${C.t('a.addItem')}</button>
        <button type="button" class="btn small ghost" id="normLoot">${C.t('a.normalize')}</button>
      </div>
      <div class="summary" id="lootSum">${summary()}</div>
      <div class="form-foot">
        ${data.id && !noPrice(data) ? h`<button type="button" class="btn ghost danger" id="delCase">${C.t('a.delete')}</button>` : ''}
        <button type="submit" class="btn primary">${C.t('a.save')}</button>
      </div>
    </form>`,
  );

  const form = body.querySelector('#caseForm');
  const refresh = () => {
    C.render(body.querySelector('#lootRows'), lootRows());
    C.render(body.querySelector('#lootSum'), summary());
  };
  form.addEventListener('input', (e) => {
    if (e.target.classList.contains('lr-chance')) {
      loot[Number(e.target.dataset.i)].chance = e.target.value;
      C.render(body.querySelector('#lootSum'), summary());
    }
    if (e.target.name === 'price') C.render(body.querySelector('#lootSum'), summary());
    if ((e.target.name === 'color' || e.target.name === 'emoji') && !data.image) {
      const f = new FormData(form);
      const color = /^#[0-9a-f]{6}$/i.test(f.get('color')) ? f.get('color') : data.color;
      C.render(body.querySelector('#cPreview'), C.chest(color, f.get('emoji') || data.emoji, 56));
    }
  });
  // picture: upload / remove without losing unsaved form edits
  const setCaseImage = (img) => {
    data.image = img;
    const f = new FormData(form);
    const color = /^#[0-9a-f]{6}$/i.test(f.get('color')) ? f.get('color') : data.color;
    C.render(body.querySelector('#cPreview'), C.caseArt({ ...data, color, emoji: f.get('emoji') || data.emoji }, 56));
    C.render(body.querySelector('#cImgRow'), caseImgRow());
  };
  body.querySelector('#cImgRow')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 512);
      const r = await C.API.post(`/admin/cases/${data.id}/image`, { dataUrl });
      await C.reloadCatalog();
      if (!body.isConnected) return;
      setCaseImage(r.case.image);
      C.toast(C.t('a.saved'), 'ok');
    } catch (err) {
      adminError(err);
    }
  });
  body.querySelector('#cImgRow')?.addEventListener('click', async (e) => {
    if (!e.target.closest('#cImgDel')) return;
    try {
      await C.API.del(`/admin/cases/${data.id}/image`);
      await C.reloadCatalog();
      if (!body.isConnected) return;
      setCaseImage(null);
    } catch (err) {
      adminError(err);
    }
  });
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      loot.splice(Number(rm.dataset.rm), 1);
      refresh();
    }
  });
  body.querySelector('#normLoot').addEventListener('click', () => {
    const sum = loot.reduce((s, e) => s + (Number(e.chance) || 0), 0);
    if (!sum) return;
    for (const e of loot) e.chance = Math.max(0.0001, Math.round(((Number(e.chance) || 0) / sum) * 1000000) / 10000);
    const diff = Math.round((100 - loot.reduce((s, e) => s + e.chance, 0)) * 10000) / 10000;
    if (loot.length && diff) {
      const top = loot.reduce((a, b) => (b.chance > a.chance ? b : a));
      top.chance = Math.round((top.chance + diff) * 10000) / 10000;
    }
    refresh();
  });
  body.querySelector('#addLoot').addEventListener('click', () =>
    pickItem(
      [...items.values()].filter((i) => !loot.some((e) => e.itemId === i.id)),
      (it) => {
        loot.push({ itemId: it.id, chance: 1 });
        refresh();
      },
    ),
  );
  body.querySelector('#delCase')?.addEventListener('click', async () => {
    if (!(await C.confirmModal(C.t('a.deleteCase')))) return;
    try {
      await C.API.del(`/admin/cases/${data.id}`);
      await C.reloadCatalog();
      C.go('#/admin/cases');
    } catch (e) {
      adminError(e);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = {
      name_ru: f.get('name_ru'),
      name_uk: f.get('name_uk'),
      name_en: f.get('name_en'),
      emoji: f.get('emoji'),
      color: f.get('color'),
      sort: Number(f.get('sort') || 0),
      enabled: f.get('enabled') === 'on',
      price: noPrice(data) ? 0 : Number(f.get('price')),
      ...(noPrice(data) ? {} : { category_id: f.get('category_id') ? Number(f.get('category_id')) : null }),
      items: loot.map((x) => ({ itemId: x.itemId, chance: Number(x.chance) })),
    };
    try {
      const r = data.id ? await C.API.put(`/admin/cases/${data.id}`, payload) : await C.API.post('/admin/cases', payload);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      if (!data.id) C.go(`#/admin/cases/${r.case.id}`);
      else caseEditor(body, data.id);
    } catch (err) {
      adminError(err);
    }
  });
}

function pickItem(list, onPick) {
  const sheet = C.openModal(
    h`<div class="picker">
      <input class="input" id="pickSearch" placeholder="${C.t('a.search')}" autocomplete="off">
      <div class="picker-list" id="pickList"></div>
    </div>`,
    { cls: 'tall' },
  );
  const draw = (q) => {
    const s = q.trim().toLowerCase();
    const f = list.filter((i) => !s || i.name.toLowerCase().includes(s)).sort((a, b) => a.value - b.value);
    C.render(
      sheet.querySelector('#pickList'),
      h`${f.map((i) => h`<button class="row r-${i.rarity}" data-pick="${i.id}"><span class="row-art">${C.art(i)}</span><span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)}</small></span></button>`)}`,
    );
  };
  draw('');
  sheet.querySelector('#pickSearch').addEventListener('input', (e) => draw(e.target.value));
  sheet.querySelector('#pickList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const it = list.find((i) => i.id === Number(b.dataset.pick));
    C.closeModal();
    onPick(it);
  });
}

// ------------------------------------------------------------------ items
async function itemsList(body) {
  const { items } = await C.API.get('/admin/items');
  if (!body.isConnected) return;
  C.render(
    body,
    h`<div class="adm-actions"><input class="input" id="itSearch" placeholder="${C.t('a.search')}" autocomplete="off"><button class="btn small" id="itNew">+ ${C.t('a.newItem')}</button></div>
    <div class="list" id="itList"></div>`,
  );
  const draw = (q) => {
    const s = (q || '').trim().toLowerCase();
    const f = items.filter((i) => !s || i.name.toLowerCase().includes(s)).sort((a, b) => a.value - b.value);
    C.render(
      body.querySelector('#itList'),
      h`${f.map(
        (i) => h`<button class="row r-${i.rarity}" data-item="${i.id}">
          <span class="row-art">${C.art(i)}</span>
          <span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)} · ${C.t('r.' + i.rarity)} · ${C.t('a.inCases', { n: i.inCases })}</small></span>
          ${i.enabled ? '' : h`<span class="badge off">${C.t('a.off')}</span>`}
        </button>`,
      )}`,
    );
  };
  draw('');
  body.querySelector('#itSearch').addEventListener('input', (e) => draw(e.target.value));
  body.querySelector('#itList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]');
    if (b) itemEditor(items.find((i) => i.id === Number(b.dataset.item)), () => itemsList(body));
  });
  body.querySelector('#itNew').addEventListener('click', () => itemEditor(null, () => itemsList(body)));
}

function resizeImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/webp', 0.9);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      resolve(out);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = url;
  });
}

function itemEditor(item, done) {
  const it = item || { id: null, name: '', value: 10, emoji: '🎁', rarityOverride: null, image_url: '', enabled: true, withdrawable: false, depositable: true, hasUpload: false };
  const sheet = C.openModal(
    h`<form class="form" id="itemForm" autocomplete="off">
      <div class="sheet-title">${it.id ? it.name : C.t('a.newItem')}</div>
      <label>${C.t('a.name')}<input class="input" name="name" maxlength="60" value="${it.name}" required></label>
      <div class="grid3">
        <label>${C.t('a.value')}<input class="input" name="value" type="number" min="0" step="1" value="${it.value}" required></label>
        <label>${C.t('a.emoji')}<input class="input" name="emoji" maxlength="16" value="${it.emoji}" required></label>
        <label>${C.t('a.rarity')}<select class="input" name="rarity"><option value="">${C.t('a.auto')}</option>${RARITIES.map(
          (r) => h`<option value="${r}" ${it.rarityOverride === r ? C.raw('selected') : ''}>${C.t('r.' + r)}</option>`,
        )}</select></label>
      </div>
      ${it.id
        ? h`<div class="img-row">
            <span class="img-prev r-${it.rarity || 'common'}">${C.art(it)}</span>
            <label class="btn small ghost file-btn">${C.t('a.upload')}<input type="file" accept="image/*" id="imgFile" hidden></label>
            ${it.hasUpload ? h`<button type="button" class="btn small ghost" id="imgDel">${C.t('a.removeImg')}</button>` : ''}
          </div>`
        : ''}
      <label>${C.t('a.imageUrl')}<input class="input" name="image_url" maxlength="500" value="${it.image_url || ''}" placeholder="https://…"></label>
      <label class="switch"><input type="checkbox" name="enabled" ${it.enabled ? C.raw('checked') : ''}><i></i>${C.t('a.enabled')}</label>
      <label class="switch"><input type="checkbox" name="withdrawable" ${it.withdrawable ? C.raw('checked') : ''}><i></i>${C.t('a.withdrawable')}</label>
      <label class="switch"><input type="checkbox" name="depositable" ${it.depositable !== false ? C.raw('checked') : ''}><i></i>${C.t('a.depositable')}</label>
      <div class="form-foot"><button type="submit" class="btn primary">${C.t('a.save')}</button></div>
    </form>`,
    { cls: 'tall' },
  );
  const form = sheet.querySelector('#itemForm');
  sheet.querySelector('#imgFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      await C.API.post(`/admin/items/${it.id}/image`, { dataUrl });
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
  sheet.querySelector('#imgDel')?.addEventListener('click', async () => {
    try {
      await C.API.del(`/admin/items/${it.id}/image`);
      await C.reloadCatalog();
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = {
      name: f.get('name'),
      value: Number(f.get('value')),
      emoji: f.get('emoji'),
      rarity: f.get('rarity') || null,
      image_url: f.get('image_url') || null,
      enabled: f.get('enabled') === 'on',
      withdrawable: f.get('withdrawable') === 'on',
      depositable: f.get('depositable') === 'on',
    };
    try {
      if (it.id) await C.API.put(`/admin/items/${it.id}`, payload);
      else await C.API.post('/admin/items', payload);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
      C.closeModal();
      done();
    } catch (err) {
      adminError(err);
    }
  });
}

// ------------------------------------------------------------------ users
function userRow(u) {
  return h`<a class="row" href="#/admin/users/${u.id}">
    <span class="avatar sm">${u.photo ? h`<img src="${u.photo}" alt="" referrerpolicy="no-referrer">` : (u.name || '?')[0].toUpperCase()}</span>
    <span class="row-main"><b>${u.name}</b><small>${u.username ? '@' + u.username + ' · ' : ''}ID ${u.id}</small></span>
    <span class="row-side">${C.money(u.balance, 12)}${u.isAdmin ? h`<span class="badge ok">${C.t('a.admin')}</span>` : ''}${u.isBanned ? h`<span class="badge bad">${C.t('a.banned')}</span>` : ''}</span>
  </a>`;
}

async function usersList(body) {
  C.render(
    body,
    h`<div class="adm-actions"><input class="input" id="uSearch" placeholder="${C.t('a.userSearch')}" autocomplete="off" inputmode="search"></div>
    <div class="list" id="uList"><div class="spinner"></div></div>`,
  );
  let timer = null;
  let seq = 0;
  const load = async (q) => {
    const my = ++seq;
    const r = await C.API.get('/admin/users?q=' + encodeURIComponent(q || ''));
    if (my !== seq || !body.isConnected) return;
    C.render(body.querySelector('#uList'), h`${r.users.map(userRow)}`);
  };
  await load('');
  if (!body.isConnected) return;
  body.querySelector('#uSearch').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(e.target.value).catch(adminError), 250);
  });
}

/** How a brainrot got into the player's inventory. */
function itemSource(f) {
  const lang = document.documentElement.lang || 'ru';
  const caseName = f.case ? f.case.name[lang] || f.case.name.ru : '';
  const saysCase = /кейс|case/i.test(caseName); // «Драгон кейс» needs no «Кейс» in front
  switch (f.type) {
    case 'case':
      return caseName ? (saysCase ? caseName : C.t('a.src.case', { name: caseName })) : C.t('a.src.caseAny');
    case 'free':
    case 'nick':
    case 'share':
      return caseName ? (saysCase ? caseName : C.t('a.src.free', { name: caseName })) : C.t('a.src.freeAny');
    case 'upgrade':
      return f.upgrade
        ? h`${C.t('a.src.upgrade')} · ${C.t('a.src.chance', { c: C.fmt(f.upgrade.chance) })} · ${C.t('a.src.bet')} ${C.money(f.upgrade.bet, 11)}`
        : C.t('a.src.upgrade');
    case 'admin':
      return f.admin ? C.t('a.src.adminName', { name: f.admin.name }) : C.t('a.src.admin');
    case 'crash':
      return C.t('a.src.crash');
    case 'dice':
      return C.t('a.src.dice');
    case 'deposit':
      if (!f.requestId) return C.t('a.src.deposit');
      return can('deposits_brainrots') ? h`<a class="src-link" href="#/admin/deposits/${f.requestId}">${C.t('a.r.deposit', { id: f.requestId })}</a>` : C.t('a.r.deposit', { id: f.requestId });
    case 'refund':
      if (!f.requestId) return C.t('a.src.refundAny');
      return can('withdrawals') ? h`<a class="src-link" href="#/admin/withdrawals/${f.requestId}">${C.t('a.src.refund', { id: f.requestId })}</a>` : C.t('a.src.refund', { id: f.requestId });
    default:
      return f.type;
  }
}

async function userDetail(body, id) {
  const d = await C.API.get(`/admin/users/${id}`);
  if (!body.isConnected) return;
  const u = d.user;
  const st = d.stats;
  C.render(
    body,
    h`<div class="form">
      <div class="form-head"><a class="back" href="#/admin/users">‹</a>
        <span class="avatar sm">${u.photo ? h`<img src="${u.photo}" alt="" referrerpolicy="no-referrer">` : (u.name || '?')[0].toUpperCase()}</span>
        <b>${u.name}</b>
      </div>
      <div class="kv"><span>ID</span><b>${u.id}</b></div>
      ${u.username ? h`<div class="kv"><span>Username</span><b>@${u.username}</b></div>` : ''}
      ${u.ref ? h`<div class="kv"><span>${C.t('a.refOf')}</span>${can('referrals') ? h`<a class="code" href="#/admin/referrals/${encodeURIComponent(u.ref)}">${u.ref}</a>` : h`<b class="code">${u.ref}</b>`}</div>` : ''}
      <div class="kv"><span>${C.t('a.lastSeen')}</span><b>${new Date(u.lastSeen).toLocaleString()}</b></div>
      <div class="kv"><span>${C.t('a.balance')}</span><b id="uBal">${C.money(u.balance, 14)}</b></div>
      <div class="bal-row">
        <input class="input" id="uAmount" type="number" step="1" placeholder="${C.t('a.amount')}">
        <button class="btn small" data-bal="add">${C.t('a.add')}</button>
        <button class="btn small ghost" data-bal="set">${C.t('a.set')}</button>
      </div>
      ${d.luck !== undefined
        ? h`<div class="kv"><span>${C.t('a.userLuck')}</span><b id="uLuck">×${C.fmt(d.luck)}</b></div>
          <div class="bal-row two">
            <input class="input" id="uLuckIn" type="number" min="1" max="10" step="0.1" value="${d.luck}" aria-label="${C.t('a.userLuck')}">
            <button class="btn small" data-luck>${C.t('a.save')}</button>
          </div>`
        : ''}
      <div class="adm-actions wrap">
        <button class="btn small ${u.isBanned ? '' : 'danger'} ghost" data-flag="is_banned" data-v="${u.isBanned ? 'false' : 'true'}">${u.isBanned ? C.t('a.unban') : C.t('a.ban')}</button>
        <button class="btn small ghost" data-flag="is_admin" data-v="${u.isAdmin ? 'false' : 'true'}">${u.isAdmin ? C.t('a.removeAdmin') : C.t('a.makeAdmin')}</button>
        <button class="btn small ghost" data-flag="revoke_web" data-v="true">${C.t('a.revokeWeb')}</button>
        <button class="btn small" id="uGive">${C.t('a.giveItem')}</button>
      </div>
      <h4 class="sec-title">${C.t('stats')}</h4>
      <div class="stats compact">
        <div class="stat"><div class="s-val">${C.fmt(st.casesOpened)}</div><div class="s-lbl">${C.t('casesOpened')}</div></div>
        <div class="stat"><div class="s-val">${C.money(st.totalSpent, 12)}</div><div class="s-lbl">${C.t('a.spent')}</div></div>
        <div class="stat"><div class="s-val">${C.money(st.totalWon, 12)}</div><div class="s-lbl">${C.t('totalWon')}</div></div>
        <div class="stat"><div class="s-val">${C.fmt(st.upgradesWon)} / ${C.fmt(st.upgradesTotal)}</div><div class="s-lbl">${C.t('upgrades')}</div></div>
      </div>
      <h4 class="sec-title">${C.t('inventory')} <span class="cnt">${d.inventory.length}</span></h4>
      <div class="list">${d.inventory.map(
        (inv) => h`<div class="row r-${inv.item.rarity}" data-src="${inv.from.type}"><span class="row-art">${C.art(inv.item)}</span><span class="row-main"><b>${inv.item.name}</b><small>${C.money(inv.item.value, 11)}</small><small class="inv-src">${itemSource(inv.from)} · ${C.fmtDateTime(inv.at)}</small></span><button class="icon-btn small" data-inv="${inv.invId}">×</button></div>`,
      )}</div>
      ${d.log.length
        ? h`<h4 class="sec-title">${C.t('a.log')}</h4><div class="list">${d.log.map(
            (l) => h`<div class="row"><span class="row-main"><b class="${l.delta >= 0 ? 'pos' : 'neg'}">${l.delta >= 0 ? '+' : ''}${C.fmt(l.delta)}</b><small>${l.reason} · ${new Date(l.created_at).toLocaleString()}</small></span></div>`,
          )}</div>`
        : ''}
    </div>`,
  );
  body.onclick = async (e) => {
      const bal = e.target.closest('[data-bal]');
      const flag = e.target.closest('[data-flag]');
      const inv = e.target.closest('[data-inv]');
      try {
        if (bal) {
          const amount = Number(body.querySelector('#uAmount').value);
          if (!Number.isFinite(amount) || body.querySelector('#uAmount').value === '') return;
          await C.API.post(`/admin/users/${id}/balance`, { mode: bal.dataset.bal, amount });
          C.toast(C.t('a.saved'), 'ok');
          if (id === C.S.me.id) await C.reloadMe();
          return userDetail(body, id);
        }
        if (e.target.closest('[data-luck]')) {
          const v = body.querySelector('#uLuckIn').value;
          if (v === '') return;
          await C.API.post(`/admin/users/${id}/luck`, { luck: Number(v) });
          C.toast(C.t('a.saved'), 'ok');
          if (id === C.S.me.id) await C.reloadCatalog();
          return userDetail(body, id);
        }
        if (flag) {
          await C.API.post(`/admin/users/${id}/flags`, { [flag.dataset.flag]: flag.dataset.v === 'true' });
          C.toast(C.t('a.saved'), 'ok');
          return userDetail(body, id);
        }
        if (inv) {
          await C.API.del(`/admin/users/${id}/inventory/${inv.dataset.inv}`);
          return userDetail(body, id);
        }
        if (e.target.closest('#uGive')) {
          pickItem(C.S.items, async (it) => {
            try {
              await C.API.post(`/admin/users/${id}/give`, { itemId: it.id });
              C.toast(C.t('a.saved'), 'ok');
              userDetail(body, id);
            } catch (err) {
              adminError(err);
            }
          });
        }
      } catch (err) {
        adminError(err);
      }
    };
}

// ------------------------------------------------------------------ referral codes
/** What a code (or a player of it) brought: brainrot deposits and, if counted, Stars payments. */
function refStats(x, stars) {
  return h`<span>${C.t('a.refDepShort')}: ${C.fmt(x.deposits)}</span><span>${C.money(x.depositValue, 11)}</span>${
    stars ? h`<span><span class="emo">⭐</span>${C.fmt(x.stars)}</span>` : ''
  }`;
}

/** The % a code's players get (main admin): the code's own % or its level's. */
const refPct = (c) => (c.pct === undefined ? '' : h` <span class="ref-bonus">+${C.fmt(c.pct)}%${c.bonusPct !== null ? ` · ${C.t('a.refOwn')}` : ''}</span>`);
const refOwner = (o) => (o ? `${o.name}${o.username && o.name !== '@' + o.username ? ' · @' + o.username : ''}` : '');

/** Referral levels (main admin): from how many of a code's players topped up, the % on top-ups. */
function levelRows(levels) {
  return levels.map(
    (l, i) => h`<div class="lvl-row">
      <b class="lvl-n">${C.t('a.refLvl', { n: i + 1 })}</b>
      <label>${i === 0 ? C.t('a.refFrom') : ''}<input class="input" name="from" type="number" min="0" step="1" value="${l.from}" aria-label="${C.t('a.refFrom')}" ${i === 0 ? C.raw('readonly') : ''}></label>
      <label>${i === 0 ? C.t('a.refPct') : ''}<input class="input" name="pct" type="number" min="0" max="500" step="0.01" value="${l.pct}" aria-label="${C.t('a.refPct')}"></label>
      <button type="button" class="icon-btn small" data-lvl-del="${i}" ${i === 0 ? C.raw('disabled') : ''} aria-label="${C.t('a.delete')}">×</button>
    </div>`,
  );
}

function levelsForm(body, levels) {
  const form = body.querySelector('#refLevels');
  if (!form) return;
  const rows = form.querySelector('.lvl-rows');
  const read = () => [...rows.querySelectorAll('.lvl-row')].map((r) => ({ from: r.querySelector('[name=from]').value, pct: r.querySelector('[name=pct]').value }));
  const draw = (lv) => {
    C.render(rows, h`${levelRows(lv)}`);
    form.querySelector('#lvlAdd').style.display = lv.length >= 10 ? 'none' : ''; // 10 levels at most
  };
  draw(levels);
  form.addEventListener('click', (e) => {
    const del = e.target.closest('[data-lvl-del]');
    if (del) {
      const lv = read();
      lv.splice(Number(del.dataset.lvlDel), 1);
      draw(lv);
    } else if (e.target.closest('#lvlAdd')) {
      const lv = read();
      const last = lv[lv.length - 1];
      lv.push({ from: (Number(last.from) || 0) + 50, pct: last.pct });
      draw(lv);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // each next level from more players: sorted by "from", the first one always from 0
    const lv = read()
      .map((l) => ({ from: l.from === '' ? NaN : Number(l.from), pct: l.pct === '' ? NaN : Number(String(l.pct).replace(',', '.')) }))
      .sort((a, b) => a.from - b.from);
    try {
      await C.API.put('/admin/settings', { ref_levels: lv });
      C.toast(C.t('a.saved'), 'ok');
      referrals(body);
    } catch (err) {
      if (err && err.code === 'bad_setting') C.toast(C.t('a.e.ref_levels'), 'error');
      else adminError(err);
    }
  });
}

async function referrals(body) {
  const d = await C.API.get('/admin/referrals');
  if (!body.isConnected) return;
  C.render(
    body,
    h`${d.levels
      ? h`<form class="form ref-levels" id="refLevels" autocomplete="off">
          <h4 class="sec-title">${C.t('a.refLevels')}</h4>
          <div class="note">${C.t('a.refLevelsNote')}</div>
          <div class="lvl-rows"></div>
          <div class="form-foot">
            <button type="button" class="btn ghost" id="lvlAdd">${C.t('a.refAddLevel')}</button>
            <button type="submit" class="btn primary">${C.t('a.save')}</button>
          </div>
        </form>`
      : ''}
    <form class="form" id="refNew" autocomplete="off">
      ${d.levels ? h`<h4 class="sec-title">${C.t('a.refNew')}</h4>` : ''}
      <div class="grid3">
        <label>${C.t('a.refCode')}<input class="input" name="code" maxlength="32" autocapitalize="characters" autocorrect="off" spellcheck="false" required></label>
        <label>${C.t('a.refPartner')}<input class="input" name="owner" maxlength="33" placeholder="${C.t('a.refPartnerPh')}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        ${d.canBonus ? h`<label>${C.t('a.refOwnPct')}<input class="input" name="bonusPct" type="number" min="0" max="500" step="0.01" placeholder="${C.t('a.refByLevel')}"></label>` : ''}
        <label class="${d.canBonus ? 'full' : ''}">${C.t('a.refNote')}<input class="input" name="note" maxlength="100"></label>
      </div>
      <div class="form-foot"><button class="btn primary" type="submit">${C.t('a.create')}</button></div>
    </form>
    <div class="list">${d.codes.map(
      (c) => h`<div class="row promo-row ${c.active ? '' : 'dim'}">
        <a class="row-main" href="#/admin/referrals/${encodeURIComponent(c.code)}"><b class="code">${c.code}${refPct(c)}</b>${c.note ? h`<small>${c.note}</small>` : ''}${
          c.owner ? h`<small>${C.t('a.refPartner')}: ${refOwner(c.owner)}</small>` : ''
        }<small class="ref-stats"><span>${C.t('a.refLvl', { n: c.level })}</span><span>${C.t('a.refPlayers')}: ${C.fmt(c.players)}</span><span>${C.t('a.refPaying')}: ${C.fmt(c.paying)}</span>${refStats(c, d.stars)}</small></a>
        <button class="btn small ghost" data-ref-toggle="${c.code}" data-v="${c.active ? 'false' : 'true'}">${c.active ? C.t('a.disable') : C.t('a.enable')}</button>
        <button class="icon-btn small" data-ref-del="${c.code}">×</button>
      </div>`,
    )}</div>`,
  );
  if (d.levels) levelsForm(body, d.levels);
  body.querySelector('#refNew').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const b = { code: f.get('code') || '', note: f.get('note') || '', owner: f.get('owner') || '' };
    if (d.canBonus) b.bonusPct = f.get('bonusPct') || ''; // empty: by level
    try {
      await C.API.post('/admin/referrals', b);
      C.toast(C.t('a.saved'), 'ok');
      referrals(body);
    } catch (err) {
      adminError(err);
    }
  });
  body.querySelector('.list').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-ref-toggle]');
    const del = e.target.closest('[data-ref-del]');
    try {
      if (tog) {
        await C.API.put(`/admin/referrals/${encodeURIComponent(tog.dataset.refToggle)}`, { active: tog.dataset.v === 'true' });
        referrals(body);
      } else if (del) {
        if (!(await C.confirmModal(`${C.t('a.delete')} ${del.dataset.refDel}?`))) return;
        await C.API.del(`/admin/referrals/${encodeURIComponent(del.dataset.refDel)}`);
        referrals(body);
      }
    } catch (err) {
      adminError(err);
    }
  });
}

/** One code: its level and bonus, the partner, what its players did and the players themselves. */
async function refDetail(body, code) {
  const d = await C.API.get(`/admin/referrals/${encodeURIComponent(code)}`);
  if (!body.isConnected) return;
  const c = d.code;
  const s = c.stats;
  const levels = d.levels || [];
  const next = levels.find((l) => l.n === c.level + 1);
  const stat = (v, k) => h`<div class="stat"><div class="s-val">${v}</div><div class="s-lbl">${C.t(k)}</div></div>`;
  C.render(
    body,
    h`<div class="form">
      <div class="form-head"><a class="back" href="#/admin/referrals">‹</a><b class="code">${c.code}</b>${c.active ? '' : h`<span class="badge off">${C.t('a.off')}</span>`}</div>
      ${c.note ? h`<div class="note">${c.note}</div>` : ''}
      <div class="stats adm-stats ref-sum">
        ${stat(C.fmt(s.players), 'a.refPlayers')}${stat(C.fmt(s.paying), 'a.refPaying')}
        ${stat(C.money(s.deposits, 15), 'a.refDepSum')}${stat(C.money(s.withdrawals, 15), 'a.refWithdrawals')}
        ${stat(C.money(s.bets, 15), 'a.refBets')}${stat(C.money(s.bonus, 15), 'a.refBonusGiven')}
      </div>
      <div class="kv"><span>${C.t('a.refLevel')}</span><b>${c.level}</b></div>
      ${next ? h`<div class="kv"><span>${C.t('refToNext', { n: next.n })}</span><b>${C.fmt(c.paying)} / ${C.fmt(next.from)}</b></div>` : ''}
      ${c.pct !== undefined
        ? h`<div class="kv"><span>${C.t('a.refBonus')}</span><b>+${C.fmt(c.pct)}% · ${c.bonusPct !== null ? C.t('a.refOwn') : C.t('a.refByLevel')}</b></div>
          <label class="ref-field">${C.t('a.refOwnPctEdit')}
            <span class="bal-row two">
              <input class="input" id="refBonusIn" type="number" min="0" max="500" step="0.01" value="${c.bonusPct === null ? '' : c.bonusPct}" placeholder="${C.t('a.refByLevel')}">
              <button type="button" class="btn small" id="refBonusSave">${C.t('a.save')}</button>
            </span>
          </label>`
        : ''}
      <div class="kv"><span>${C.t('a.refPartner')}</span><b>${c.owner ? refOwner(c.owner) : '—'}</b></div>
      <label class="ref-field">${C.t('a.refPartnerEdit')}
        <span class="bal-row two">
          <input class="input" id="refOwnerIn" maxlength="33" value="${c.owner ? (c.owner.username ? '@' + c.owner.username : String(c.owner.id)) : ''}" autocapitalize="off" autocorrect="off" spellcheck="false">
          <button type="button" class="btn small" id="refOwnerSave">${C.t('a.save')}</button>
        </span>
      </label>
      <div class="kv"><span>${C.t('a.refDeposits')}</span><b>${C.fmt(c.deposits)}</b></div>
      <div class="kv"><span>${C.t('a.refDepValue')}</span>${C.money(c.depositValue, 13)}</div>
      ${d.stars
        ? h`<div class="kv"><span>${C.t('a.refStars')}</span><b><span class="emo">⭐</span>${C.fmt(c.stars)}</b></div>
          <div class="kv"><span>${C.t('a.refStarsN')}</span><b>${C.fmt(c.starsPayments)}</b></div>`
        : ''}
      <div class="list">${
        d.players.length
          ? d.players.map((p) => {
              const inner = h`<span class="row-main"><b>${p.name}</b><small>${p.username ? '@' + p.username + ' · ' : ''}${C.fmtDateTime(p.at)}</small><small class="ref-stats">${refStats(p, d.stars)}</small></span>${
                p.paid ? h`<span class="badge ok">${C.t('a.refPaid')}</span>` : ''
              }`;
              return can('users') ? h`<a class="row" href="#/admin/users/${p.id}">${inner}</a>` : h`<div class="row">${inner}</div>`;
            })
          : h`<div class="empty-box"><p>${C.t('a.refEmpty')}</p></div>`
      }</div>
    </div>`,
  );
  const save = async (patch) => {
    try {
      await C.API.put(`/admin/referrals/${encodeURIComponent(code)}`, patch);
      C.toast(C.t('a.saved'), 'ok');
      refDetail(body, code);
    } catch (err) {
      adminError(err);
    }
  };
  // own %: empty = by level
  body.querySelector('#refBonusSave')?.addEventListener('click', () => save({ bonusPct: body.querySelector('#refBonusIn').value }));
  // partner: empty = none
  body.querySelector('#refOwnerSave').addEventListener('click', () => save({ owner: body.querySelector('#refOwnerIn').value.trim() }));
}

// ------------------------------------------------------------------ promo codes
async function promos(body) {
  const { promos: list } = await C.API.get('/admin/promos');
  if (!body.isConnected) return;
  C.render(
    body,
    h`<form class="form" id="promoNew" autocomplete="off">
      <label>${C.t('a.code')}<input class="input" name="code" maxlength="40" autocapitalize="characters"></label>
      <div class="grid3">
        <label>${C.t('a.coins')}<input class="input" name="amount" type="number" min="1" step="1" required></label>
        <label>${C.t('a.uses')}<input class="input" name="maxUses" type="number" min="1" step="1" value="1" required></label>
        <label>${C.t('a.hours')}<input class="input" name="expiresHours" type="number" min="0.1" step="0.1"></label>
      </div>
      <div class="form-foot"><button class="btn primary" type="submit">${C.t('a.create')}</button></div>
    </form>
    <div class="list">${list.map((p) => {
      const expired = p.expires_at && new Date(p.expires_at) < new Date();
      return h`<div class="row promo-row ${p.active && !expired ? '' : 'dim'}">
        <span class="row-main"><b class="code" data-copy="${p.code}">${p.code}</b><small>+${C.fmt(p.amount)} · ${C.t('a.used')}: ${C.fmt(p.uses)}/${C.fmt(p.max_uses)}${p.expires_at ? ' · ' + C.t('a.expires') + ' ' + new Date(p.expires_at).toLocaleString() : ''}</small></span>
        <button class="btn small ghost" data-toggle="${p.code}" data-v="${p.active ? 'false' : 'true'}">${p.active ? C.t('a.disable') : C.t('a.enable')}</button>
        <button class="icon-btn small" data-del="${p.code}">×</button>
      </div>`;
    })}</div>`,
  );
  body.querySelector('#promoNew').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await C.API.post('/admin/promos', {
        code: f.get('code') || '',
        amount: Number(f.get('amount')),
        maxUses: Number(f.get('maxUses')),
        expiresHours: f.get('expiresHours') ? Number(f.get('expiresHours')) : null,
      });
      C.toast(r.promo.code, 'ok');
      promos(body);
    } catch (err) {
      adminError(err);
    }
  });
  body.querySelector('.list').addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    const tog = e.target.closest('[data-toggle]');
    const del = e.target.closest('[data-del]');
    try {
      if (copy) {
        await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
        C.toast(C.t('a.copied'), 'ok');
      } else if (tog) {
        await C.API.patch(`/admin/promos/${encodeURIComponent(tog.dataset.toggle)}`, { active: tog.dataset.v === 'true' });
        promos(body);
      } else if (del) {
        if (!(await C.confirmModal(`${C.t('a.delete')} ${del.dataset.del}?`))) return;
        await C.API.del(`/admin/promos/${encodeURIComponent(del.dataset.del)}`);
        promos(body);
      }
    } catch (err) {
      adminError(err);
    }
  });
}

// ------------------------------------------------------------------ settings
const SETTING_FIELDS = [
  ['halloween', 'bool'],
  ['channel', 'text'],
  ['channel_url', 'url'],
  ['news_url', 'url'],
  ['support_url', 'url'],
  ['free_cooldown_hours', 'number'],
  ['free_require_sub', 'bool'],
  ['free_require_share', 'bool'],
  ['nick_tag', 'text'],
  ['nick_cooldown_hours', 'number'],
  ['share_case_count', 'number'],
  ['share_cooldown_hours', 'number'],
  ['share_require_sub', 'bool'],
  ['upgrade_edge', 'number'],
  ['upgrade_min_chance', 'number'],
  ['upgrade_max_chance', 'number'],
  ['upgrade_luck', 'number'],
  ['crash_edge', 'number'],
  ['crash_min_bet', 'number'],
  ['crash_max_bet', 'number'],
  ['crash_max_mult', 'number'],
  ['dice_min_bet', 'number'],
  ['dice_max_bet', 'number'],
  ['start_balance', 'number'],
  ['stars_rate', 'number'],
  ['ref_count_stars', 'bool'],
  ['auto_promo', 'bool'],
  ['auto_promo_min', 'number'],
  ['auto_promo_max', 'number'],
  ['auto_promo_hours', 'number'],
  ['buffs', 'buffs'],
  ['welcome_ru', 'textarea'],
  ['welcome_uk', 'textarea'],
  ['welcome_en', 'textarea'],
  ['admin_hidden', 'sections'],
];

/** Buffs on deposited brainrots (main admin): emoji, name and % of the price for each. */
const buffRow = (b) =>
  h`<div class="buff-row">
    <input class="input" name="b_emoji" maxlength="16" value="${b.emoji}" aria-label="${C.t('a.buffEmoji')}" placeholder="✨">
    <input class="input" name="b_name" maxlength="32" value="${b.name}" aria-label="${C.t('a.buffName')}" placeholder="${C.t('a.buffName')}">
    <input class="input" name="b_pct" inputmode="decimal" value="${b.pct}" aria-label="${C.t('a.buffPct')}" placeholder="%">
    <button type="button" class="icon-btn small" data-buff-del aria-label="${C.t('a.delete')}">×</button>
  </div>`;
const readBuffs = (form) =>
  [...form.querySelectorAll('.buff-row')]
    .map((r) => ({ emoji: r.querySelector('[name=b_emoji]').value.trim(), name: r.querySelector('[name=b_name]').value.trim(), pct: r.querySelector('[name=b_pct]').value.trim() }))
    .filter((b) => b.name || b.pct); // an empty row is left out

async function settingsForm(body) {
  const { settings: s } = await C.API.get('/admin/settings');
  if (!body.isConnected) return;
  const fields = SETTING_FIELDS.filter(([k]) => Object.hasOwn(s, k)); // some are for the main admin only
  C.render(
    body,
    h`<form class="form" id="setForm" autocomplete="off">
      ${fields.map(([k, type]) => {
        if (type === 'bool') return h`<label class="switch"><input type="checkbox" name="${k}" ${s[k] ? C.raw('checked') : ''}><i></i>${C.t('a.s.' + k)}</label>`;
        if (type === 'sections') {
          return h`<h4 class="sec-title">${C.t('a.s.' + k)}</h4>
            ${ADMIN_SECTIONS.map((x) => h`<label class="switch"><input type="checkbox" data-sec="${x}" ${s[k].includes(x) ? '' : C.raw('checked')}><i></i>${C.t(SECTION_LABEL[x] || 'a.' + x)}</label>`)}`;
        }
        if (type === 'textarea') return h`<label>${C.t('a.s.' + k)}<textarea class="input" name="${k}" rows="4" maxlength="1000">${s[k]}</textarea></label>`;
        if (type === 'buffs') {
          return h`<details class="set-buffs" id="setBuffs">
            <summary class="sec-title">${C.t('a.s.' + k)} <span class="cnt">${s[k].length}</span></summary>
            <div class="set-buffs-body">
              <div class="note">${C.t('a.buffsNote')}</div>
              <div class="buff-rows" id="buffRows">${s[k].map(buffRow)}</div>
              <button type="button" class="btn small ghost" id="buffAdd">${C.t('a.addBuff')}</button>
            </div>
          </details>`;
        }
        return h`<label>${C.t('a.s.' + k)}<input class="input" name="${k}" type="${type === 'number' ? 'number' : 'text'}" ${type === 'number' ? C.raw('step="any"') : ''} value="${s[k]}" ${type === 'url' ? C.raw('placeholder="https://t.me/…"') : ''}></label>`;
      })}
      <div class="form-foot">
        <button type="button" class="btn ghost" id="chkChannel">${C.t('a.checkChannel')}</button>
        <button type="submit" class="btn primary">${C.t('a.save')}</button>
      </div>
      <div id="chanStatus" class="note"></div>
    </form>`,
  );
  const form = body.querySelector('#setForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const patch = {};
    for (const [k, type] of fields) {
      if (type === 'bool') patch[k] = f.get(k) === 'on';
      else if (type === 'sections') patch[k] = ADMIN_SECTIONS.filter((x) => !form.querySelector(`[data-sec="${x}"]`).checked);
      else if (type === 'number') patch[k] = Number(f.get(k));
      else if (type === 'buffs') patch[k] = readBuffs(form);
      else patch[k] = String(f.get(k) || '');
    }
    try {
      await C.API.put('/admin/settings', patch);
      await C.reloadCatalog();
      C.toast(C.t('a.saved'), 'ok');
    } catch (err) {
      if (err && err.code === 'bad_setting' && err.data && err.data.key === 'buffs') {
        form.querySelector('#setBuffs').open = true;
        C.toast(C.t('a.e.buffs'), 'error');
      } else adminError(err);
    }
  });
  // buffs: a row more / a row less (saved with the form)
  form.querySelector('#setBuffs')?.addEventListener('click', (e) => {
    const rows = form.querySelector('#buffRows');
    const del = e.target.closest('[data-buff-del]');
    if (del) del.closest('.buff-row').remove();
    else if (e.target.closest('#buffAdd')) {
      rows.insertAdjacentHTML('beforeend', buffRow({ emoji: '', name: '', pct: '' }).__html);
      rows.lastElementChild.querySelector('[name=b_name]').focus();
    } else return;
    form.querySelector('#setBuffs .cnt').textContent = String(rows.children.length);
  });
  body.querySelector('#chkChannel').addEventListener('click', async () => {
    try {
      const r = await C.API.post('/admin/check-channel');
      body.querySelector('#chanStatus').textContent = C.t(r.botIsAdmin ? 'a.botAdminOk' : 'a.botAdminNo', { t: r.title });
      body.querySelector('#chanStatus').className = 'note ' + (r.botIsAdmin ? 'ok' : 'bad');
    } catch (err) {
      adminError(err);
    }
  });
}

// ------------------------------------------------------------------ broadcast
async function broadcast(body) {
  const { status } = await C.API.get('/admin/broadcast');
  if (!body.isConnected) return;
  C.render(
    body,
    h`<form class="form" id="bForm">
      <label>${C.t('a.bText')}<textarea class="input" name="text" rows="6" maxlength="4000" required></textarea></label>
      <label class="switch"><input type="checkbox" name="button" checked><i></i>${C.t('a.bButton')}</label>
      <div class="form-foot"><button class="btn primary" type="submit" ${status.running ? C.raw('disabled') : ''}>${C.t('a.bSend')}</button></div>
      <div class="note" id="bStatus"></div>
    </form>`,
  );
  const showStatus = (st) => {
    const el = body.querySelector('#bStatus');
    if (!el) return;
    if (!st.startedAt) {
      el.textContent = '';
      return;
    }
    el.textContent = (st.running ? C.t('a.bRunning') + ' ' : '') + C.t('a.bStatus', { s: st.sent, t: st.total, f: st.failed });
  };
  showStatus(status);
  const poll = () => {
    if (bcastTimer) clearInterval(bcastTimer);
    bcastTimer = setInterval(async () => {
      try {
        const r = await C.API.get('/admin/broadcast');
        showStatus(r.status);
        if (!r.status.running) {
          clearInterval(bcastTimer);
          bcastTimer = null;
          const btn = body.querySelector('#bForm button[type=submit]');
          if (btn) btn.disabled = false;
        }
      } catch {
        /* ignore */
      }
    }, 1000);
  };
  if (status.running) poll();
  body.querySelector('#bForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const text = String(f.get('text') || '').trim();
    if (!text) return;
    const btn = e.target.querySelector('button[type=submit]');
    if (btn.disabled || !(await C.confirmModal(C.t('a.bConfirm')))) return;
    btn.disabled = true;
    try {
      const r = await C.API.post('/admin/broadcast', { text, button: f.get('button') === 'on' });
      showStatus(r.status);
      poll();
    } catch (err) {
      btn.disabled = false;
      adminError(err);
    }
  });
}


// ------------------------------------------------------------------ deposits & withdrawals
const SECTION_OF = { deposit: 'deposits', withdraw: 'withdrawals' };
const REQ_SCOPES = ['active', 'done', 'rejected'];
const isOpen = (r) => r.method === 'brainrot' && (r.status === 'new' || r.status === 'active');

function refreshCounts() {
  C.API.get('/admin/requests/counts')
    .then(({ counts }) => {
      for (const el of C.$$('.chip-n')) el.textContent = counts[el.dataset.cnt] ? String(counts[el.dataset.cnt]) : '';
    })
    .catch(() => {});
}

function avatar(u) {
  return h`<span class="avatar sm">${u.photo ? h`<img src="${u.photo}" alt="" referrerpolicy="no-referrer">` : (u.name || '?')[0].toUpperCase()}</span>`;
}

const statusBadge = (r) => h`<span class="badge st-${r.status}">${C.t('a.r.st.' + r.status)}</span>`;

function reqRow(r) {
  let sub;
  if (r.method === 'stars') sub = h`<span class="emo">⭐</span>${C.fmt(r.stars)} → ${C.money(r.coins, 11)}`;
  else if (r.kind === 'withdraw') {
    sub = h`<span>${r.nick}</span><span class="req-minis">${r.items.slice(0, 4).map((i) => h`<span class="r-${i.rarity}">${C.art(i)}</span>`)}</span>${
      r.items.length > 4 ? h`<span>+${r.items.length - 4}</span>` : ''
    }${C.money(r.total, 11)}`;
  } else if (r.offer) {
    sub = h`<span>${r.nick}</span><span class="req-minis">${r.offer.slice(0, 4).map((i) => h`<span class="r-${i.rarity}">${C.art(i)}</span>`)}</span>${
      r.offer.length > 4 ? h`<span>+${r.offer.length - 4}</span>` : ''
    }${C.money(r.offerTotal, 11)}`;
  } else sub = h`<span>${r.nick}</span>`;
  const last = r.lastText || r.details;
  return h`<a class="row req-row ${r.waiting ? 'wait' : ''}" href="#/admin/${SECTION_OF[r.kind]}/${r.id}" data-req="${r.id}">
    ${avatar(r.user)}
    <span class="row-main"><b>#${r.id} · ${r.user.name}</b><small>${sub}</small>${last ? h`<small class="req-last">${last}</small>` : ''}</span>
    <span class="row-side">${statusBadge(r)}<small class="req-time">${C.fmtDateTime(r.updatedAt)}</small></span>
  </a>`;
}

async function reqList(body, kind) {
  stopReqTimer();
  const my = ++reqSeq;
  const load = () => C.API.get(`/admin/requests?kind=${kind}&scope=${reqScope}`);
  const { requests, brainrotsOpen } = await load();
  if (!body.isConnected || my !== reqSeq) return;
  const listHtml = (list) => (list.length ? h`<div class="list">${list.map(reqRow)}</div>` : h`<div class="empty-box"><p>${C.t('a.r.empty')}</p></div>`);
  const gateText = (open) => C.t(open ? 'a.depOpen' : 'a.depClosed');
  C.render(
    body,
    h`${brainrotsOpen !== undefined
      ? h`<label class="switch dep-gate${brainrotsOpen ? '' : ' closed'}"><input type="checkbox" id="depGate" ${brainrotsOpen ? C.raw('checked') : ''}><i></i><span>${gateText(brainrotsOpen)}</span></label>`
      : ''}
    <div class="seg adm-seg">${REQ_SCOPES.map((s) => h`<button type="button" data-scope="${s}" class="${reqScope === s ? 'on' : ''}">${C.t('a.r.sc.' + s)}</button>`)}</div>
    <div id="reqList">${listHtml(requests)}</div>`,
  );
  // brainrot deposits: close for a while / open again
  body.querySelector('#depGate')?.addEventListener('change', async (e) => {
    const box = e.target;
    const open = box.checked;
    box.disabled = true;
    try {
      const r = await C.API.put('/admin/deposit-gate', { open });
      box.checked = r.brainrotsOpen;
      box.closest('.dep-gate').classList.toggle('closed', !r.brainrotsOpen);
      box.closest('.dep-gate').querySelector('span').textContent = gateText(r.brainrotsOpen);
      C.toast(C.t('a.saved'), 'ok');
    } catch (err) {
      box.checked = !open;
      adminError(err);
    } finally {
      box.disabled = false;
    }
  });
  body.querySelector('.adm-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b || b.dataset.scope === reqScope) return;
    reqScope = b.dataset.scope;
    reqList(body, kind).catch(adminError);
  });
  // new requests and answers show up without reloading
  let sig = JSON.stringify(requests);
  let busy = false;
  reqTimer = setInterval(async () => {
    if (!body.isConnected || !body.querySelector('#reqList') || my !== reqSeq) return stopReqTimer();
    if (busy) return;
    busy = true;
    try {
      const r = await load();
      const next = JSON.stringify(r.requests);
      if (next !== sig && body.querySelector('#reqList') && my === reqSeq) {
        sig = next;
        C.render(body.querySelector('#reqList'), listHtml(r.requests));
        refreshCounts();
      }
    } catch {
      /* try again later */
    } finally {
      busy = false;
    }
  }, 8000);
}

function sysText(m, r) {
  const i = m.text.indexOf(':');
  const k = i < 0 ? m.text : m.text.slice(0, i);
  const arg = i < 0 ? '' : m.text.slice(i + 1);
  if (k === 'created') return C.t('a.r.sys.created');
  if (k === 'credit') return C.t('a.r.sys.credit', { n: C.fmt(Number(arg)) });
  if (k === 'give') {
    const it = r.items.find((x) => x.id === Number(arg)) || C.S.itemsById.get(Number(arg));
    return C.t('a.r.sys.give', { name: it ? it.name : '#' + arg });
  }
  if (k === 'status') return C.t('a.r.sys.' + (arg === 'done' ? 'done' : 'rejected'));
  return m.text;
}

function msgView(m, r) {
  if (m.author === 'system') return h`<div class="msg sys">${sysText(m, r)} · ${C.fmtDateTime(m.at)}</div>`;
  const mine = m.author === 'admin';
  return h`<div class="msg ${mine ? 'admin' : 'user'}">${m.text}<small>${mine ? (m.adminName || C.t('a.admin')) + ' · ' : ''}${C.fmtDateTime(m.at)}${
    mine && m.delivered === false ? h` · <b class="nd">⚠ ${C.t('a.r.notDelivered')}</b>` : ''
  }</small></div>`;
}

const itemLine = (i) =>
  h`<div class="row r-${i.rarity}"><span class="row-art">${C.art(i)}</span><span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)}</small></span></div>`;
// Buffs (mutations and traits) on the brainrots of the deposit card open now: the admin who takes them
// in the game ticks what they have, each buff adds its % of the brainrot's price (a few take some
// off) and the sum to credit is counted from it. itemId -> Map(buff name -> on how many of them)
let reqBuffs = { id: 0, lines: new Map() };
const buffsNow = () => (C.S.topup && C.S.topup.buffs) || [];

/** The brainrots of a deposit with the ticked buffs: price × count + price × the sum of their %s. */
function offerSum(offer) {
  const byName = new Map(buffsNow().map((b) => [b.name, b]));
  const lines = offer.map((i) => {
    const on = [...(reqBuffs.lines.get(i.id) || [])].map(([name, k]) => ({ b: byName.get(name), k })).filter((x) => x.b);
    const pct = on.reduce((s, x) => s + x.b.pct * x.k, 0);
    return { i, on, sum: Math.max(0, i.value * i.count + (i.value * pct) / 100) };
  });
  return { lines, buffed: lines.some((l) => l.on.length > 0), total: Math.round(lines.reduce((s, l) => s + l.sum, 0)) };
}

// a brainrot the player picked for a deposit, with how many of it (and, while the request is open, its buffs)
const offerLine = ({ i, on, sum }, edit) =>
  h`<div class="row r-${i.rarity} offer-row" data-offer="${i.id}">
    <span class="row-art">${C.art(i)}</span>
    <span class="row-main"><b>${i.name}</b><small>${C.money(i.value, 11)}</small></span>
    <span class="row-side"><b class="offer-n">×${i.count}</b>${on.length ? h`<span class="offer-sum">${C.money(Math.round(sum), 11)}</span>` : ''}</span>
    ${edit
      ? h`<div class="offer-buffs">${on.map(({ b, k }) => C.buffChip(b, k > 1 ? h`<i class="buff-k">×${k}</i>` : ''))}<button type="button" class="btn small ghost buff-add" data-buffs="${i.id}">${C.t('a.r.buffs')}</button></div>`
      : ''}
  </div>`;

function offerBox(r, edit) {
  const s = offerSum(r.offer);
  const canBuff = edit && buffsNow().length > 0;
  return h`<div class="list">${s.lines.map((l) => offerLine(l, canBuff))}</div>
    <div class="kv"><span>${C.t('a.r.total')}</span><b>${C.money(r.offerTotal, 13)}</b></div>
    ${s.buffed ? h`<div class="kv buffed"><span>${C.t('a.r.withBuffs')}</span><b id="buffTotal">${C.money(s.total, 13)}</b></div>` : ''}`;
}

/** The buffs changed: the brainrots, the sum with buffs and the amount to credit follow. */
function buffsChanged(body, r) {
  const box = body.querySelector('#offerBox');
  if (!body.isConnected || !box) return;
  const input = body.querySelector('#reqAmount');
  C.render(box, offerBox(r, !!input));
  if (input) input.value = String(offerSum(r.offer).total);
}

/**
 * Ticks the buffs of one brainrot of a deposit. With several of it, a buff can be on each of them:
 * every tap adds one more (×2, ×3…), the tap after the last takes it off.
 */
function pickBuffs(body, r, itemId) {
  const line = r.offer.find((i) => i.id === itemId);
  if (!line) return;
  if (!reqBuffs.lines.has(itemId)) reqBuffs.lines.set(itemId, new Map());
  const on = reqBuffs.lines.get(itemId);
  const sheet = C.openModal(
    h`<div class="buff-pick">
      <div class="row r-${line.rarity}"><span class="row-art">${C.art(line)}</span><span class="row-main"><b>${line.name}</b><small>${C.money(line.value, 11)}</small></span><span class="row-side"><b class="offer-n">×${line.count}</b></span></div>
      <div class="note">${C.t(line.count > 1 ? 'a.r.buffsNoteN' : 'a.r.buffsNote', { n: line.count })}</div>
      <div class="bp-tiers" id="bpTiers"></div>
      <div class="bp-foot"><button type="button" class="btn primary big" data-act="close-modal">${C.t('a.r.buffsDone')}</button></div>
    </div>`,
    { cls: 'tall' },
  );
  const draw = () =>
    C.render(
      sheet.querySelector('#bpTiers'),
      h`${C.buffTiers(buffsNow()).map(
        (x) => h`<div class="bt bt-${x.key} open" data-tier="${x.key}">
          <div class="bt-head"><b class="bt-name">${C.t('buffs.t.' + x.key)}</b><small>${C.t('buffs.s.' + x.key)}</small></div>
          <div class="bt-list">${x.list.map((b) => {
            const k = on.get(b.name) || 0;
            return h`<button type="button" class="buff-btn${k ? ' on' : ''}" data-buff="${b.name}" aria-pressed="${k ? 'true' : 'false'}">${C.buffChip(b, k > 1 ? h`<i class="buff-k">×${k}</i>` : '')}</button>`;
          })}</div>
        </div>`,
      )}`,
    );
  draw();
  sheet.querySelector('#bpTiers').addEventListener('click', (e) => {
    const el = e.target.closest('[data-buff]');
    if (!el) return;
    const name = el.dataset.buff;
    const k = on.get(name) || 0;
    if (k < line.count) on.set(name, k + 1);
    else on.delete(name);
    draw();
    buffsChanged(body, r);
  });
}

let reqSig = '';
let reqDrawn = 0; // bumps on every redraw of the card; a refresh that started before it is stale
const chatSig = (d) => `${d.messages.length}:${d.messages.at(-1)?.id || 0}`;
const cardSig = (d) => `${d.request.status}:${d.request.coins}:${d.request.items.length}:${d.request.user.balance}:${d.request.user.blockedBot}`;

function drawReq(body, d, { keep = false } = {}) {
  const r = d.request;
  const u = r.user;
  if (reqBuffs.id !== r.id) reqBuffs = { id: r.id, lines: new Map() };
  reqSig = cardSig(d) + '|' + chatSig(d);
  reqDrawn++;
  const draft = keep ? body.querySelector('#reqMsg')?.value || '' : '';
  const amount = keep ? body.querySelector('#reqAmount')?.value || '' : '';
  const active = keep ? document.activeElement : null;
  const focused = active && (active.id === 'reqMsg' || active.id === 'reqAmount') ? active.id : null;
  const caret = focused === 'reqMsg' ? [active.selectionStart, active.selectionEnd] : null;
  const open = isOpen(r);
  const player = h`${avatar(u)}<span class="row-main"><b>${u.name}</b><small>${u.username ? '@' + u.username + ' · ' : ''}ID ${u.id}</small></span><span class="row-side">${C.money(u.balance, 12)}</span>`;
  C.render(
    body,
    h`<div class="form req">
      <div class="form-head"><a class="back" href="#/admin/${SECTION_OF[r.kind]}">‹</a><b>${C.t('a.r.' + r.kind, { id: r.id })}</b>${statusBadge(r)}</div>
      ${can('users') ? h`<a class="row" href="#/admin/users/${u.id}">${player}</a>` : h`<div class="row">${player}</div>`}
      ${u.username ? h`<button type="button" class="btn small ghost req-tg" data-tg="https://t.me/${u.username}">${C.t('a.r.writeTg')}</button>` : ''}
      ${u.blockedBot ? h`<div class="note bad">${C.t('a.r.blocked')}</div>` : ''}
      ${r.nick ? h`<div class="kv"><span>${C.t('a.r.nick')}</span><b class="code" data-copy="${r.nick}">${r.nick}</b></div>` : ''}
      ${u.ref ? h`<div class="kv"><span>${C.t('a.refOf')}</span><b class="code">${u.ref}</b></div>` : ''}
      ${r.method === 'stars' ? h`<div class="kv"><span>${C.t('a.r.stars')}</span><b class="money"><span class="emo">⭐</span>${C.fmt(r.stars)} → ${C.money(r.coins, 13)}</b></div>` : ''}
      ${r.kind === 'deposit' && r.offer
        ? h`<h4 class="sec-title">${C.t('a.r.details')} <span class="cnt">${r.offer.reduce((s, i) => s + i.count, 0)}</span></h4>
           <div class="offer-box" id="offerBox">${offerBox(r, open)}</div>`
        : r.kind === 'deposit' && r.details
          ? h`<div class="req-field"><span>${C.t('a.r.details')}</span><div class="req-box">${r.details}</div></div>`
          : ''}
      ${r.kind === 'withdraw'
        ? h`<h4 class="sec-title">${C.t('a.r.items')} <span class="cnt">${r.items.length}</span></h4>
           <div class="list">${r.items.map(itemLine)}</div>
           <div class="kv"><span>${C.t('a.r.total')}</span><b>${C.money(r.total, 13)}</b></div>`
        : ''}
      ${r.exchange
        ? h`<h4 class="sec-title">${C.t('a.r.swapped')} <span class="cnt">${r.exchange.from.length}</span></h4>
           <div class="list">${r.exchange.from.map(itemLine)}</div>
           <div class="kv"><span>${C.t('a.r.rest')}</span><b>+${C.money(r.exchange.rest, 13)}</b></div>`
        : ''}
      ${r.kind === 'deposit' && r.method === 'brainrot' && r.coins ? h`<div class="kv"><span>${C.t('a.r.credited')}</span><b>${C.money(r.coins, 13)}</b></div>` : ''}
      ${r.promo ? h`<div class="kv"><span>${C.t('a.r.autoPromo')}</span><b>${r.promo.code} +${r.promo.pct}%${r.promo.bonus ? h` · ${C.t('a.r.autoBonus')} ${C.money(r.promo.bonus, 13)}` : ''}</b></div>` : ''}
      ${r.kind === 'deposit' && r.items.length ? h`<h4 class="sec-title">${C.t('a.r.given')} <span class="cnt">${r.items.length}</span></h4><div class="list">${r.items.map(itemLine)}</div>` : ''}
      ${open
        ? h`<div class="req-acts">
            ${r.kind === 'deposit'
              ? h`<div class="bal-row"><input class="input" id="reqAmount" type="number" min="1" step="1" inputmode="numeric" placeholder="${C.t('a.amount')}" value="${amount}"><button type="button" class="btn small" data-ra="credit">${C.t('a.r.credit')}</button><button type="button" class="btn small ghost" data-ra="give">${C.t('a.r.give')}</button></div>`
              : ''}
            <div class="row2"><button type="button" class="btn ghost danger" data-ra="rejected">${C.t('a.r.reject')}</button><button type="button" class="btn primary" data-ra="done">${C.t('a.r.done')}</button></div>
          </div>`
        : ''}
      <h4 class="sec-title">${C.t('a.r.chat')}</h4>
      <div class="chat" id="reqChat">${d.messages.map((m) => msgView(m, r))}</div>
      <form class="chat-form" id="reqForm" autocomplete="off">
        <textarea class="input" id="reqMsg" rows="2" maxlength="2000" placeholder="${C.t('a.r.msgPh')}">${draft}</textarea>
        <button class="btn primary" type="submit">${C.t('a.r.send')}</button>
      </form>
    </div>`,
  );
  if (focused) {
    const el = body.querySelector('#' + focused);
    el?.focus();
    if (caret && el) el.setSelectionRange(caret[0], caret[1]);
  }

  const after = async (res, { scroll = false } = {}) => {
    if (!body.isConnected) return;
    drawReq(body, res);
    refreshCounts();
    if (scroll) body.querySelector('#reqForm')?.scrollIntoView({ block: 'center' });
  };

  body.querySelector('#reqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = body.querySelector('#reqMsg');
    const text = ta.value.trim();
    if (!text) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await C.API.post(`/admin/requests/${r.id}/messages`, { text });
      if (!res.delivered) C.toast(C.t('a.r.notDeliveredToast'), 'error');
      await after(res, { scroll: true });
    } catch (err) {
      btn.disabled = false;
      adminError(err);
    }
  });

  body.onclick = async (e) => {
    const tgBtn = e.target.closest('[data-tg]');
    if (tgBtn) return C.openTg(tgBtn.dataset.tg);
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
      return C.toast(C.t('a.copied'), 'ok');
    }
    const bf = e.target.closest('[data-buffs]');
    if (bf) return pickBuffs(body, r, Number(bf.dataset.buffs));
    const ra = e.target.closest('[data-ra]');
    if (!ra || ra.disabled) return;
    const act = ra.dataset.ra;
    try {
      if (act === 'credit') {
        const input = body.querySelector('#reqAmount');
        const n = Number(input.value);
        if (!Number.isInteger(n) || n < 1) {
          input.focus();
          return adminError({ code: 'bad_field', data: { field: C.t('a.amount') } });
        }
        if (!(await C.confirmModal(C.t('a.r.creditConfirm', { n: C.fmt(n), u: u.name })))) return;
        const res = await C.API.post(`/admin/requests/${r.id}/credit`, { amount: n });
        body.querySelector('#reqAmount').value = '';
        reqBuffs.lines = new Map(); // counted and credited
        C.toast(C.t('a.saved'), 'ok');
        if (u.id === C.S.me.id) await C.reloadMe();
        return after(res);
      }
      if (act === 'give') {
        return pickItem(C.S.items, async (it) => {
          try {
            const res = await C.API.post(`/admin/requests/${r.id}/give`, { itemId: it.id });
            C.toast(C.t('a.saved'), 'ok');
            await after(res);
          } catch (err) {
            adminError(err);
          }
        });
      }
      if (act === 'done' || act === 'rejected') {
        const q = act === 'done' ? 'a.r.doneConfirm' : r.kind === 'withdraw' ? 'a.r.rejectConfirmW' : 'a.r.rejectConfirm';
        if (!(await C.confirmModal(C.t(q, { id: r.id })))) return;
        const res = await C.API.post(`/admin/requests/${r.id}/status`, { status: act });
        C.toast(C.t('a.saved'), 'ok');
        return after(res);
      }
    } catch (err) {
      adminError(err);
    }
  };
}

async function reqDetail(body, kind, id) {
  stopReqTimer();
  const my = ++reqSeq;
  if (!Number.isSafeInteger(id) || id <= 0) return C.go(`#/admin/${SECTION_OF[kind]}`);
  const d = await C.API.get(`/admin/requests/${id}`);
  if (!body.isConnected || my !== reqSeq) return;
  if (d.request.kind !== kind) return C.go(`#/admin/${SECTION_OF[d.request.kind]}/${id}`);
  drawReq(body, d);
  // the player's answers arrive through the bot — show them while the card is open
  let busy = false;
  reqTimer = setInterval(async () => {
    if (!body.isConnected || !body.querySelector('#reqChat') || my !== reqSeq) return stopReqTimer();
    if (busy) return;
    busy = true;
    const drawn = reqDrawn;
    try {
      const n = await C.API.get(`/admin/requests/${id}`);
      const chat = body.querySelector('#reqChat');
      // an action redrew the card while this refresh was on its way: its data is older
      if (!body.isConnected || !chat || n.request.id !== id || drawn !== reqDrawn || my !== reqSeq) return;
      const next = cardSig(n) + '|' + chatSig(n);
      if (next === reqSig) return;
      if (reqSig.split('|')[0] === cardSig(n)) {
        // only new messages: update the conversation, leave the inputs alone
        reqSig = next;
        C.render(chat, h`${n.messages.map((m) => msgView(m, n.request))}`);
      } else drawReq(body, n, { keep: true });
      refreshCounts();
    } catch {
      /* try again later */
    } finally {
      busy = false;
    }
  }, 5000);
}
