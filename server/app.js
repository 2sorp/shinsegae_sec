import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { installAuth } from './auth.js';

function tagsFrom(value = []) {
  if (!Array.isArray(value) || value.length > 10) throw invalid('해시태그는 최대 10개까지 입력할 수 있습니다.');
  return [...new Set(value.map(tag => {
    if (typeof tag !== 'string') throw invalid('해시태그 형식이 올바르지 않습니다.');
    const clean = tag.normalize('NFKC').replace(/^#/, '').toLowerCase();
    if (!/^[\p{L}\p{N}_-]{1,30}$/u.test(clean)) throw invalid('해시태그는 글자, 숫자, 밑줄, 하이픈 1~30자로 입력해 주세요.');
    return clean;
  }))];
}
const serialize = entry => ({ ...entry, tags: JSON.parse(entry.tags) });
function validDate(value, label) {
  const date = field(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw invalid(`올바른 ${label}을 입력해 주세요.`);
  return date;
}

const shifts = ['SOD', 'DOD', 'EOD', '지원'];
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }
function field(value, label, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw invalid(`${label}을(를) ${required ? '1' : '0'}~${max}자로 입력해 주세요.`);
  }
  return value.trim();
}
function validate(body) {
  const date = field(body.date, '근무일', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw invalid('올바른 근무일을 입력해 주세요.');
  if (!shifts.includes(body.shift)) throw invalid('근무조를 선택해 주세요.');
  if (!['일반', '중요', '긴급'].includes(body.priority)) throw invalid('중요도를 선택해 주세요.');
  const kind = body.kind ?? '일반';
  if (!['일반', '고정'].includes(kind)) throw invalid('인수인계 유형을 선택해 주세요.');
  const pinStart = kind === '일반' ? null : validDate(body.pinStart, '고정 시작일');
  const pinEnd = kind === '일반' ? null : validDate(body.pinEnd, '고정 종료일');
  if (pinStart && pinStart > pinEnd) throw invalid('고정 종료일은 시작일 이후여야 합니다.');
  return { date, shift: body.shift, priority: body.priority,
    kind, pinStart, pinEnd,
    author: field(body.author, '작성자', 40), title: field(body.title, '제목', 120),
    content: field(body.content, '인수인계 내용', 10000),
    issues: field(body.issues ?? '', '특이사항', 5000, false), tags: tagsFrom(body.tags) };
}

export function createApp({ databasePath = ':memory:', distPath, secureCookies = false, sessionLifetime, now = () => new Date() } = {}) {
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS handovers (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, shift TEXT NOT NULL,
      priority TEXT NOT NULL, author TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, issues TEXT NOT NULL, createdAt TEXT NOT NULL,
      acknowledgedBy TEXT, acknowledgedAt TEXT
    );`);
  const columns = db.prepare('PRAGMA table_info(handovers)').all().map(column => column.name);
  for (const [column, definition] of [['tags', "TEXT NOT NULL DEFAULT '[]'"], ['authorId', 'TEXT'], ['acknowledgedById', 'TEXT'], ['kind', "TEXT NOT NULL DEFAULT '일반'"], ['pinStart', 'TEXT'], ['pinEnd', 'TEXT'], ['closedAt', 'TEXT'], ['closedBy', 'TEXT'], ['closedById', 'TEXT']]) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE handovers ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`UPDATE handovers SET shift = CASE shift WHEN '주간' THEN 'SOD' WHEN '오후' THEN 'DOD' WHEN '야간' THEN 'EOD' END WHERE shift IN ('주간', '오후', '야간');
    UPDATE handovers SET kind = '고정' WHERE kind IN ('작업', '예외요청');`);
  db.exec(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, handoverId TEXT NOT NULL REFERENCES handovers(id),
    authorId TEXT NOT NULL, author TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS comments_handover ON comments(handoverId);`);
  function findEntry(id) {
    const entry = db.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    if (!entry) throw Object.assign(new Error('기록을 찾을 수 없습니다.'), { status: 404 });
    return entry;
  }
  function detail(id) {
    const comments = db.prepare('SELECT * FROM comments WHERE handoverId = ? ORDER BY createdAt, rowid').all(id);
    return { ...serialize(findEntry(id)), comments, commentCount: comments.length };
  }
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  installAuth(app, db, { secureCookies, sessionLifetime });
  db.exec(`CREATE TABLE IF NOT EXISTS user_settings (userId TEXT PRIMARY KEY, shift TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, createdAt TEXT NOT NULL, completedAt TEXT);
    CREATE INDEX IF NOT EXISTS todos_user ON todos(userId);`);
  const settings = id => db.prepare('SELECT shift FROM user_settings WHERE userId = ?').get(id) ?? { shift: 'SOD' };
  app.get('/api/settings', (req, res) => res.json(settings(req.user.id)));
  app.post('/api/settings', (req, res) => {
    if (!shifts.includes(req.body?.shift)) throw invalid('근무형태를 선택해 주세요.');
    db.prepare('INSERT INTO user_settings VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET shift = excluded.shift').run(req.user.id, req.body.shift);
    res.json(settings(req.user.id));
  });
  app.get('/api/todos', (req, res) => res.json(db.prepare('SELECT * FROM todos WHERE userId = ? ORDER BY createdAt DESC, rowid DESC').all(req.user.id)));
  app.post('/api/todos', (req, res) => {
    const title = field(req.body?.title, '할 일', 300);
    const id = randomUUID();
    db.prepare('INSERT INTO todos VALUES (?, ?, ?, ?, NULL)').run(id, req.user.id, title, now().toISOString());
    res.status(201).json(db.prepare('SELECT * FROM todos WHERE id = ?').get(id));
  });
  function ownTodo(req) {
    const item = db.prepare('SELECT * FROM todos WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
    if (!item) throw Object.assign(new Error('할 일을 찾을 수 없습니다.'), { status: 404 });
    return item;
  }
  app.post('/api/todos/:id/status', (req, res) => {
    const item = ownTodo(req);
    if (typeof req.body?.completed !== 'boolean') throw invalid('완료 상태가 올바르지 않습니다.');
    db.prepare('UPDATE todos SET completedAt = ? WHERE id = ? AND userId = ?').run(req.body.completed ? item.completedAt ?? now().toISOString() : null, item.id, req.user.id);
    res.json(db.prepare('SELECT * FROM todos WHERE id = ?').get(item.id));
  });
  app.post('/api/todos/:id/delete', (req, res) => {
    const item = ownTodo(req);
    db.prepare('DELETE FROM todos WHERE id = ? AND userId = ?').run(item.id, req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/handovers', (req, res) => {
    const status = req.query.status ?? 'active';
    if (!['active', 'closed', 'all'].includes(status)) throw invalid('올바른 조회 상태를 선택해 주세요.');
    const entries = db.prepare(`SELECT handovers.*, (SELECT COUNT(*) FROM comments WHERE handoverId = handovers.id) AS commentCount FROM handovers
      WHERE ? = 'all' OR (? = 'active' AND closedAt IS NULL) OR (? = 'closed' AND closedAt IS NOT NULL)
      ORDER BY closedAt DESC, date DESC, createdAt DESC, id DESC`).all(status, status, status).map(serialize);
    const tag = req.query.tag === undefined ? null : tagsFrom([req.query.tag])[0];
    res.json(tag ? entries.filter(entry => entry.tags.includes(tag)) : entries);
  });
  app.get('/api/handovers/:id', (req, res) => res.json(detail(req.params.id)));
  app.post('/api/handovers', (req, res) => {
    const created = now();
    const date = req.body?.date ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(created);
    const entry = { id: randomUUID(), ...validate({ ...req.body, author: req.user.name, date, shift: settings(req.user.id).shift }), createdAt: created.toISOString() };
    db.prepare(`INSERT INTO handovers (id, date, shift, priority, author, title, content, issues, createdAt, tags, authorId, kind, pinStart, pinEnd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.id, entry.date, entry.shift, entry.priority, entry.author, entry.title, entry.content, entry.issues, entry.createdAt, JSON.stringify(entry.tags), req.user.id, entry.kind, entry.pinStart, entry.pinEnd);
    res.status(201).json(detail(entry.id));
  });
  app.post('/api/handovers/:id/comments', (req, res) => {
    const existing = findEntry(req.params.id);
    if (existing.closedAt) return res.status(409).json({ error: '종료된 인수인계에는 댓글을 추가할 수 없습니다.' });
    const content = field(req.body?.content, '댓글', 5000);
    db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), existing.id, req.user.id, req.user.name, content, new Date().toISOString());
    res.status(201).json(detail(existing.id));
  });
  app.post('/api/handovers/:id/close', (req, res) => {
    const existing = findEntry(req.params.id);
    if (existing.closedAt) return res.status(409).json({ error: '이미 종료된 인수인계입니다. 목록을 새로고침해 주세요.' });
    db.prepare('UPDATE handovers SET closedBy = ?, closedAt = ?, closedById = ? WHERE id = ? AND closedAt IS NULL')
      .run(req.user.name, new Date().toISOString(), req.user.id, req.params.id);
    res.json(detail(existing.id));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '지원하지 않는 API입니다.' }));
  if (distPath && existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get('/', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.use((error, req, res, next) => {
    const status = error.status ?? 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? '서버 처리 중 오류가 발생했습니다.' : error.type === 'entity.parse.failed' ? '잘못된 JSON 요청입니다.' : error.message });
  });
  return { app, close: () => db.close() };
}
