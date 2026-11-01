// In-app dialogs and toasts, one implementation for web and native.
//
// Imperative on purpose: business code does `if (await confirm({...})) write()`
// with no component state, exactly like the window.confirm / Alert.alert calls
// this replaces. <DialogHost /> (mounted once in the root layout) renders the
// current request; the store just holds the queue and resolves promises.

export type Consequence = { label: string; before?: string; after?: string };

export type ConfirmOptions = {
  title: string;
  message?: string;
  // One line of context under the title, e.g. "34.50 DH · 14:09 · Salma".
  summary?: string;
  // What will change, before and after (STOCK-IN-DESIGN 2.1.1).
  consequences?: Consequence[];
  confirmLabel?: string;
  cancelLabel?: string;
  // "danger": red confirm button, and a tap outside does NOT dismiss it.
  tone?: "default" | "danger";
};

export type ConfirmRequest = ConfirmOptions & { id: number };

export type ToastOptions = {
  text: string;
  tone?: "success" | "info";
  action?: { label: string; onPress: () => void };
  // Milliseconds; 5000 by default.
  duration?: number;
};

export type ToastState = ToastOptions & { id: number };

type State = { confirm: ConfirmRequest | null; toast: ToastState | null };

let state: State = { confirm: null, toast: null };
const listeners = new Set<() => void>();
const queue: { request: ConfirmRequest; resolve: (value: boolean) => void }[] = [];
let active: { id: number; resolve: (value: boolean) => void } | null = null;
let hosts = 0;
let nextId = 1;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): State {
  return state;
}

// <DialogHost /> calls this on mount. Without a host nothing can be shown, and
// a confirm() that waited forever would freeze the caller.
export function registerHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts === 0) {
      // Host gone: answer "no" to everything pending, so nothing is written.
      active?.resolve(false);
      active = null;
      queue.splice(0).forEach((q) => q.resolve(false));
      emit({ confirm: null });
    }
  };
}

function showNext() {
  if (active || queue.length === 0) return;
  const next = queue.shift()!;
  active = { id: next.request.id, resolve: next.resolve };
  emit({ confirm: next.request });
}

// Resolves true when the person confirms, false on cancel, back button, or if
// no host is mounted. Never rejects, so `if (await confirm())` is always safe.
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (hosts === 0) {
    // eslint-disable-next-line no-console
    console.warn("confirm() called with no <DialogHost /> mounted; answering no.");
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    queue.push({ request: { ...options, id: nextId++ }, resolve });
    showNext();
  });
}

export function resolveConfirm(id: number, value: boolean) {
  if (!active || active.id !== id) return;
  const { resolve } = active;
  active = null;
  emit({ confirm: null });
  resolve(value);
  showNext();
}

// One toast at a time: a new one replaces the old.
export function showToast(options: ToastOptions) {
  if (toastTimer) clearTimeout(toastTimer);
  const toast = { ...options, id: nextId++ };
  emit({ toast });
  toastTimer = setTimeout(() => dismissToast(toast.id), options.duration ?? 5000);
}

export function dismissToast(id?: number) {
  if (id !== undefined && state.toast?.id !== id) return;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  emit({ toast: null });
}

// For tests only.
export function __resetForTests() {
  queue.splice(0);
  active = null;
  hosts = 0;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  state = { confirm: null, toast: null };
  listeners.clear();
}
