export type SaveStatus = 'pending' | 'saving' | 'saved' | 'error';
export interface AutoSaveOptions<T extends object> {
  delay?: number;
  onStatus?(status: SaveStatus): void;
  onError?(error: unknown): void;
  merge?(previous: T, next: T): T;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function merge<T extends object>(previous: T, next: T): T {
  const result = new Map(Object.entries(previous));
  for (const [key, value] of Object.entries(next)) {
    const before = result.get(key);
    result.set(key, object(before) && object(value) ? merge(before, value) : structuredClone(value));
  }
  return Object.fromEntries(result) as T;
}

/** Coalesce field patches and serialize writes so an older request cannot overwrite a newer edit. */
export function createAutoSave<T extends object>(write: (value: T) => Promise<unknown>, options: AutoSaveOptions<T> = {}) {
  let pending: T | null = null, running: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const combine = options.merge ?? merge<T>;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  async function flush(): Promise<void> {
    clear();
    if (running) { await running; if (pending) await flush(); return; }
    if (!pending) return;
    const value = pending; pending = null;
    options.onStatus?.('saving');
    running = (async () => write(value))();
    try { await running; }
    catch (error) {
      clear(); pending = pending ? combine(value, pending) : value;
      options.onStatus?.('error'); options.onError?.(error); throw error;
    } finally { running = null; }
    if (!pending) options.onStatus?.('saved');
    else if (timer === undefined) await flush();
    else options.onStatus?.('pending');
  }
  function update(value: T, immediate = false): void {
    pending = pending ? combine(pending, value) : structuredClone(value);
    clear(); options.onStatus?.('pending');
    if (immediate) void flush().catch(() => {});
    else timer = setTimeout(() => { timer = undefined; void flush().catch(() => {}); }, options.delay ?? 300);
  }
  return { update, flush };
}
