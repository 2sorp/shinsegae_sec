import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const cookieName = 'handover_session';
const lifetime = 12 * 60 * 60 * 1000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const tokenFrom = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
const publicUser = user => ({ id: user.id, username: user.username, name: user.name });
function credentials(body) {
  if (typeof body?.username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(body.username)) throw fail(400, '아이디는 영문, 숫자, 밑줄 3~32자로 입력해 주세요.');
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw fail(400, '비밀번호는 8~128자로 입력해 주세요.');
  return { username: body.username.toLowerCase(), password: body.password };
}
export function installAuth(app, db, { secureCookies = false, sessionLifetime = lifetime } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, salt TEXT NOT NULL, passwordHash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, resetsAt INTEGER NOT NULL);`);
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Custom header + JSON prevent cross-site HTML forms; no CORS is enabled.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.get('X-Handover-Request') !== '1' || !req.is('application/json'))) return next(fail(403, '허용되지 않은 요청입니다.'));
    next();
  });
  const limit = (req, res, next) => {
    const now = Date.now();
    db.prepare('DELETE FROM auth_attempts WHERE resetsAt <= ?').run(now);
    db.prepare('INSERT INTO auth_attempts (ip, count, resetsAt) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = count + 1').run(req.ip, now + 15 * 60 * 1000);
    const attempt = db.prepare('SELECT * FROM auth_attempts WHERE ip = ?').get(req.ip);
    if (attempt.count > 20) { res.set('Retry-After', String(Math.ceil((attempt.resetsAt - now) / 1000))); return next(fail(429, '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.')); }
    next();
  };
  function session(req, res, user) {
    db.prepare('DELETE FROM sessions WHERE expiresAt <= ? OR tokenHash = ?').run(Date.now(), hash(tokenFrom(req)));
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), user.id, Date.now() + sessionLifetime);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionLifetime });
  }
  app.post('/api/auth/register', limit, async (req, res) => {
    const { username, password } = credentials(req.body);
    const name = req.body.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw fail(400, '이름은 1~40자로 입력해 주세요.');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await derive(password, salt, 64)).toString('hex');
    const user = { id: randomUUID(), username, name: name.trim() };
    try { db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(user.id, username, user.name, salt, passwordHash); }
    catch (error) { if (error.code?.startsWith('ERR_SQLITE') && db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw fail(409, '이미 사용 중인 아이디입니다.'); throw error; }
    session(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  app.post('/api/auth/login', limit, async (req, res) => {
    const { username, password } = credentials(req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const candidate = await derive(password, user?.salt || '00000000000000000000000000000000', 64);
    const matches = timingSafeEqual(candidate, user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64));
    if (!user || !matches) throw fail(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
    session(req, res, user);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(hash(tokenFrom(req)));
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    const user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.userId WHERE tokenHash = ? AND expiresAt > ?').get(hash(tokenFrom(req)), Date.now());
    if (!user) return next(fail(401, '로그인이 필요합니다.'));
    req.user = publicUser(user);
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
}
