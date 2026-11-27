import { del, get, set } from 'idb-keyval';
import type { Counts } from './cash';

// Offline deposits (PHASE-1.md §7.7; design system CounterServicePage 离线存款), kept on this device until uploaded.
// Each entry belongs to the teller account that took it; only that account uploads it. Uploads go in the order taken.
// No answer, a timeout or a server error (5xx) leaves the entry waiting for the next try; only an entry the server
// refuses by its rules is marked with the error code and not sent again, until the teller retries it or, once the
// teacher has settled it against the paper slip, removes it. Re-sending is safe: deposit is idempotent on id.
export type OfflineDeposit = {
  id: string; student_no: string; name: string; class: string; cash: Counts; amount: number;
  operator_id: string; operator_name: string; created_at: string; error?: string;
};

// A failure that is no answer from the server: no answer at all or in time (NETWORK, no status), a server error (5xx),
// or anything not an AppError (lib/errors.ts) with a status.
export function transient(e: unknown) {
  const { code, status } = (e ?? {}) as { code?: string; status?: number };
  return !code || code === 'NETWORK' || !status || status >= 500;
}

// How long to wait before trying again after `n` tries in a row came to nothing: 5 s, 15 s, 1 min, 5 min, then 5 min.
export const retryDelay = (n: number) => [5_000, 15_000, 60_000][n - 1] ?? 300_000;

type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };
const KEY = 'offline-deposits';

export function createQueue(store: Store) {
  const list = async () => ((await store.get(KEY)) as OfflineDeposit[] | undefined) ?? [];
  return {
    list,
    add: async (entry: OfflineDeposit) => store.set(KEY, [...(await list()), entry]),
    remove: async (id: string) => store.set(KEY, (await list()).filter((e) => e.id !== id)),
    // A refused entry back to waiting, to go with the next upload.
    retry: async (id: string) => store.set(KEY, (await list()).map(({ error, ...e }) => (e.id === id ? e : { ...e, error }))),
    // Sends this teller's unrefused entries oldest first; stops at the first failure worth trying again (`retry`).
    // Returns how many were booked.
    async upload(operatorId: string, send: (e: OfflineDeposit) => Promise<unknown>) {
      let booked = 0;
      let retry = false;
      const mine = (await list()).filter((e) => e.operator_id === operatorId && !e.error)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const entry of mine) {
        try {
          await send(entry);
          await store.set(KEY, (await list()).filter((e) => e.id !== entry.id));
          booked++;
        } catch (e) {
          if ((retry = transient(e))) break;
          await store.set(KEY, (await list()).map((x) => (x.id === entry.id ? { ...x, error: (e as { code: string }).code } : x)));
        }
      }
      return { booked, retry };
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
