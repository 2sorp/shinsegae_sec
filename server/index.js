import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { app, close } = createApp({ databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'handover.db'), distPath: path.join(root, 'dist'), secureCookies: process.env.COOKIE_SECURE === 'true' });
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`인수인계 서버: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { close(); process.exit(0); }));
