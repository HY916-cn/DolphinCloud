import { useState } from 'react';
import { CounterPage, NeedsNetwork, ResultView, ReversalPanel, type Served } from '@/components';
import { useOnline } from '@/lib/online';

// 冲正 (PHASE-1.md §6.3, §7.5): all of today's own businesses, searched by transaction or student number, for when
// the student is not at the counter. With the student there, the 办理 page's 冲正 tab does the same.
export default function Reversal() {
  const online = useOnline();
  const [done, setDone] = useState<Served | null>(null);
  const [round, setRound] = useState(0);

  if (done) {
    return (
      <CounterPage title="冲正">
        <ResultView title="冲正成功" next="返回列表" lead={done.lead} rows={[['冲正交易号', done.txnNo]]}
          onNext={() => { setDone(null); setRound((r) => r + 1); }} />
      </CounterPage>
    );
  }
  return (
    <CounterPage title="冲正">
      {online ? <ReversalPanel key={round} onDone={setDone} /> : <NeedsNetwork business="冲正" />}
    </CounterPage>
  );
}
