'use client';

/**
 * The single place every screen's toasts converge.
 *
 * `doc/decision/0055-toast-and-tooltip-are-presentational.md` kept the design
 * system's `Toast`/`ToastRegion` free of an imperative queue and left the
 * queue itself to the app once call sites started repeating — which they
 * did, across six files. This is that queue: one `AppToastRegion`, mounted
 * once in `(app)/layout.tsx`, fed by `useNotify` calls from anywhere in the
 * tree below it.
 *
 * `useNotify` is declarative on purpose, matching what every call site it
 * replaces already did: a toast is visible for exactly as long as the
 * driving state (an error message, a "saved" flag turned into text) is
 * non-null. There is no auto-dismiss timer — introducing one would be a UX
 * change nothing asked for.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Toast, type ToastTone } from '@garage/design-system/primitives';
import { AppToastRegion } from './toast-region';

interface ToastEntry {
  readonly id: string;
  readonly tone: ToastTone;
  readonly message: string;
}

interface ToastContextValue {
  readonly publish: (id: string, tone: ToastTone, message: string) => void;
  readonly retract: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  readonly children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);

  const publish = useCallback((id: string, tone: ToastTone, message: string) => {
    setToasts((current) => [...current.filter((entry) => entry.id !== id), { id, tone, message }]);
  }, []);

  const retract = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ publish, retract }), [publish, retract]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <AppToastRegion>
        {toasts.map((entry) => (
          <Toast key={entry.id} tone={entry.tone}>
            {entry.message}
          </Toast>
        ))}
      </AppToastRegion>
    </ToastContext.Provider>
  );
}

/**
 * Publishes `message` under `tone` while it is non-null, retracts it when it
 * becomes `null` or the calling component unmounts. Each call site gets its
 * own stable identity via `useId()` — call this once per distinct toast a
 * component can show (a component driving two independent toasts, e.g. one
 * error and one success, calls it twice).
 */
export function useNotify(message: string | null, tone: ToastTone): void {
  const context = useContext(ToastContext);
  const id = useId();

  if (context === null) {
    throw new Error('useNotify must be used within a ToastProvider');
  }

  const { publish, retract } = context;

  useEffect(() => {
    if (message === null) {
      retract(id);
      return;
    }
    publish(id, tone, message);
    return () => retract(id);
  }, [id, message, tone, publish, retract]);
}
