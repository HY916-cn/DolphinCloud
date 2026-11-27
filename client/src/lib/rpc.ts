import { AppError } from './errors';
import { setReachable } from './online';
import { supabase } from './supabase';

// Runs `run` with an AbortSignal that fires after `ms` milliseconds: AbortSignal.timeout needs Safari 16.4, the iPads
// may be older.
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Calls to the database functions (PHASE-1.md §6). A call that gets no answer within `timeout` milliseconds, or no
// answer at all, is a NETWORK error: the counter then treats itself as offline (§7.7). Roster batches wait longer (§6.5).
export async function call<T>(fn: string, args: Record<string, unknown>, timeout = 5000): Promise<T> {
  const { data, error, status } = await withTimeout(timeout, (signal) => supabase.rpc(fn, args).abortSignal(signal));
  setReachable(!!status);
  if (!error) return data as T;
  if (!status) throw new AppError('NETWORK');
  let detail = {};
  try {
    detail = JSON.parse(error.details ?? '{}') ?? {};
  } catch {
    // details is plain text for errors that are not ours.
  }
  throw new AppError(error.message, detail, status);
}

