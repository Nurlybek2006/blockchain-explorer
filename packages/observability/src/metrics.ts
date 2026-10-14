import { metrics, type Attributes, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';
import type { TelemetryAttributes } from './attributes.js';

const counters = [
  'http.server.requests', 'indexer_blocks_processed_total', 'indexer_transactions_processed_total',
  'indexer_logs_processed_total', 'indexer_token_transfers_processed_total', 'indexer_reorgs_total',
  'indexer_processing_errors_total', 'indexer_contracts_discovered_total', 'indexer_contract_verification_total',
  'indexer_traces_total', 'ethereum_rpc_requests_total', 'ethereum_rpc_errors_total', 'ethereum_rpc_retries_total',
  'ethereum_rpc_rate_limited_total', 'portfolio_valuations_total', 'portfolio_price_refresh_total',
  'portfolio_price_refresh_errors_total', 'portfolio_snapshots_total', 'portfolio_alerts_triggered_total',
  'cache_requests_total', 'cache_hits_total', 'cache_misses_total', 'cache_errors_total',
  'rabbitmq_published_total', 'rabbitmq_publish_errors_total', 'rabbitmq_consumed_total', 'rabbitmq_consumer_errors_total',
  'bullmq_jobs_completed_total', 'bullmq_jobs_failed_total', 'websocket_connections_total',
  'websocket_disconnects_total', 'websocket_events_broadcast_total', 'websocket_broadcast_errors_total',
  'coingecko_requests_total', 'coingecko_errors_total', 'app_spans_total',
] as const;
const histograms = [
  'http.server.duration', 'indexer_block_processing_duration_seconds', 'ethereum_rpc_duration_seconds',
  'portfolio_valuation_duration_seconds', 'cache_operation_duration_seconds', 'bullmq_job_duration_seconds',
  'coingecko_duration_seconds', 'app_span_duration_seconds',
] as const;
const gauges = [
  'service_up', 'indexer_latest_indexed_block', 'indexer_rpc_latest_block', 'indexer_lag_blocks',
  'indexer_outbox_backlog', 'indexer_outbox_oldest_pending_age_seconds', 'indexer_running',
  'portfolio_unpriced_assets', 'bullmq_jobs_active', 'bullmq_jobs_waiting', 'websocket_connections_active',
  'db_pool_total', 'db_pool_idle', 'db_pool_waiting',
] as const;
export type CounterName = typeof counters[number];
export type HistogramName = typeof histograms[number];
export type GaugeName = typeof gauges[number];
export type MetricName = CounterName | HistogramName | GaugeName;

const operationNames = new Set([
  'indexer.scan_batch','indexer.process_block','indexer.fetch_receipts','indexer.parse_erc20','indexer.persist_block',
  'indexer.reorg','indexer.verify_contract','indexer.trace_transaction','ethereum.rpc','coingecko.request',
  'rabbitmq.publish','rabbitmq.consume','bullmq.job','bullmq.enqueue','portfolio.valuation','portfolio.snapshot',
  'portfolio.price_refresh','portfolio.alert_evaluation','redis.cache','http.request',
  'get','set','delete','delete_prefix','invalidate','connect','refresh','scan','publish','consume','sync','rebuild',
]);
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE',
  'eth_blockNumber','eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionReceipt',
  'eth_getBalance','eth_getCode','eth_call','debug_traceTransaction','eth_getLogs','eth_getTransactionByHash']);
const enumLabels: Readonly<Record<string, ReadonlySet<string>>> = {
  status: new Set(['success','error','ok','failed','verified','unverified','pending','unsupported','completed','unavailable','timeout','rate_limited','client_error','server_error','transport_error','hit','miss','other']),
  namespace: new Set(['explorer','price','portfolio','other']),
  event_type: new Set(['block.indexed','token.transfer.indexed','chain.reorganized','portfolio.updated','price.updated','alert.triggered','whale.detected','block.indexed.v1','token.transfer.indexed.v1','chain.reorganized.v1','other']),
  queue: new Set(['portfolio-jobs','contract-verification','transaction-traces','other']),
  job_name: new Set(['sync-token-holding','rebuild-portfolio','verify-contract','trace-transaction','refresh-asset-price','refresh-active-prices','snapshot-portfolio','refresh-portfolio-valuations','evaluate-transfer-alerts','sync-portfolio','other']),
  alert_type: new Set(['price_above','price_below','wallet_activity','whale','other']),
  database: new Set(['identity_db','explorer_db','portfolio_db']),
  service: new Set(['blockchain-explorer-api','blockchain-explorer-indexer','blockchain-explorer-portfolio']),
};
const routes = new Set([
  '/','/health','/health/live','/health/ready','/stats','/blocks','/blocks/:number','/blocks/hash/:hash',
  '/contract/:address','/tx/:hash','/tx/:hash/traces','/address/:address','/address/:address/transfers',
  '/tokens','/token/:address','/token/:address/transfers','/search','/network/status',
  '/users/me','/auth/register','/auth/login','/auth/refresh','/auth/logout','/auth/logout-all',
  '/prices/eth','/prices/token/:address','/portfolio','/portfolio/:id','/portfolio/:id/holdings',
  '/portfolio/:id/history','/portfolio/:id/analytics','/portfolio/:id/valuation',
  '/watchlists','/watchlists/:id','/watchlists/:id/items','/watchlists/:id/items/:itemId',
  '/alerts','/alerts/:id','/alerts/events','/alerts/events/:id/read',
  '/internal/explorer/stats','/internal/explorer/blocks','/internal/explorer/blocks/:number',
  '/internal/explorer/blocks/hash/:hash','/internal/explorer/contracts/:address',
  '/internal/explorer/transactions/:hash','/internal/explorer/transactions/:hash/traces',
  '/internal/explorer/addresses/:address','/internal/explorer/addresses/:address/transfers',
  '/internal/explorer/tokens','/internal/explorer/tokens/:address','/internal/explorer/tokens/:address/transfers',
  '/internal/explorer/search','/internal/explorer/network/status',
  '/internal/prices/eth','/internal/prices/token/:address','/internal/prices/refresh',
  '/internal/portfolios','/internal/portfolios/:id','/internal/portfolios/:id/holdings',
  '/internal/portfolios/:id/history','/internal/portfolios/:id/analytics','/internal/portfolios/:id/valuation',
  '/internal/watchlists','/internal/watchlists/:id','/internal/watchlists/:id/items','/internal/watchlists/:id/items/:itemId',
  '/internal/alerts','/internal/alerts/:id','/internal/alerts/events','/internal/alerts/events/:id/read',
  '<unmatched>',
]);
export function boundedRoute(value: unknown): string { return typeof value === 'string' && routes.has(value) ? value : '<unmatched>'; }

/** Every metric label belongs to a finite vocabulary; user input never grows a registry. */
export function metricAttributes(input: TelemetryAttributes): Attributes {
  const result: Attributes = {};
  for (const [inputKey, value] of Object.entries(input)) {
    // Prometheus adds its own target job label; application jobs need a separate key.
    const key = inputKey === 'job' ? 'job_name' : inputKey;
    if (value === undefined) continue;
    if (key === 'route') { result[key] = boundedRoute(value); continue; }
    if (key === 'method') { result[key] = typeof value === 'string' && methods.has(value) ? value : 'other'; continue; }
    if (key === 'operation') { result[key] = typeof value === 'string' && operationNames.has(value) ? value : 'other'; continue; }
    if (key === 'status_code') { const code = Number(value); result[key] = Number.isInteger(code) && code >= 100 && code <= 599 ? code : 0; continue; }
    const allowed = enumLabels[key];
    if (allowed) {
      let label = String(value);
      // Isolated verification prefixes and instance IDs collapse into stable queue labels.
      if (key === 'queue' && label.endsWith('-verification')) label = 'contract-verification';
      if (key === 'queue' && label.endsWith('-traces')) label = 'transaction-traces';
      result[key] = allowed.has(label) ? label : 'other';
    }
  }
  return result;
}

const counterInstruments = new Map<CounterName, Counter>();
const histogramInstruments = new Map<HistogramName, Histogram>();
interface GaugePoint { value: number; attributes: Attributes }
const gaugePoints = new Map<GaugeName, Map<string, GaugePoint>>();
const gaugeInstruments = new Map<GaugeName, ObservableGauge>();
const meter = () => metrics.getMeter('@blockchain-explorer/observability', '1.0.0');

export function recordCounter(name: CounterName, value = 1, attributes: TelemetryAttributes = {}): void {
  if (!Number.isFinite(value) || value < 0 || !counters.includes(name)) return;
  try {
    let instrument = counterInstruments.get(name);
    if (!instrument) { instrument = meter().createCounter(name); counterInstruments.set(name, instrument); }
    instrument.add(value, metricAttributes(attributes));
  } catch { /* Instrument failures are isolated from the caller. */ }
}
export function recordHistogram(name: HistogramName, value: number, attributes: TelemetryAttributes = {}): void {
  if (!Number.isFinite(value) || value < 0 || !histograms.includes(name)) return;
  try {
    let instrument = histogramInstruments.get(name);
    if (!instrument) {
      instrument = meter().createHistogram(name, { unit: 's', advice: { explicitBucketBoundaries: [0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10,30,60] } });
      histogramInstruments.set(name, instrument);
    }
    instrument.record(value, metricAttributes(attributes));
  } catch { /* Instrument failures are isolated from the caller. */ }
}
export function recordGauge(name: GaugeName, value: number | null, attributes: TelemetryAttributes = {}): void {
  if ((value !== null && !Number.isFinite(value)) || !gauges.includes(name)) return;
  try {
    let points = gaugePoints.get(name);
    if (!points) { points = new Map(); gaugePoints.set(name, points); }
    const labels = metricAttributes(attributes);
    const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
    if (value === null) { points.delete(key); return; }
    if (points.size >= 128 && !points.has(key)) return;
    points.set(key, { value, attributes: labels });
    if (!gaugeInstruments.has(name)) {
      const instrument = meter().createObservableGauge(name);
      instrument.addCallback(result => { for (const point of gaugePoints.get(name)?.values() ?? []) result.observe(point.value, point.attributes); });
      gaugeInstruments.set(name, instrument);
    }
  } catch { /* Instrument failures are isolated from the caller. */ }
}

export interface PoolStats { readonly totalCount: number; readonly idleCount: number; readonly waitingCount: number }
export function registerPoolMetrics(pool: PoolStats, database: 'identity_db' | 'explorer_db' | 'portfolio_db'): () => void {
  let active = true;
  const labels = { database };
  try {
    const instruments = [meter().createObservableGauge('db_pool_total'), meter().createObservableGauge('db_pool_idle'), meter().createObservableGauge('db_pool_waiting')];
    const callback: Parameters<ReturnType<typeof meter>['addBatchObservableCallback']>[0] = result => {
      if (!active) return;
      try {
        result.observe(instruments[0], pool.totalCount, labels);
        result.observe(instruments[1], pool.idleCount, labels);
        result.observe(instruments[2], pool.waitingCount, labels);
      } catch { /* A closing pool may no longer be readable. */ }
    };
    const source = meter(); source.addBatchObservableCallback(callback, instruments);
    return () => { active = false; try { source.removeBatchObservableCallback(callback, instruments); } catch { /* Cleanup is best effort. */ } };
  } catch { return () => { active = false; }; }
}

export function resetMetricInstruments(): void {
  counterInstruments.clear(); histogramInstruments.clear(); gaugePoints.clear(); gaugeInstruments.clear();
}
