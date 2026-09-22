import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';

const entry = { date: '2026-09-22', shift: 'EOD', priority: '긴급', author: '위조 이름', title: '2번 장비 점검', content: '재가동 전 점검이 필요합니다.', issues: '온도 상승', tags: ['#장비점검', 'NIGHT', 'night'] };
const account = { username: 'worker_1', password: 'test-password-123', name: '김담당' };
async function start(databasePath = ':memory:', options = {}) {
  const instance = createApp({ databasePath, ...options });
  const server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return { base, stop: async () => { await new Promise(resolve => server.close(resolve)); instance.close(); } };
}
function client(base) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(route, body, headers = {}) {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Handover-Request': '1' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    },
  };
}

test('registration, login, logout, CSRF protection and unauthenticated access', async () => {
  const running = await start();
  try {
    const c = client(running.base);
    for (const [route, body] of [['/handovers'], ['/handovers', entry], ['/handovers/missing/close', {}]]) assert.equal((await c.request(route, body)).status, 401);
    assert.equal((await c.request('/auth/register', account, { 'X-Handover-Request': '' })).status, 403);
    assert.equal((await c.request('/auth/register', { ...account, password: 'short' })).status, 400);
    const registration = await c.request('/auth/register', account);
    assert.equal(registration.status, 201);
    assert.match(registration.headers.get('set-cookie'), /HttpOnly/);
    assert.match(registration.headers.get('set-cookie'), /SameSite=Strict/);
    const user = (await registration.json()).user;
    assert.deepEqual(Object.keys(user).sort(), ['id', 'name', 'username']);
    assert.equal((await c.request('/auth/register', { ...account, username: 'WORKER_1' })).status, 409);
    const oldCookie = c.cookie;
    assert.equal((await c.request('/auth/logout', {})).status, 200);
    assert.equal((await c.request('/auth/me', undefined, { Cookie: oldCookie })).status, 401);
    assert.equal((await c.request('/auth/login', { ...account, password: 'incorrect-password' })).status, 401);
    assert.equal((await c.request('/auth/login', { ...account, username: 'unknown' })).status, 401);
    assert.equal((await c.request('/auth/login', { ...account, username: 'WORKER_1' })).status, 200);
    assert.equal((await (await c.request('/auth/me')).json()).user.id, user.id);
    const previous = c.cookie;
    await c.request('/auth/login', account);
    assert.notEqual(c.cookie, previous);
    assert.equal((await c.request('/auth/me', undefined, { Cookie: previous })).status, 401);
  } finally { await running.stop(); }
});

test('records, tags, authenticated identities and sessions survive restart', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'handover-test-'));
  let running;
  try {
    const database = path.join(folder, 'test.db');
    running = await start(database);
    const author = client(running.base);
    const registered = await (await author.request('/auth/register', account)).json();
    const response = await author.request('/handovers', entry);
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved.author, account.name);
    assert.equal(saved.authorId, registered.user.id);
    assert.deepEqual(saved.tags, ['장비점검', 'night']);
    assert.equal(saved.closedAt, null);
    assert.equal((await (await author.request('/handovers?tag=%23NIGHT')).json()).length, 1);
    assert.equal((await (await author.request('/handovers?tag=없는태그')).json()).length, 0);
    const colleague = client(running.base);
    const second = await (await colleague.request('/auth/register', { ...account, username: 'worker_2', name: '이교대' })).json();
    const confirmed = await colleague.request(`/handovers/${saved.id}/close`, { name: '위조 확인자' });
    assert.equal(confirmed.status, 200);
    const record = await confirmed.json();
    assert.equal(record.closedBy, '이교대');
    assert.equal(record.closedById, second.user.id);
    assert.ok(record.closedAt);
    assert.equal((await author.request(`/handovers/${saved.id}/close`, {})).status, 409);
    const cookie = author.cookie;
    await running.stop(); running = null;
    running = await start(database);
    const records = await (await fetch(`${running.base}/handovers?status=closed`, { headers: { Cookie: cookie } })).json();
    assert.equal(records.length, 1);
    assert.equal(records[0].closedBy, '이교대');
    assert.deepEqual(records[0].tags, ['장비점검', 'night']);
    const db = new DatabaseSync(database);
    const stored = db.prepare('SELECT * FROM users WHERE username = ?').get(account.username);
    assert.notEqual(stored.passwordHash, account.password);
    assert.equal(stored.passwordHash.length, 128);
    assert.ok(stored.salt);
    db.close();
  } finally {
    if (running) await running.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('invalid handover and tag inputs never insert records', async () => {
  const running = await start();
  try {
    const c = client(running.base);
    await c.request('/auth/register', account);
    for (const patch of [{ date: '2026-02-30' }, { shift: '없는 조' }, { priority: '알수없음' }, { content: '' }, { title: 'x'.repeat(121) }, { tags: 'bad' }, { tags: ['has space'] }, { tags: [5] }, { tags: ['x'.repeat(31)] }, { tags: Array(11).fill('tag') }]) assert.equal((await c.request('/handovers', { ...entry, ...patch })).status, 400);
    assert.equal((await c.request('/handovers/missing/close', {})).status, 404);
    assert.deepEqual(await (await c.request('/handovers')).json(), []);
  } finally { await running.stop(); }
});

test('expired sessions are rejected and production cookie is Secure', async () => {
  const running = await start(':memory:', { sessionLifetime: -1, secureCookies: true });
  try {
    const c = client(running.base);
    const response = await c.request('/auth/register', account);
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie'), /Secure/);
    assert.equal((await c.request('/auth/me')).status, 401);
  } finally { await running.stop(); }
});

test('authentication attempts are rate limited', async () => {
  const running = await start();
  try {
    const c = client(running.base);
    for (let i = 0; i < 20; i++) assert.equal((await c.request('/auth/login', {})).status, 400);
    const response = await c.request('/auth/login', {});
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
  } finally { await running.stop(); }
});

test('legacy database migration keeps existing handovers intact and is repeatable', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'handover-migration-'));
  const database = path.join(folder, 'legacy.db');
  let running;
  try {
    const db = new DatabaseSync(database);
    db.exec(`CREATE TABLE handovers (id TEXT PRIMARY KEY, date TEXT NOT NULL, shift TEXT NOT NULL, priority TEXT NOT NULL, author TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, issues TEXT NOT NULL, createdAt TEXT NOT NULL, acknowledgedBy TEXT, acknowledgedAt TEXT);
      INSERT INTO handovers VALUES ('legacy', '2026-09-22', '주간', '일반', '기존 작성자', '기존 기록', '내용', '', '2026-09-22T00:00:00Z', NULL, NULL);`);
    db.close();
    running = await start(database);
    await running.stop(); running = null;
    running = await start(database);
    const c = client(running.base);
    await c.request('/auth/register', account);
    const records = await (await c.request('/handovers')).json();
    assert.equal(records[0].author, '기존 작성자');
    assert.equal(records[0].shift, 'SOD');
    assert.equal(records[0].authorId, null);
    assert.deepEqual(records[0].tags, []);
  } finally {
    if (running) await running.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('legacy shifts and fixed types migrate without changing periods or closure history', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'handover-labels-'));
  const database = path.join(folder, 'test.db');
  try {
    createApp({ databasePath: database }).close();
    const db = new DatabaseSync(database);
    const insert = db.prepare(`INSERT INTO handovers (id, date, shift, priority, author, title, content, issues, createdAt, kind, pinStart, pinEnd, closedAt, closedBy)
      VALUES (?, '2026-09-22', ?, '일반', '작성자', '기록', '내용', '', '2026-09-22T00:00:00Z', ?, '2026-09-22', '2026-09-30', '2026-09-23T00:00:00Z', '종료자')`);
    insert.run('1', '주간', '작업');
    insert.run('2', '오후', '예외요청');
    insert.run('3', '야간', '일반');
    db.close();
    createApp({ databasePath: database }).close();
    createApp({ databasePath: database }).close();
    const migrated = new DatabaseSync(database);
    const records = migrated.prepare('SELECT * FROM handovers ORDER BY id').all();
    assert.deepEqual(records.map(e => e.shift), ['SOD', 'DOD', 'EOD']);
    assert.deepEqual(records.map(e => e.kind), ['고정', '고정', '일반']);
    for (const record of records) {
      assert.equal(record.pinStart, '2026-09-22');
      assert.equal(record.pinEnd, '2026-09-30');
      assert.equal(record.closedBy, '종료자');
      assert.equal(record.closedAt, '2026-09-23T00:00:00Z');
    }
    migrated.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('comments retain authenticated authors and closure archives the entire history', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'handover-comments-'));
  const database = path.join(folder, 'test.db');
  let running;
  try {
    running = await start(database);
    const c = client(running.base);
    await c.request('/auth/register', account);
    const saved = await (await c.request('/handovers', entry)).json();
    assert.equal((await c.request(`/handovers/${saved.id}/comments`, { content: '   ' })).status, 400);
    assert.equal((await c.request(`/handovers/${saved.id}/comments`, { content: 'x'.repeat(5001) })).status, 400);
    const response = await c.request(`/handovers/${saved.id}/comments`, { content: '장비 점검 시작', author: '위조' });
    assert.equal(response.status, 201);
    const first = await response.json();
    assert.equal(first.comments[0].author, account.name);
    assert.ok(first.comments[0].authorId);
    const second = await (await c.request(`/handovers/${saved.id}/comments`, { content: '점검 완료, 정상 가동' })).json();
    assert.deepEqual(second.comments.map(comment => comment.content), ['장비 점검 시작', '점검 완료, 정상 가동']);
    assert.equal((await (await c.request('/handovers')).json())[0].commentCount, 2);
    await c.request(`/handovers/${saved.id}/close`, {});
    assert.deepEqual(await (await c.request('/handovers')).json(), []);
    assert.equal((await (await c.request('/handovers?status=closed')).json()).length, 1);
    assert.equal((await c.request(`/handovers/${saved.id}/comments`, { content: '종료 후 변경' })).status, 409);
    assert.equal((await c.request('/handovers/missing/comments', { content: '없는 기록' })).status, 404);
    assert.equal((await c.request('/handovers?status=invalid')).status, 400);
    const cookie = c.cookie;
    await running.stop(); running = null;
    running = await start(database);
    const detail = await (await fetch(`${running.base}/handovers/${saved.id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(detail.comments.length, 2);
    assert.equal(detail.closedBy, account.name);
  } finally {
    if (running) await running.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('fixed handovers validate date ranges and keep their type and period', async () => {
  const running = await start();
  try {
    const c = client(running.base);
    await c.request('/auth/register', account);
    for (const patch of [{ kind: 'unknown' }, { kind: '고정' }, { kind: '고정', pinStart: '2026-02-30', pinEnd: '2026-03-02' }, { kind: '고정', pinStart: '2026-09-23', pinEnd: '2026-09-22' }]) assert.equal((await c.request('/handovers', { ...entry, ...patch })).status, 400);
    for (const kind of ['고정']) {
      const response = await c.request('/handovers', { ...entry, kind, pinStart: '2026-09-22', pinEnd: '2026-09-22' });
      assert.equal(response.status, 201);
      const saved = await response.json();
      assert.equal(saved.kind, kind);
      assert.equal(saved.pinStart, '2026-09-22');
      assert.equal(saved.pinEnd, '2026-09-22');
    }
  } finally { await running.stop(); }
});
