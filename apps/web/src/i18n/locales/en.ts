import { commonEn, navigationEn } from './common.en';
import { explorerEn, realtimeEn } from './explorer.en';
import { authEn, portfolioEn, watchlistsEn, alertsEn, settingsEn } from './product.en';
import { errorsEn } from './errors.en';
import { pnlEn } from './pnl.en';

export const en = {
  common: commonEn, navigation: navigationEn, explorer: explorerEn, realtime: realtimeEn,
  auth: authEn, portfolio: portfolioEn, watchlists: watchlistsEn, alerts: alertsEn, settings: settingsEn,
  errors: errorsEn,
  pnl: pnlEn,
} as const;
