import test from 'node:test';
import assert from 'node:assert/strict';
import { isPinned, selectEntries } from './handover-view.js';
const filters = { date: '', shift: '', kind: '', query: '', tag: '' };
const base = { title: '작업', content: '내용', issues: '', author: '작성자', tags: ['점검'], date: '2026-09-22', createdAt: '2026-09-22T00:00:00Z', kind: '일반', closedAt: null };
test('pin period includes both dates, unpins outside period and never pins closed records', () => {
  const fixed = { ...base, kind: '고정', pinStart: '2026-09-21', pinEnd: '2026-09-23' };
  assert.equal(isPinned(fixed, '2026-09-20'), false);
  assert.equal(isPinned(fixed, '2026-09-21'), true);
  assert.equal(isPinned(fixed, '2026-09-23'), true);
  assert.equal(isPinned(fixed, '2026-09-24'), false);
  assert.equal(isPinned({ ...fixed, closedAt: '2026-09-22' }, '2026-09-22'), false);
});
test('main tab excludes closed records, pins active fixed records first, preserves expired work', () => {
  const ordinary = { ...base, id: 'normal' };
  const fixed = { ...base, id: 'fixed', date: '2026-09-01', kind: '고정', pinStart: '2026-09-21', pinEnd: '2026-09-23' };
  const expired = { ...fixed, id: 'expired', pinEnd: '2026-09-21' };
  const closed = { ...fixed, id: 'closed', closedAt: '2026-09-22T01:00:00Z' };
  const entries = [ordinary, closed, expired, fixed];
  assert.deepEqual(selectEntries(entries, 'active', filters, '2026-09-22').map(e => e.id), ['fixed', 'normal', 'expired']);
  assert.deepEqual(selectEntries(entries, 'closed', filters, '2026-09-22').map(e => e.id), ['closed']);
  assert.equal(selectEntries(entries, 'active', { ...filters, query: '#점검', kind: '고정' }, '2026-09-22').length, 2);
});
