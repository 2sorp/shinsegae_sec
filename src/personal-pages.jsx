import React, { useEffect, useState } from 'react';

export function AccountSettings({ settings, onSave, post, date, onDateChange, today }) {
  const [shift, setShift] = useState(settings?.shift ?? 'SOD');
  const [draftDate, setDraftDate] = useState(date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (settings) setShift(settings.shift); }, [settings]);
  useEffect(() => { setDraftDate(date); }, [date]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const saved = await post('/api/settings', { shift });
      onSave(saved); onDateChange(draftDate === today ? null : draftDate);
      setNotice('저장했습니다. 새 인수인계부터 적용됩니다.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <details className="account-settings"><summary>근무 설정 · {settings?.shift ?? '불러오는 중'} · {date}</summary>
    <form className="account-settings-panel" onSubmit={save}>
      <h2>근무 설정</h2>
      <label>근무형태<select disabled={busy || !settings} value={shift} onChange={e => { setShift(e.target.value); setNotice(''); }}>{['SOD', 'DOD', 'EOD', '지원'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>근무일<input type="date" required disabled={busy} value={draftDate} onChange={e => { setDraftDate(e.target.value); setNotice(''); }} /></label>
      <button type="button" className="text-button" disabled={busy} onClick={() => { setDraftDate(today); setNotice(''); }}>오늘로 변경</button>
      <p className="field-help">날짜는 오늘(한국 시간)이 기본값이며 변경할 수 있습니다. 변경한 날짜는 현재 접속 중에 적용됩니다.</p>
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <button className="primary" disabled={busy || !settings}>{busy ? '저장 중…' : '저장'}</button>
    </form>
  </details>;
}

export function TodoPage({ api, post }) {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(null);
  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await api('/api/todos')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function add(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const item = await post('/api/todos', { title }); setItems(old => [item, ...old]); setTitle(''); setFilter('pending'); setNotice('할 일을 추가했습니다.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function change(item, remove = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await post(`/api/todos/${item.id}/${remove ? 'delete' : 'status'}`, remove ? {} : { completed: !item.completedAt });
      setItems(old => remove ? old.filter(value => value.id !== item.id) : old.map(value => value.id === item.id ? updated : value));
      setDeleting(null); setNotice(remove ? '할 일을 삭제했습니다.' : item.completedAt ? '진행 중으로 변경했습니다.' : '완료했습니다.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const pending = items.filter(item => !item.completedAt).length;
  const visible = items.filter(item => filter === 'all' || Boolean(item.completedAt) === (filter === 'done'));
  return <main><section className="intro"><div><p className="eyebrow">MY TO-DO LIST</p><h1>나의 할 일</h1><p>내 계정에서만 보이는 개인 할 일 목록입니다.</p></div><button disabled={loading || busy} onClick={refresh}>↻ 새로고침</button></section>
    <section className="personal-card todo-card"><form className="todo-add" onSubmit={add}><label>새 할 일<input required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} placeholder="이번 근무에 해야 할 일을 적어주세요" /></label><button className="primary" disabled={busy || loading || !title.trim()}>추가</button></form>
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <nav className="workflow-tabs" aria-label="할 일 상태">{[['pending', '진행 중', pending], ['done', '완료', items.length - pending], ['all', '전체', items.length]].map(([value, label, count]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label} <span>{count}</span></button>)}</nav>
      {loading ? <p className="empty" role="status">할 일을 불러오고 있습니다…</p> : visible.length === 0 ? <div className="empty">{filter === 'done' ? '완료한 할 일이 없습니다.' : '표시할 할 일이 없습니다.'}</div> : <ul className="todo-list">{visible.map(item => <li key={item.id}>
        <label className="todo-item"><input type="checkbox" checked={Boolean(item.completedAt)} disabled={busy} onChange={() => change(item)} /><span className={item.completedAt ? 'completed' : ''}>{item.title}<small>{item.completedAt ? '완료 ' : '등록 '}{new Date(item.completedAt || item.createdAt).toLocaleString('ko-KR')}</small></span></label>
        {deleting === item.id ? <div className="delete-confirm"><span>삭제할까요?</span><button disabled={busy} onClick={() => change(item, true)}>삭제 확인</button><button disabled={busy} onClick={() => setDeleting(null)}>취소</button></div> : <button className="text-button" disabled={busy} aria-label={`${item.title} 삭제`} onClick={() => setDeleting(item.id)}>삭제</button>}
      </li>)}</ul>}
    </section></main>;
}
