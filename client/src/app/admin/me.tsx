import { Desk, MeScreen } from '@/components';

export default function AdminMe() {
  return <MeScreen frame={(title, back, body) => <Desk title={title} back={back}>{body}</Desk>} />;
}
