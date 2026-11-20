import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Icon, Notice, Toast } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { codeDigits, formatSize, MAX_FILE, tooLarge } from '@/lib/public';
import { call } from '@/lib/rpc';

type Status = 'ready' | 'uploading' | 'done' | 'failed';
type Item = { key: number; file: File; status: Status; progress: number };
type Problem = { title: string; text: string };
type Pickup = { id: string; code: string; expires_at: string; files: { seq: number; name: string; size: number; url?: string }[] };

const failure = (e: unknown, side: 'send' | 'receive') =>
  explain(e instanceof AppError ? e.code : '', { ...(e instanceof AppError ? e.detail : {}), transfer: side });
const due = (iso: string) => `${formatTime(iso)} 到期`;
// Runs `then` at the moment `iso` (RATE_LIMITED's retry_at).
const at = (iso: unknown, then: () => void) => setTimeout(then, Math.max(0, Date.parse(String(iso)) - Date.now()));

// PUT one file to its signed upload address (PHASE-2.md §15 文件传输的调用流程), reporting progress; true when stored.
function put(item: Item, url: string, progress: (p: number) => void) {
  return new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', location.origin + url);
    xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && progress(Math.floor((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(item.file);
  });
}

// 文件传输 (/transfer, design system FileTransfer): send files for a 4-digit pickup code, or take them with one; no
// sign-in. ?code= opens 接收 with the code and takes it at once.
export default function Transfer() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [tab, setTab] = useState<'send' | 'receive'>(params.code ? 'receive' : 'send');
  return (
    <div className="dc-app">
      <header className="dc-top">
        <button className="dc-icon-btn" type="button" aria-label="返回登录" onClick={() => router.replace('/login')}><Icon name="back" /></button>
        <h1 className="dc-top-title title">文件传输<span className="dc-top-sub">文件保留 7 天</span></h1>
      </header>
      <main className="dc-content">
        <div className="dc-tabs" role="tablist" aria-label="文件传输">
          {(['send', 'receive'] as const).map((k) => (
            <button key={k} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>
              {k === 'send' ? '发送' : '接收'}
            </button>
          ))}
        </div>
        {/* Both stay mounted, so switching tabs keeps a send under way and the files taken. */}
        <div role="tabpanel" aria-label="发送" hidden={tab !== 'send'}><div className="dc-stack"><Send /></div></div>
        <div role="tabpanel" aria-label="接收" hidden={tab !== 'receive'}><div className="dc-stack"><Receive initial={codeDigits(params.code ?? '')} /></div></div>
      </main>
    </div>
  );
}

function Send() {
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [toast, setToast] = useState(false);
  // The send create_transfer opened: its id and each file's upload address, by the item's key.
  const [sending, setSending] = useState<{ id: string; urls: Map<number, string> } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const touch = matchMedia('(pointer: coarse)').matches;

  // Leaving while uploading asks first; the files sent so far get no code.
  useEffect(() => {
    if (!busy) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', ask);
    return () => removeEventListener('beforeunload', ask);
  }, [busy]);

  const files = items.map((i) => ({ name: i.file.name, size: i.file.size }));
  const limit = tooLarge(files);
  const total = files.reduce((s, f) => s + f.size, 0);
  const failed = items.some((i) => i.status === 'failed');
  const locked = busy || !!sending;
  const set = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  function add(list: FileList | null) {
    if (!list || locked) return;
    setProblem(null);
    setItems((now) => [...now, ...[...list].map((file) => ({ key: nextKey.current++, file, status: 'ready' as const, progress: 0 }))]);
  }

  async function upload() {
    if (busy || limit) return;
    setBusy(true);
    setProblem(null);
    try {
      let s = sending;
      if (!s) {
        const t = await call<{ id: string; files: { seq: number; url: string }[] }>('create_transfer', { p_files: files });
        setSending(s = { id: t.id, urls: new Map(items.map((i, n) => [i.key, t.files.find((f) => f.seq === n + 1)!.url])) });
      }
      const urls = s.urls;
      const todo = items.filter((i) => i.status !== 'done');
      const results = await Promise.all(todo.map(async (i) => {
        set(i.key, { status: 'uploading', progress: 0 });
        const ok = await put(i, urls.get(i.key)!, (p) => set(i.key, { progress: p }));
        set(i.key, ok ? { status: 'done', progress: 100 } : { status: 'failed' });
        return ok;
      }));
      if (results.includes(false)) return setProblem(explain('TRANSFER_INCOMPLETE'));
      setPickup(await call<Pickup>('finish_transfer', { p_id: s.id }));
    } catch (e) {
      if (e instanceof AppError && e.code === 'TRANSFER_INCOMPLETE') {
        const missing = (e.detail.missing ?? []) as number[];
        setItems((list) => list.map((i, n) => (missing.includes(n + 1) ? { ...i, status: 'failed' } : i)));
      }
      // The send expired (2 hours): start a new one with the same files.
      if (e instanceof AppError && e.code === 'TRANSFER_NOT_FOUND') {
        setSending(null);
        setItems((list) => list.map((i) => ({ ...i, status: 'ready', progress: 0 })));
      }
      if (e instanceof AppError && e.code === 'RATE_LIMITED') {
        setBlocked(true);
        at(e.detail.retry_at, () => setBlocked(false));
      }
      setProblem(failure(e, 'send'));
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setSending(null);
    setItems([]);
    setPickup(null);
    setProblem(null);
  }

  if (pickup) {
    return (
      <section className="dc-card dc-pickup dc-enter">
        <h2 className="heading">取件码</h2>
        <p className="dc-pickup-code" aria-label={`取件码 ${pickup.code}`}>{[...pickup.code].map((c, i) => <span key={i}>{c}</span>)}</p>
        <p className="dc-pickup-due">{due(pickup.expires_at)}</p>
        <div className="dc-pickup-actions">
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button"
            onClick={() => navigator.clipboard.writeText(pickup.code).then(() => setToast(true), () => {})}>复制取件码</button>
          <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={again}>再发一批</button>
        </div>
        {toast && <Toast text="已复制" onDone={() => setToast(false)} />}
      </section>
    );
  }

  const shown = problem ?? (limit && explain('FILE_TOO_LARGE', limit));
  const [amount, unit] = formatSize(total).split(' ');
  return (
    <>
      {shown && <Notice tone="danger" title={shown.title}>{shown.text}</Notice>}
      <div className={`dc-drop ${over ? 'is-over' : ''}`}
        onDragOver={(e: DragEvent) => { e.preventDefault(); if (!locked) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <Icon name="upload" />
        <p>{touch ? '选择要发送的文件' : '把文件拖到这里'}</p>
        <button className="dc-btn dc-btn-secondary" type="button" disabled={locked} onClick={() => picker.current?.click()}>选择文件</button>
        <small>至多 20 个，每个 100 MB 以内，合计 200 MB 以内</small>
        <input ref={picker} type="file" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {items.length > 0 && (
        <ul className="dc-list" aria-label="要发送的文件">
          {items.map((i) => {
            const size = formatSize(i.file.size);
            return (
              <li key={i.key}>
                <div className="dc-list-item">
                  <span className="dc-list-icon"><Icon name="file" /></span>
                  <span>
                    <span className="dc-file-name">{i.file.name}</span>
                    <small>{i.status === 'uploading' ? `${size} · ${i.progress}%` : i.status === 'failed' ? `${size} · 没有传完` : size}</small>
                    {(i.status === 'uploading' || i.status === 'failed') && (
                      <div className="dc-progress-track" role="progressbar" aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100}
                        aria-label={`${i.file.name} 的上传进度`}>
                        <div className="dc-progress-fill" style={{ '--value': i.progress / 100 } as React.CSSProperties} />
                      </div>
                    )}
                  </span>
                  {i.status === 'done' && <span className="dc-tag dc-tag-success"><Icon name="check" />已上传</span>}
                  {i.status === 'failed' && !busy && (
                    <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={upload}><Icon name="retry" />重试</button>
                  )}
                  {i.status === 'ready' && i.file.size > MAX_FILE && <span className="dc-tag dc-tag-danger"><Icon name="warning" />超过 100 MB</span>}
                  {i.status === 'ready' && !locked && (
                    <button className="dc-icon-btn" type="button" aria-label={`移除 ${i.file.name}`}
                      onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}><Icon name="close" /></button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* The total: here on tablets and computers, in the ActionBar on phones. */}
      {items.length > 0 && <p className="dc-caption dc-hide-phone">{items.length} 个文件，合计 {formatSize(total)}</p>}
      <div className="dc-actions">
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button"
          disabled={!items.length || !!limit || busy || blocked} onClick={upload}>
          <Icon name="upload" />{busy ? '正在上传' : failed ? '重试未传完的' : `上传 ${items.length} 个文件`}
        </button>
        {items.length > 0 && <div className="dc-actions-total"><span>合计</span><b>{amount}<small>{unit}</small></b></div>}
      </div>
    </>
  );
}

function Receive({ initial }: { initial: string }) {
  const [digits, setDigits] = useState(() => [...initial.padEnd(4, ' ')].map((c) => c.trim()));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<(Problem & { n: number }) | null>(null);
  const [locked, setLocked] = useState(false);
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const code = digits.join('');

  async function take(c = code) {
    if (busy || c.length !== 4) return;
    setBusy(true);
    try {
      setPickup(await call<Pickup>('open_transfer', { p_code: c }));
      setProblem(null);
    } catch (e) {
      setPickup(null);
      setProblem({ ...failure(e, 'receive'), n: (problem?.n ?? 0) + 1 });
      setDigits(['', '', '', '']);
      if (e instanceof AppError && e.code === 'RATE_LIMITED') {
        setLocked(true);
        at(e.detail.retry_at, () => setLocked(false));
      }
    } finally {
      setBusy(false);
    }
  }
  // After a refusal the boxes are drawn anew (the shake replays): focus goes back to the first.
  const refused = problem?.n;
  useEffect(() => { if (refused) boxes.current[0]?.focus(); }, [refused]);
  // ?code=: take it at once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the code in the address is taken once, on opening
    if (initial.length === 4) take(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A digit moves to the next box; pasting 4 digits fills them all.
  function type(at: number, text: string) {
    const typed = codeDigits(text);
    const next = [...digits];
    if (typed.length > 1) [...typed].forEach((d, i) => { if (at + i < 4) next[at + i] = d; });
    else next[at] = typed;
    setDigits(next);
    if (typed) boxes.current[Math.min(3, at + typed.length)]?.focus();
  }
  function back(at: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[at] && at > 0) boxes.current[at - 1]?.focus();
    if (e.key === 'Enter') take();
  }

  // A pickup that expired after it was taken says so instead of downloading.
  function download(e: React.MouseEvent) {
    if (pickup && Date.parse(pickup.expires_at) <= Date.now()) {
      e.preventDefault();
      setPickup(null);
      setProblem({ ...explain('TRANSFER_NOT_FOUND', { transfer: 'receive' }), n: (problem?.n ?? 0) + 1 });
    }
  }

  return (
    <>
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      <section className="dc-card dc-stack">
        <fieldset key={problem?.n} className={`dc-code ${problem ? 'is-error' : ''}`} aria-label="取件码" disabled={locked}>
          {digits.map((d, i) => (
            <input key={i} ref={(el) => { boxes.current[i] = el; }} inputMode="numeric" maxLength={i === 0 ? 4 : 1} value={d}
              aria-label={`取件码第 ${i + 1} 位`} autoComplete={i === 0 ? 'one-time-code' : 'off'}
              onChange={(e) => type(i, e.target.value)} onPaste={(e) => { e.preventDefault(); type(i, e.clipboardData.getData('text')); }}
              onKeyDown={(e) => back(i, e)} onFocus={(e) => e.target.select()} />
          ))}
        </fieldset>
        <button className={`dc-btn dc-btn-primary dc-btn-block ${busy ? 'is-loading' : ''}`} type="button"
          disabled={code.length !== 4 || busy || locked} onClick={() => take()}>取件</button>
      </section>
      {pickup && (
        <>
          <p className="dc-pickup-due">{due(pickup.expires_at)}</p>
          <ul className="dc-list" aria-label="文件">
            {pickup.files.map((f) => (
              <li key={f.seq}>
                <div className="dc-list-item">
                  <span className="dc-list-icon"><Icon name="file" /></span>
                  <span><span className="dc-file-name">{f.name}</span><small>{formatSize(f.size)}</small></span>
                  <a className="dc-btn dc-btn-secondary dc-btn-sm" href={location.origin + f.url} download={f.name}
                    aria-label={`下载 ${f.name}`} onClick={download}><Icon name="download" />下载</a>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
