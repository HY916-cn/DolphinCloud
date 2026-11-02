import { Page, MeScreen } from '@/components';

export default function StudentMe() {
  return <MeScreen frame={(title, back, body) => <Page title={title} back={back}>{body}</Page>} />;
}
