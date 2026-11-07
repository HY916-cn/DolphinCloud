import type { IconName } from '@/theme/icons';
import type { AccountRole } from '@/lib/session';
import { Icon } from './ui';

const ICON: Record<NonNullable<AccountRole>, IconName> = {
  student: 'student', teller: 'teller', accountant: 'accountant', storekeeper: 'storekeeper', president: 'president', teacher: 'teacher', sysadmin: 'sysadmin',
};

// Avatar (design system Avatar): the account's identity as a large icon in a circle; null is a login with no identity
// yet (?), and leaving `role` out draws a plain person, for an account whose identity this device does not know. `lg`
// is the PersonCard size. The identity is always written beside it, so it is decoration.
export function Avatar({ role, lg, className = '' }: { role?: AccountRole; lg?: boolean; className?: string }) {
  return (
    <span className={`dc-avatar ${lg ? 'is-lg' : ''} ${className}`} aria-hidden="true">
      <Icon name={role === undefined ? 'person' : role ? ICON[role] : 'help'} />
    </span>
  );
}
