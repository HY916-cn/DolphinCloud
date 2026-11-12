import { BookPages, DIVISIONS, Notice, PassbookPage, rankNext, TxnListLoading, useRanking, type Ranking } from '@/components';
import { formatNet } from '@/lib/format';
import { useMe } from '@/lib/session';

// A page of places takes as many as the 存折's lines; the ranking can be set longer than one page.
const PLACES = 10;

// The places as a printed table, mine marked 我; `lines` rules empty lines up to that many, as on a printed form.
function Places({ rows, lines = 0 }: { rows: Ranking['top']; lines?: number }) {
  return (
    <table className="dc-pb-table">
      <colgroup><col className="is-rank" /><col /><col /><col className="is-num" /></colgroup>
      <thead><tr><th scope="col">名次</th><th scope="col">姓名</th><th scope="col">班级</th><th scope="col">存款</th></tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={row.me ? 'is-me' : undefined} aria-current={row.me || undefined}>
            <td className="is-rank">{row.rank}</td>
            <td className="is-text">{row.name}{row.me && <small>我</small>}</td>
            <td className="is-text">{row.class_label ?? `${row.cohort} 届`}</td>
            <td className="is-num">{formatNet(row.balance)}</td>
          </tr>
        ))}
        {Array.from({ length: Math.max(0, lines - rows.length) }, (_, i) => (
          <tr key={`blank-${i}`} aria-hidden="true"><td /><td /><td /><td /></tr>
        ))}
      </tbody>
    </table>
  );
}

// 排名: the division's top places by balance, a page of ten at a time; facing the first (on a phone, the next page), my
// place, how many have less, what passes the place above, and the students right before and after me when I am below
// the top.
export default function BookRanking() {
  const student = useMe().data!.student!;
  const ranking = useRanking(student.student_no);
  const r = ranking.data;
  const division = DIVISIONS[student.division];

  if (ranking.error) {
    return <BookPages pages={[<PassbookPage key="error" title="存款排名"><Notice tone="danger" title="暂时无法读取排名">请检查网络后刷新页面。</Notice></PassbookPage>]} />;
  }
  const board = (rows: Ranking['top'], k: number) => (
    <PassbookPage key={`board-${k}`} title={`${division}存款榜`} side={k ? <small>续页</small> : undefined}>
      {!r ? <TxnListLoading label="正在加载排名" /> : rows.length ? <Places rows={rows} lines={PLACES} /> : (
        <p className="dc-pb-empty"><b>本学部还没有排名</b>同学们在柜台存款后，这里会按存款排出名次。</p>
      )}
    </PassbookPage>
  );
  const boards = Array.from({ length: Math.max(1, Math.ceil((r?.top.length ?? 0) / PLACES)) }, (_, k) => board(r?.top.slice(k * PLACES, (k + 1) * PLACES) ?? [], k));
  return (
    <BookPages pages={[
      boards[0],
      <PassbookPage key="mine" title="我的名次" side={r && <small>{division}在读 {r.total} 人</small>}>
        {!r ? null : r.me ? <>
          <dl className="dc-pb-fields">
            <dt>名次</dt><dd className="is-total">第 {r.me.rank} 名</dd>
            <dt>存款</dt><dd>{formatNet(r.me.balance)}<small>HTB</small></dd>
            <dt>超过</dt><dd>{division} {r.me.behind} 位同学</dd>
          </dl>
          <p className="dc-pb-note">{rankNext(r)}</p>
          {!r.top.some((t) => t.me) && <Places rows={r.me.near} />}
        </> : <p className="dc-pb-empty"><b>账户暂不参加排名</b>账户状态正常后，会按存款参加本学部排名。</p>}
        <ol className="dc-pb-rules" aria-label="排名说明">
          <li>按存款从多到少排名，只和本学部的同学比。</li>
          <li>存款相同的同学名次相同。</li>
          {r?.anonymous && <li>榜上同学的名字隐去一个字。</li>}
        </ol>
      </PassbookPage>,
      ...boards.slice(1),
    ]} />
  );
}
