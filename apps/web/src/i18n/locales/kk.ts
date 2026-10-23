import { commonKk, navigationKk } from './common.kk';
import { explorerKk, realtimeKk } from './explorer.kk';
import { authKk, portfolioKk, watchlistsKk, alertsKk, settingsKk } from './product.kk';
import { errorsKk } from './errors.kk';
import { pnlKk } from './pnl.kk';
import type { DictionaryShape } from '../types';
import type { en } from './en';

export const kk = {
  common: commonKk, navigation: navigationKk, explorer: explorerKk, realtime: realtimeKk,
  auth: authKk, portfolio: portfolioKk, watchlists: watchlistsKk, alerts: alertsKk, settings: settingsKk,
  errors: errorsKk,
  pnl: pnlKk,
} satisfies DictionaryShape<typeof en>;
