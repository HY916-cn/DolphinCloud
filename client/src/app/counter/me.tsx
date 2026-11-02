import { CounterPage, MeView } from '@/components';
import { useMe } from '@/lib/session';

export default function CounterMe() {
  return <CounterPage title="我的"><MeView me={useMe().data!} /></CounterPage>;
}
