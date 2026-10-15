'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/use-translation';
import type { PlainTranslationKey } from '@/i18n/types';
type Tone = 'success' | 'error' | 'info';
const ToastContext = createContext<{ notify(key: PlainTranslationKey, tone?: Tone): void } | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toast, setToast] = useState<{ key: PlainTranslationKey; tone: Tone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((key: PlainTranslationKey, tone: Tone = 'success') => {
    if (timer.current) clearTimeout(timer.current); setToast({ key, tone });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <ToastContext.Provider value={{ notify }}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true">
    {toast && <div className={`toast toast-${toast.tone}`}><span>{t(toast.key)}</span><button type="button" aria-label={t('common.dismissNotification')} onClick={() => setToast(null)}>×</button></div>}
  </div></ToastContext.Provider>;
}
export function useToast() { const value = useContext(ToastContext); if (!value) throw new Error('ToastProvider is required'); return value; }
