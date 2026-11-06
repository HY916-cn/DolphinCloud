import type { IconName } from '@/theme/icons';
import type { AccountRole } from '@/lib/session';
import { Icon } from './ui';

const BADGE: Record<NonNullable<AccountRole>, IconName> = {
  student: 'student', teller: 'teller', accountant: 'accountant', storekeeper: 'storekeeper', president: 'president', teacher: 'teacher', sysadmin: 'sysadmin',
};

// Avatar (design system Avatar): the round person, and in its corner the badge of the account's identity; null is a
// login with no identity yet (?), and leaving `role` out draws the person alone, for an account whose identity this
// device does not know. `lg` is the PersonCard size. The identity is always written beside it, so it is decoration.
export function Avatar({ role, lg, className = '' }: { role?: AccountRole; lg?: boolean; className?: string }) {
  return (
    <span className={`dc-avatar ${lg ? 'is-lg' : ''} ${className}`} aria-hidden="true">
      <span className="dc-avatar-face"><Icon name="person" /></span>
      {role !== undefined && <span className="dc-avatar-badge"><Icon name={role ? BADGE[role] : 'help'} /></span>}
    </span>
  );
}
