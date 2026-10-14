'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
type Tone = 'success' | 'error' | 'info';
const ToastContext = createContext<{ notify(message: string, tone?: Tone): void } | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string, tone: Tone = 'success') => {
    if (timer.current) clearTimeout(timer.current); setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <ToastContext.Provider value={{ notify }}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true">
    {toast && <div className={`toast toast-${toast.tone}`}><span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div>}
  </div></ToastContext.Provider>;
}
export function useToast() { const value = useContext(ToastContext); if (!value) throw new Error('ToastProvider is required'); return value; }
