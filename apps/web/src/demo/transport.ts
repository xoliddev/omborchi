import { ApiError, type Transport } from '../lib/api';
import type { DemoUser, InitResult } from './worker';

export type { DemoUser, InitResult };

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

const USER_KEY = 'omb.demoUser';

export class DemoBackend implements Transport {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private progressListeners = new Set<(fraction: number, label: string) => void>();
  userId: string | null;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'omborchi-demo' });
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') {
        this.progressListeners.forEach((l) => l(m.fraction, m.label));
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new ApiError(m.error.code, m.error.message, m.error.status, m.error.details));
    };
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(USER_KEY);
    } catch {
      /* private mode */
    }
    this.userId = stored;
  }

  private send<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  onProgress(fn: (fraction: number, label: string) => void) {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  init() {
    return this.send<InitResult>({ type: 'init' });
  }

  reset() {
    return this.send<InitResult>({ type: 'reset' });
  }

  setUser(userId: string | null) {
    this.userId = userId;
    try {
      if (userId) localStorage.setItem(USER_KEY, userId);
      else localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  }

  call(name: string, input: unknown) {
    return this.send({ type: 'call', name, input, userId: this.userId });
  }
}
