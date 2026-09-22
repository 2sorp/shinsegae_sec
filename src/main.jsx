import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './auth-tags.css';
import './workflow.css';
import { seoulDate, isPinned, selectEntries } from './handover-view.js';

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const fresh = (kind = '일반') => ({ date: today(), shift: 'SOD', priority: '일반', title: '', content: '', issues: '', tags: '', kind, pinStart: seoulDate(), pinEnd: seoulDate() });
const emptyFilters = () => ({ date: '', shift: '', kind: '', query: '', tag: '' });
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error || '요청을 처리하지 못했습니다.');
  }
  return data;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Handover-Request': '1' }, body: JSON.stringify(body) });
const timestamp = value => new Date(value).toLocaleString('ko-KR');

function Auth({ onLogin }) {
  const [register, setRegister] = useState(false);
  const [values, setValues] = useState({ username: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { onLogin((await post(`/api/auth/${register ? 'register' : 'login'}`, values)).user); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card"><span className="brand-mark">↗</span><p className="eyebrow">SHIFT HANDOVER</p><h1>{register ? '함께 시작하는 다음 근무' : '다음 근무에 오신 것을 환영합니다'}</h1><p>로그인하고 근무 기록을 안전하게 이어가세요.</p>
    <form onSubmit={submit}>
      {register && <label>이름<input required maxLength={40} autoComplete="name" value={values.name} onChange={e => setValues({ ...values, name: e.target.value })} /></label>}
      <label>아이디<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" placeholder="영문, 숫자, 밑줄 3~32자" value={values.username} onChange={e => setValues({ ...values, username: e.target.value })} /></label>
      <label>비밀번호<input required type="password" minLength={8} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} placeholder="8자 이상" value={values.password} onChange={e => setValues({ ...values, password: e.target.value })} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary auth-submit" disabled={busy}>{busy ? '처리 중…' : register ? '회원가입' : '로그인'}</button>
    </form>
    <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); setValues({ ...values, password: '' }); }}>{register ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입'}</button>
  </section></main>;
}

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  async function check() {
    setChecking(true); setError('');
    try { setUser((await api('/api/auth/me')).user); }
    catch (e) { if (e.message !== '로그인이 필요합니다.') setError(e.message); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    check();
    const expire = () => setUser(null);
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  if (checking) return <main className="empty" role="status">로그인 상태를 확인하고 있습니다…</main>;
  if (error) return <main><p className="error" role="alert">{error}</p><button onClick={check}>다시 시도</button></main>;
  return user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <Auth onLogin={setUser} />;
}

function Dashboard({ user, onLogout }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [tab, setTab] = useState('active');
  const [day, setDay] = useState(seoulDate);
  const [comment, setComment] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setLoading(true); setError('');
    try { setEntries(await api('/api/handovers?status=all')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const timer = setInterval(() => setDay(seoulDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected?.id) return;
    let cancelled = false;
    setDetailLoading(true); setDetailError(''); setComment('');
    api(`/api/handovers/${selected.id}`).then(entry => {
      if (!cancelled) { setSelected(entry); setEntries(old => old.map(item => item.id === entry.id ? entry : item)); }
    }).catch(e => { if (!cancelled) setDetailError(e.message); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);
  const modalOpen = Boolean(form || selected);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement;
    const dialog = document.querySelector('dialog');
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, [modalOpen]);
  function close() { if (!busy) { setForm(null); setSelected(null); } }
  async function logout() {
    setBusy(true); setError('');
    try { await post('/api/auth/logout', {}); onLogout(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const tags = form.tags.split(/[\s,#]+/u).filter(Boolean);
      const saved = await post('/api/handovers', { ...form, tags });
      setEntries(old => [saved, ...old].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
      setForm(null); setFilters(emptyFilters()); setTab('active'); setNotice('인수인계 기록이 등록되었습니다.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function finish(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const updated = await post(`/api/handovers/${selected.id}/close`, {});
      setEntries(old => old.map(entry => entry.id === updated.id ? updated : entry));
      setSelected(null); setNotice('종료 처리했습니다. 종료 이력 탭에서 내용과 댓글을 확인할 수 있습니다.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function addComment(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const updated = await post(`/api/handovers/${selected.id}/comments`, { content: comment });
      setSelected(updated); setEntries(old => old.map(entry => entry.id === updated.id ? updated : entry)); setComment('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function filter(key, value) { setFilters(old => ({ ...old, [key]: value })); }
  function edit(key, value) { setForm(old => ({ ...old, [key]: value })); }
  const visible = selectEntries(entries, tab, filters, day);
  const pending = entries.filter(entry => !entry.closedAt);
  const allTags = [...new Set(entries.filter(entry => Boolean(entry.closedAt) === (tab === 'closed')).flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, 'ko'));

  return <>
    <header><a href="/" className="brand"><span className="brand-mark">↗</span>다음 근무<span className="brand-sub">교대 근무 인수인계</span></a><div className="user-menu"><span>{user.name} 님</span><button className="text-button" disabled={busy} onClick={logout}>로그아웃</button></div></header>
    <main>
      <section className="intro"><div><p className="eyebrow">SHIFT HANDOVER</p><h1>다음 근무도, 빈틈없이.</h1><p>처리 과정을 함께 기록하고 완료한 업무는 종료 이력으로 남기세요.</p></div><div className="create-buttons"><button onClick={() => { setError(''); setForm(fresh('고정')); }}>⌖ 고정 인수인계</button><button className="primary" onClick={() => { setError(''); setForm(fresh()); }}>＋ 인수인계 작성</button></div></section>
      <section className="stats" aria-label="인수인계 현황">
        <article><span>진행 중</span><strong>{loading ? '—' : pending.length}<small>건</small></strong><p>종료 전까지 이어가는 인수인계</p></article>
        <article><span>기간 내 고정</span><strong>{loading ? '—' : pending.filter(e => isPinned(e, day)).length}<small>건</small></strong><p>현재 적용 중인 고정 인수인계</p></article>
        <article><span>긴급 처리</span><strong className="urgent-number">{loading ? '—' : pending.filter(e => e.priority === '긴급').length}<small>건</small></strong><p>진행 중인 긴급 인수인계</p></article>
      </section>
      {error && !modalOpen && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <section className="records">
        <nav className="workflow-tabs" aria-label="인수인계 분류">{[['active', '진행 중', pending.length], ['closed', '종료 이력', entries.length - pending.length]].map(([value, label, count]) => <button key={value} aria-pressed={tab === value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setFilters(emptyFilters()); }}>{label} <span>{count}</span></button>)}</nav>
        <div className="section-heading"><h2>{tab === 'closed' ? '종료된 인수인계' : '진행 중인 인수인계'} <span>{visible.length}</span></h2><button className="text-button" disabled={loading} onClick={refresh}>↻ 새로고침</button></div>
        <div className="filters">
          <label className="search">검색<input type="search" placeholder="제목, 내용, 작성자, #해시태그 검색" value={filters.query} onChange={e => filter('query', e.target.value)} /></label>
          <label>근무일<input type="date" value={filters.date} onChange={e => filter('date', e.target.value)} /></label>
          <label>근무조<select value={filters.shift} onChange={e => filter('shift', e.target.value)}><option value="">전체 근무조</option>{['SOD', 'DOD', 'EOD'].map(s => <option key={s}>{s}</option>)}</select></label>
          <label>유형<select value={filters.kind} onChange={e => filter('kind', e.target.value)}><option value="">전체 유형</option><option>일반</option><option value="고정">고정 인수인계</option></select></label>
        </div>
        {allTags.length > 0 && <div className="tag-filters" aria-label="해시태그 필터"><button className={!filters.tag ? 'tag active' : 'tag'} aria-pressed={!filters.tag} onClick={() => filter('tag', '')}>전체 태그</button>{allTags.map(tag => <button key={tag} className={`tag ${filters.tag === tag ? 'active' : ''}`} aria-pressed={filters.tag === tag} onClick={() => filter('tag', filters.tag === tag ? '' : tag)}>#{tag}</button>)}</div>}
        {loading ? <div className="empty" role="status">기록을 불러오고 있습니다…</div> : visible.length === 0 ? <div className="empty"><span className="empty-icon">☷</span><h3>{tab === 'closed' ? '표시할 종료 이력이 없습니다' : '표시할 진행 중 인수인계가 없습니다'}</h3><p>새 기록을 작성하거나 검색 조건을 변경해 주세요.</p></div> : <div className="entry-list">{visible.map(entry => <button className={`entry ${isPinned(entry, day) ? 'pinned-entry' : ''}`} key={entry.id} onClick={() => { setSelected(entry); setError(''); }}>
          <span className="entry-date">{entry.date}<small>{entry.shift} 근무</small></span>
          <span className="entry-body"><span className={`badge priority-${entry.priority}`}>{entry.priority}</span><strong>{entry.title}</strong>{entry.kind !== '일반' && <span className="pin-period">{isPinned(entry, day) ? '⌖ 고정 중' : entry.closedAt ? '고정 인수인계' : day < entry.pinStart ? '고정 예정' : '고정 기간 만료'} · {entry.pinStart} ~ {entry.pinEnd}</span>}<span className="preview">{entry.content}</span><small>작성자 {entry.author} · 댓글 {entry.commentCount ?? 0}{entry.issues && ' · 특이사항 있음'}{entry.closedAt && ` · 종료 ${entry.closedBy} (${timestamp(entry.closedAt)})`}</small><span className="entry-tags">{entry.tags.map(tag => <span className="tag" key={tag}>#{tag}</span>)}</span></span>
          <span className={`status ${entry.closedAt ? 'done' : ''}`}>{entry.closedAt ? '✓ 종료' : '○ 진행 중'}</span><span className="arrow">›</span>
        </button>)}</div>}
      </section>
      <footer>기록으로 이어지는 안전한 교대 근무</footer>
    </main>
    {modalOpen && <dialog aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); close(); }}>
      <div className="dialog-heading"><div><p className="eyebrow">HANDOVER NOTE</p><h2 id="dialog-title">{form ? '인수인계 작성' : selected.title}</h2></div><button className="close" aria-label="닫기" disabled={busy} onClick={close}>×</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {form ? <form onSubmit={save}>
        <label>인수인계 유형<select value={form.kind} onChange={e => edit('kind', e.target.value)}><option>일반</option><option value="고정">고정 인수인계</option></select></label>
        {form.kind !== '일반' && <div className="pin-settings"><div className="period-inputs"><label>고정 시작일<input type="date" required value={form.pinStart} onChange={e => edit('pinStart', e.target.value)} /></label><label>고정 종료일<input type="date" required min={form.pinStart} value={form.pinEnd} onChange={e => edit('pinEnd', e.target.value)} /></label></div><p className="field-help">한국 시간 기준, 시작일~종료일 포함 상단 고정됩니다. 기간이 지나도 직접 종료할 때까지 진행 중에 남습니다.</p></div>}
        <div className="form-row"><label>근무일<input required type="date" value={form.date} onChange={e => edit('date', e.target.value)} /></label><label>근무조<select value={form.shift} onChange={e => edit('shift', e.target.value)}>{['SOD', 'DOD', 'EOD'].map(s => <option key={s}>{s}</option>)}</select></label><label>중요도<select value={form.priority} onChange={e => edit('priority', e.target.value)}>{['일반', '중요', '긴급'].map(s => <option key={s}>{s}</option>)}</select></label></div>
        <p className="identity-note">작성자: <strong>{user.name}</strong> · 로그인한 계정으로 기록됩니다.</p>
        <label>제목<input required maxLength={120} placeholder="핵심 내용을 한 줄로 정리해 주세요" value={form.title} onChange={e => edit('title', e.target.value)} /></label>
        <label>인수인계 내용<textarea required rows={5} maxLength={10000} placeholder="완료한 업무, 진행 중인 업무, 다음 근무자가 할 일을 적어주세요." value={form.content} onChange={e => edit('content', e.target.value)} /></label>
        <label>특이사항 <span className="optional">선택</span><textarea rows={3} maxLength={5000} placeholder="장비 이상, 주의사항 등 추가로 전달할 내용" value={form.issues} onChange={e => edit('issues', e.target.value)} /></label>
        <label>해시태그 <span className="optional">선택</span><input maxLength={330} placeholder="#장비점검 #EOD #안전" value={form.tags} onChange={e => edit('tags', e.target.value)} aria-describedby="tag-help" /></label><p id="tag-help" className="field-help">공백 또는 쉼표로 구분 · 최대 10개 · 태그당 30자 (글자, 숫자, _, -)</p>
        <div className="actions"><button type="button" disabled={busy} onClick={close}>취소</button><button className="primary" disabled={busy}>{busy ? '등록 중…' : '인수인계 등록'}</button></div>
      </form> : <div className="detail">
        <div className="detail-meta"><span className={`badge priority-${selected.priority}`}>{selected.priority}</span><span>{selected.date} · {selected.shift} 근무</span><span>작성자 {selected.author}</span></div>
        {selected.kind !== '일반' && <p className="identity-note">⌖ 고정 인수인계<br />고정 기간: {selected.pinStart} ~ {selected.pinEnd} (한국 시간)</p>}
        <div className="entry-tags detail-tags">{selected.tags.map(tag => <button className="tag" key={tag} onClick={() => { filter('tag', tag); close(); }}>#{tag}</button>)}</div>
        <h3>인수인계 내용</h3><p className="long-text">{selected.content}</p>
        {selected.issues && <div className="issues"><h3>특이사항</h3><p className="long-text">{selected.issues}</p></div>}
        <p className="created">등록 {timestamp(selected.createdAt)}</p>
        {selected.acknowledgedAt && <p className="created">기존 확인 이력: {selected.acknowledgedBy} · {timestamp(selected.acknowledgedAt)}</p>}
        <section className="comments"><h3>처리 과정 · 댓글 {selected.commentCount ?? 0}</h3>
          {detailLoading ? <p role="status">처리 이력을 불러오고 있습니다…</p> : detailError ? <p className="error" role="alert">{detailError} · 창을 닫고 다시 열어주세요.</p> : <>
            <ol className="comment-list">{(selected.comments || []).map(item => <li key={item.id}><div><strong>{item.author}</strong><time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time></div><p>{item.content}</p></li>)}</ol>
            {!selected.comments?.length && <p className="field-help">아직 댓글이 없습니다. 처리한 내용과 다음 작업을 남겨주세요.</p>}
            {!selected.closedAt && <form onSubmit={addComment}><label>처리 내용<textarea required maxLength={5000} rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="진행 상황, 조치 결과, 다음 근무자에게 전달할 내용을 작성하세요." /></label><div className="actions"><button disabled={busy || !comment.trim()}>{busy ? '처리 중…' : '댓글 등록'}</button></div></form>}
          </>}
        </section>
        {selected.closedAt ? <div className="confirmed"><strong>✓ 종료된 인수인계</strong><p>{selected.closedBy} · {timestamp(selected.closedAt)}</p><p>종료 이력과 댓글은 읽기 전용으로 보관됩니다.</p></div> : <form className="acknowledge" onSubmit={finish}><h3>인수인계 종료</h3><p>업무가 완료되면 종료해 주세요. 진행 중 목록에서 빠지고 종료 이력에 보관됩니다.</p>{comment.trim() && <p>작성 중인 댓글을 먼저 등록해 주세요.</p>}<button className="primary" disabled={busy || detailLoading || Boolean(detailError) || Boolean(comment.trim())}>{busy ? '처리 중…' : '종료 처리'}</button></form>}
      </div>}
    </dialog>}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
