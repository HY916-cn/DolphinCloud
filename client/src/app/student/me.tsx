import { Page, MeView } from '@/components';
import { useMe } from '@/lib/session';

export default function StudentMe() {
  return <Page title="我的"><MeView me={useMe().data!} /></Page>;
}
