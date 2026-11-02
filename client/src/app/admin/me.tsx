import { Desk, MeView } from '@/components';
import { useMe } from '@/lib/session';

export default function AdminMe() {
  return <Desk title="我的"><MeView me={useMe().data!} /></Desk>;
}
