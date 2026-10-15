import { createTranslator } from './translator';
import type { Locale } from './types';

/** Updates browser metadata on locale changes without refreshing or remounting the app. */
export function localizedMetadata(pathname: string, locale: Locale): { title: string; description: string } {
  const t = createTranslator(locale);
  const segments = pathname.split('/').filter(Boolean);
  let title: string;
  const value = segments[1] ?? '';
  switch (segments[0]) {
    case undefined: title = t('explorer.metadata.home'); break;
    case 'blocks': title = /^\d+$/.test(value) ? t('explorer.metadata.block', { number: value }) : t('explorer.metadata.blocks'); break;
    case 'tx': title = /^0x[\da-f]{64}$/i.test(value) ? t('explorer.metadata.transaction', { hash: `${value.slice(0, 12)}…` }) : t('explorer.labels.transaction'); break;
    case 'address': title = /^0x[\da-f]{40}$/i.test(value) ? t('explorer.metadata.address', { address: `${value.slice(0, 10)}…` }) : t('explorer.labels.address'); break;
    case 'token': title = /^0x[\da-f]{40}$/i.test(value) ? t('explorer.metadata.token', { address: `${value.slice(0, 10)}…` }) : t('explorer.labels.token'); break;
    case 'contract': title = /^0x[\da-f]{40}$/i.test(value) ? t('explorer.metadata.contract', { address: `${value.slice(0, 10)}…` }) : t('explorer.labels.contract'); break;
    case 'tokens': title = t('explorer.metadata.tokens'); break;
    case 'search': title = t('explorer.metadata.search'); break;
    case 'login': title = t('auth.login'); break;
    case 'register': title = t('auth.create'); break;
    case 'dashboard': case 'portfolio': title = value ? t('portfolio.details') : t('portfolio.title'); break;
    case 'watchlists': title = t(value ? 'watchlists.details' : 'watchlists.title'); break;
    case 'alerts': title = t('alerts.title'); break;
    case 'settings': title = t('settings.title'); break;
    default: title = t('common.notFound.title');
  }
  return { title: `${title} | Blockchain Explorer`, description: t('common.metadata.description') };
}
