import { CounterPage, MeScreen } from '@/components';

export default function CounterMe() {
  return <MeScreen frame={(title, back, body) => <CounterPage title={title} onBack={back}>{body}</CounterPage>} />;
}
