export const INITIAL_SYNC_EVENT_TYPE = 'portfolio.initial-sync.requested.v1';

export interface InitialPortfolioSyncPayload {
  portfolioId: string;
  chainId: number;
}

export function isInitialPortfolioSyncPayload(value: unknown): value is InitialPortfolioSyncPayload {
  return typeof value === 'object' && value !== null &&
    'portfolioId' in value && typeof value.portfolioId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.portfolioId) &&
    'chainId' in value && typeof value.chainId === 'number' &&
    Number.isInteger(value.chainId) && value.chainId > 0;
}
