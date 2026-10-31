import type { StoredData } from '../shared/model';
export async function read<K extends keyof StoredData>(key: K): Promise<StoredData[K] | null> {
  try {
    const raw = (await chrome.storage.local.get(key))?.[key];
    if (raw === undefined || raw === null) {
      if (key === 'archived_tabs') return [] as unknown as StoredData[K];
      return null;
    }
    if (key === 'archived_tabs') {
      return (Array.isArray(raw) ? raw : []) as unknown as StoredData[K];
    }
    return raw as StoredData[K];
  } catch {
    if (key === 'archived_tabs') return [] as unknown as StoredData[K];
    return null;
  }
}
export async function write<K extends keyof StoredData>(
  key: K,
  value: StoredData[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
// These are separate queues, as in the release. Do not turn them into a global transaction.
export function queue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task);
    tail = next.catch(() => {});
    return next;
  };
}
export function batch<T>(delay: number, consume: (values: T[]) => Promise<void>) {
  const pending = new Set<T>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let promise: Promise<void> | null = null,
    resolve: (() => void) | null = null,
    reject: ((e: unknown) => void) | null = null;
  const reset = () => {
    promise = null;
    resolve = null;
    reject = null;
  };
  const schedule = (): Promise<void> => {
    promise ??= new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const values = [...pending];
      pending.clear();
      try {
        if (values.length) {
          try {
            await consume(values);
          } catch (e) {
            values.forEach((v) => pending.add(v));
            throw e;
          }
        }
        if (pending.size) {
          schedule();
          return;
        }
        resolve?.();
      } catch (e) {
        reject?.(e);
        reset();
      } finally {
        if (!pending.size) reset();
      }
    }, delay);
    return promise;
  };
  return {
    enqueue(value: T) {
      pending.add(value);
      return schedule();
    },
  };
}
