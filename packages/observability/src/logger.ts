import { context, trace, type Context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { currentRequestId } from './context.js';
import { sanitize, sanitizeText } from './sanitize.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const severity: Record<LogLevel, SeverityNumber> = { debug: SeverityNumber.DEBUG, info: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR, fatal: SeverityNumber.FATAL };
export interface LogRecord { timestamp: string; level: LogLevel; service: string; message: unknown; context?: unknown; traceId?: string; spanId?: string; requestId?: string }
export interface StructuredLoggerOptions { service: string; format?: 'json' | 'pretty'; level?: LogLevel; sink?: (line: string) => void }

/** Nest LoggerService-compatible adapter; no dependency on Nest internals. */
export class StructuredLogger {
  private readonly format: 'json' | 'pretty';
  private readonly threshold: number;
  private readonly sink: (line: string) => void;
  constructor(private readonly options: StructuredLoggerOptions) {
    this.format = options.format ?? (process.env.LOG_FORMAT === 'pretty' ? 'pretty' : 'json');
    const configured = process.env.LOG_LEVEL;
    this.threshold = levels[options.level ?? (configured === 'debug' || configured === 'warn' || configured === 'error' || configured === 'fatal' ? configured : 'info')];
    this.sink = options.sink ?? (line => { process.stdout.write(`${line}\n`); });
  }
  log(message: unknown, ...parameters: unknown[]): void { this.write('info', message, parameters); }
  error(message: unknown, ...parameters: unknown[]): void { this.write('error', message, parameters); }
  warn(message: unknown, ...parameters: unknown[]): void { this.write('warn', message, parameters); }
  debug(message: unknown, ...parameters: unknown[]): void { this.write('debug', message, parameters); }
  verbose(message: unknown, ...parameters: unknown[]): void { this.write('debug', message, parameters); }
  fatal(message: unknown, ...parameters: unknown[]): void { this.write('fatal', message, parameters); }
  emit(level: LogLevel, message: unknown, fields?: unknown, parent: Context = context.active()): void {
    if (levels[level] < this.threshold) return;
    try {
      const record: LogRecord = { timestamp: new Date().toISOString(), level, service: this.options.service, message: sanitize(message) };
      if (fields !== undefined) record.context = sanitize(fields);
      const span = trace.getSpanContext(parent);
      if (span && trace.isSpanContextValid(span)) { record.traceId = span.traceId; record.spanId = span.spanId; }
      const requestId = currentRequestId(); if (requestId) record.requestId = requestId;
      const json = JSON.stringify(record);
      const line = this.format === 'json' ? json : `${record.timestamp} ${level.toUpperCase()} [${record.service}] ${typeof record.message === 'string' ? record.message : JSON.stringify(record.message)}${record.traceId ? ` traceId=${record.traceId} spanId=${record.spanId}` : ''}${record.requestId ? ` requestId=${record.requestId}` : ''}${record.context !== undefined ? ` ${JSON.stringify(record.context)}` : ''}`;
      this.sink(line);
      logs.getLogger('@blockchain-explorer/observability', '1.0.0').emit({
        context: parent, severityNumber: severity[level], severityText: level.toUpperCase(), body: json,
        attributes: { service: this.options.service, level, ...(requestId ? { requestId } : {}) },
      });
    } catch { /* Broken stdout or exporter must never fail business operations. */ }
  }
  private write(level: LogLevel, message: unknown, parameters: unknown[]): void {
    const fields = parameters.length === 1 ? parameters[0] : parameters.length ? parameters : undefined;
    this.emit(level, typeof message === 'string' ? sanitizeText(message) : message, fields);
  }
}
