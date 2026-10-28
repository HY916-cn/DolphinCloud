import { del, get, set } from 'idb-keyval';
import type { Counts } from './cash';

// Offline deposits (PHASE-1.md §7.7), kept on this device until uploaded. Each entry belongs to the teller account
// that took it; only that account uploads it. Uploads go in the order taken; a rejected entry stays, marked with
// the error code, for the teacher to settle against the paper slip. Re-sending is safe: deposit is idempotent on id.
export type OfflineDeposit = {
  id: string; student_no: string; name: string; class: string; cash: Counts; amount: number;
  operator_id: string; operator_name: string; created_at: string; error?: string;
};

type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };
const KEY = 'offline-deposits';

export function createQueue(store: Store) {
  const list = async () => ((await store.get(KEY)) as OfflineDeposit[] | undefined) ?? [];
  return {
    list,
    add: async (entry: OfflineDeposit) => store.set(KEY, [...(await list()), entry]),
    // Sends this teller's entries oldest first; stops at the first network failure. Returns how many were booked.
    async upload(operatorId: string, send: (e: OfflineDeposit) => Promise<unknown>) {
      let booked = 0;
      const mine = (await list()).filter((e) => e.operator_id === operatorId).sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const entry of mine) {
        try {
          await send(entry);
          await store.set(KEY, (await list()).filter((e) => e.id !== entry.id));
          booked++;
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'UNKNOWN'; // AppError (lib/errors.ts)
          if (code === 'NETWORK') break;
          await store.set(KEY, (await list()).map((x) => (x.id === entry.id ? { ...x, error: code } : x)));
        }
      }
      return booked;
    },
  };
}

export const offlineQueue = createQueue({ get, set });

// The roster a teller account last read, so names and classes can be checked while offline. Removed when that
// account signs out on this device.
export type RosterEntry = { student_no: string; name: string; class_label: string | null; class_no: number; status: string };
export const saveRoster = (accountId: string, rows: RosterEntry[]) => set(`roster:${accountId}`, rows);
export const cachedRoster = async (accountId: string) => ((await get(`roster:${accountId}`)) as RosterEntry[] | undefined) ?? [];
export const dropRoster = (accountId: string) => del(`roster:${accountId}`);
