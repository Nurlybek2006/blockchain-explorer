import type { ContractVerificationStatus, NetworkStatusResponse, TransactionTraceResponse, TransactionTraceStatus } from '@blockchain-explorer/contracts/browser';
import type { ConnectionState } from '@/lib/realtime/realtime-client';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import type { Locale, TranslationKey } from '@/i18n/types';

type Display = { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' };

export function connectionDisplay(state: ConnectionState, locale: Locale = DEFAULT_LOCALE): Display {
  const t = createTranslator(locale);
  return state === 'live' ? { label: t('realtime.connection.live'), tone: 'success' }
    : state === 'offline' ? { label: t('realtime.connection.offline'), tone: 'warning' }
      : state === 'unconfigured' ? { label: t('realtime.connection.unavailable'), tone: 'neutral' }
        : { label: t(state === 'connecting' ? 'realtime.connection.connecting' : 'realtime.connection.reconnecting'), tone: 'warning' };
}

export function verificationDisplay(status: ContractVerificationStatus, locale: Locale = DEFAULT_LOCALE): Display {
  const t = createTranslator(locale);
  switch (status) {
    case 'verified': return { label: t('realtime.verification.verified'), tone: 'success' };
    case 'pending': return { label: t('realtime.verification.pending'), tone: 'warning' };
    case 'unsupported': return { label: t('realtime.verification.unsupported'), tone: 'neutral' };
    case 'failed': return { label: t('realtime.verification.failed'), tone: 'danger' };
    default: return { label: t('realtime.verification.unverified'), tone: 'neutral' };
  }
}

export function traceMessage(reason: TransactionTraceResponse['reason'], locale: Locale = DEFAULT_LOCALE): string {
  const t = createTranslator(locale);
  switch (reason) {
    case 'not-supported': return t('realtime.trace.unsupported');
    case 'not-indexed': return t('realtime.trace.notIndexed');
    case 'pending': return t('realtime.trace.pending');
    case 'failed': return t('realtime.trace.failed');
    case 'not-requested': return t('realtime.trace.notRequested');
    default: return t('realtime.trace.empty');
  }
}

const traceStatusKeys = {
  not_requested: 'explorer.trace.statusNotRequested', queued: 'explorer.trace.statusQueued', processing: 'explorer.trace.statusProcessing', completed: 'explorer.trace.statusCompleted', unsupported: 'explorer.trace.statusUnsupported', failed: 'explorer.trace.statusFailed',
} as const satisfies Record<TransactionTraceStatus, TranslationKey>;

export function traceStatusLabel(status: TransactionTraceStatus, locale: Locale = DEFAULT_LOCALE): string { return createTranslator(locale)(traceStatusKeys[status]); }

export function networkDisplay(status: NetworkStatusResponse['status'], locale: Locale = DEFAULT_LOCALE): Display {
  const t = createTranslator(locale);
  switch (status) {
    case 'synced': return { label: t('realtime.network.synced'), tone: 'success' };
    case 'degraded': return { label: t('realtime.network.degraded'), tone: 'danger' };
    case 'stopped': return { label: t('realtime.network.stopped'), tone: 'neutral' };
    case 'starting': return { label: t('realtime.network.starting'), tone: 'warning' };
    default: return { label: t('realtime.network.syncing'), tone: 'warning' };
  }
}
