// API client: Telegram initData or website login token, JSON helpers, live stream.
import { tg, store } from './util.js';

const CFG = window.BS_CONFIG || {};
const BASE = String(CFG.api || '').replace(/\/+$/, '');
export const apiUrl = (p) => BASE + p;

let authHeader = null;

/** Returns 'tg' | 'web' | null. */
export function initAuth() {
  const initData = tg && tg.initData;
  if (initData) {
    authHeader = 'tma ' + initData;
    return 'tg';
  }
  try {
    const url = new URL(location.href);
    const login = url.searchParams.get('login');
    if (login) {
      store.setItem('bs_web', login);
      url.searchParams.delete('login');
      history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    }
  } catch {
    /* ignore malformed URLs */
  }
  const tok = store.getItem('bs_web');
  if (tok) {
    authHeader = 'web ' + tok;
    return 'web';
  }
  return null;
}

export function clearWebAuth() {
  store.removeItem('bs_web');
  authHeader = null;
}

export class ApiError extends Error {
  constructor(code, status, data) {
    super(code);
    this.code = code;
    this.status = status;
    this.data = data || {};
  }
}

export async function api(method, path, body) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(apiUrl('/api' + path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('network', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError((data && data.error) || (res.status >= 500 ? 'default' : 'network'), res.status, data);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

/** Live drops / online / top drop. Falls back to polling if SSE is unavailable. */
export function stream({ drop, online, top24 }) {
  let es = null;
  let pollTimer = null;
  let lastId = 0;
  let failures = 0;

  async function poll() {
    try {
      const snap = await get('/feed');
      online(snap.online);
      top24(snap.top24);
      for (const d of [...snap.feed].reverse()) if (d.id > lastId) drop(d);
    } catch {
      /* try again later */
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, 8000);
  }

  function connect() {
    if (typeof EventSource === 'undefined') return startPolling();
    es = new EventSource(apiUrl('/api/stream'));
    es.addEventListener('drop', (e) => {
      const d = JSON.parse(e.data);
      lastId = Math.max(lastId, d.id);
      drop(d);
    });
    es.addEventListener('online', (e) => online(JSON.parse(e.data).online));
    es.addEventListener('top24', (e) => top24(JSON.parse(e.data)));
    es.onopen = () => {
      failures = 0;
    };
    es.onerror = () => {
      failures++;
      if (failures > 6 && es) {
        es.close();
        es = null;
        startPolling();
      }
    };
  }

  return {
    start(initialLastId = 0) {
      lastId = initialLastId;
      connect();
    },
    stop() {
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}
