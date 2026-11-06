import { DIVISIONS, Notice, Passbook, PassbookPage, rankNext, TxnListLoading, useRanking, type Ranking } from '@/components';
import { formatAmount } from '@/lib/format';
import { useMe } from '@/lib/session';

// The places as a printed table, mine marked 我.
function Places({ rows }: { rows: Ranking['top'] }) {
  return (
    <table className="dc-pb-table">
      <colgroup><col className="is-rank" /><col /><col /><col className="is-num" /></colgroup>
      <thead><tr><th scope="col">名次</th><th scope="col">姓名</th><th scope="col">班级</th><th scope="col">余额</th></tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={row.me ? 'is-me' : undefined} aria-current={row.me || undefined}>
            <td className="is-rank">{row.rank}</td>
            <td className="is-text">{row.name}{row.me && <small>我</small>}</td>
            <td className="is-text">{row.class_label ?? `${row.cohort} 届`}</td>
            <td className="is-num">{formatAmount(row.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 排名: the division's top places by balance; facing it, my place, how many have less, what passes the place above,
// and the students right before and after me when I am below the top.
export default function BookRanking() {
  const student = useMe().data!.student!;
  const ranking = useRanking(student.student_no);
  const r = ranking.data;
  const division = DIVISIONS[student.division];

  if (ranking.error) {
    return <Passbook><PassbookPage title="存款排名"><Notice tone="danger" title="暂时无法读取排名">请检查网络后刷新页面。</Notice></PassbookPage></Passbook>;
  }
  return (
    <Passbook spread>
      <PassbookPage title={`${division}存款榜`}>
        {!r ? <TxnListLoading label="正在加载排名" /> : r.top.length ? <Places rows={r.top} /> : (
          <p className="dc-pb-empty"><b>本学部还没有排名</b>同学们在柜台存款后，这里会按余额排出名次。</p>
        )}
      </PassbookPage>
      <PassbookPage title="我的名次" foot={r ? `${division}在读 ${r.total} 人` : undefined}>
        {!r ? null : r.me ? <>
          <dl className="dc-pb-fields">
            <dt>名次</dt><dd className="is-total">第 {r.me.rank} 名</dd>
            <dt>余额</dt><dd>{formatAmount(r.me.balance)}<small>HTB</small></dd>
            <dt>超过</dt><dd>{division} {r.me.behind} 位同学</dd>
          </dl>
          <p className="dc-pb-note">{rankNext(r)}</p>
          {!r.top.some((t) => t.me) && <Places rows={r.me.near} />}
        </> : <p className="dc-pb-empty"><b>账户暂不参加排名</b>账户状态正常后，会按余额参加本学部排名。</p>}
      </PassbookPage>
    </Passbook>
  );
}
