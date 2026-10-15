// Minimal fake of the Telegram Bot API used by the tests.
import http from 'node:http';

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!m) return {};
  const boundary = '--' + (m[1] || m[2]);
  const out = {};
  const text = buf.toString('latin1');
  for (const part of text.split(boundary)) {
    const nm = /name="([^"]+)"/.exec(part);
    if (!nm) continue;
    const idx = part.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const head = part.slice(0, idx);
    let body = part.slice(idx + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    const fn = /filename="?([^";\r\n]*)"?/i.exec(head);
    const isFile = !!fn || /content-type:\s*(?!text\/plain)/i.test(head) || body.startsWith('\xff\xd8');
    if (isFile) out[nm[1]] = { filename: fn ? fn[1] : '', size: body.length };
    else {
      const val = Buffer.from(body, 'latin1').toString('utf8');
      try {
        out[nm[1]] = JSON.parse(val);
      } catch {
        out[nm[1]] = val;
      }
    }
  }
  return out;
}

export async function startMockTelegram() {
  const state = {
    calls: [],
    members: new Set(), // user ids subscribed to the channel
    memberErrors: new Map(), // user id -> the error getChatMember gives for them (e.g. 'Bad Request: PARTICIPANT_ID_INVALID')
    channelError: '', // getChatMember fails for everyone (e.g. the bot is not an admin of the channel)
    users: new Map(), // user id -> { first_name, last_name, username } as getChat returns them now (absent: no chat with the bot)
    botIsAdmin: true,
    webhookUrl: '',
    failSend: new Map(), // chat id -> { code, retry_after, times }
    msgId: 1,
    fileCounter: 1,
  };
  const me = {
    id: 777000,
    is_bot: true,
    first_name: 'DragonDrop',
    username: 'DragonDrop_Bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };

  function result(method, p) {
    switch (method) {
      case 'getMe':
        return me;
      case 'getWebhookInfo':
        return {
          url: state.webhookUrl,
          has_custom_certificate: false,
          pending_update_count: 0,
          ...(state.allowedUpdates ? { allowed_updates: state.allowedUpdates } : {}),
        };
      case 'setWebhook':
        state.webhookUrl = p.url;
        state.allowedUpdates = p.allowed_updates || null;
        return true;
      case 'createInvoiceLink':
        return `https://t.me/$inv_${state.msgId++}`;
      case 'deleteWebhook':
        state.webhookUrl = '';
        return true;
      case 'sendPhoto':
      case 'sendMessage': {
        const f = state.failSend.get(Number(p.chat_id));
        if (f && f.times > 0) {
          f.times--;
          return { __error: { error_code: f.code, description: f.code === 429 ? 'Too Many Requests' : 'Forbidden: bot was blocked by the user', parameters: f.retry_after ? { retry_after: f.retry_after } : undefined } };
        }
        const base = { message_id: state.msgId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(p.chat_id), type: 'private' } };
        if (method === 'sendPhoto') {
          const fid = typeof p.photo === 'string' && !p.photo.startsWith('attach://') ? p.photo : `PHOTO_FILE_${state.fileCounter++}`;
          return { ...base, photo: [{ file_id: fid, file_unique_id: 'u' + fid, width: 1280, height: 640 }], caption: p.caption };
        }
        return { ...base, text: p.text };
      }
      case 'getChatMember': {
        const uid = Number(p.user_id);
        if (uid === me.id) return { status: state.botIsAdmin ? 'administrator' : 'member', user: me };
        const err = state.channelError || state.memberErrors.get(uid);
        if (err) return { __error: { error_code: 400, description: err } };
        return { status: state.members.has(uid) ? 'member' : 'left', user: { id: uid, is_bot: false, first_name: 'U' } };
      }
      case 'getChat': {
        const uid = Number(p.chat_id);
        if (Number.isSafeInteger(uid) && uid > 0) {
          const u = state.users.get(uid);
          if (!u) return { __error: { error_code: 400, description: 'Bad Request: chat not found' } };
          return { id: uid, type: 'private', ...u };
        }
        return { id: -1001234567890, type: 'channel', title: 'DragonDrop News', username: String(p.chat_id).replace('@', '') };
      }
      case 'savePreparedInlineMessage':
        return { id: 'prep_' + p.user_id, expiration_date: Math.floor(Date.now() / 1000) + 3600 };
      default:
        return true;
    }
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)/.exec(req.url);
      if (!m) {
        res.writeHead(404).end();
        return;
      }
      const method = m[2];
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      let payload = {};
      if (ct.includes('application/json')) payload = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      else if (ct.includes('multipart/form-data')) payload = parseMultipart(buf, ct);
      state.calls.push({ method, payload });
      const r = result(method, payload);
      res.setHeader('Content-Type', 'application/json');
      if (r && r.__error) res.end(JSON.stringify({ ok: false, ...r.__error }));
      else res.end(JSON.stringify({ ok: true, result: r }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    state,
    me,
    calls: (method) => state.calls.filter((c) => !method || c.method === method),
    reset() {
      state.calls.length = 0;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
