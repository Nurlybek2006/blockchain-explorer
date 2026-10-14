import type { IncomingMessage, ServerResponse } from 'node:http';
import { context, trace } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { withRequestId, currentRequestId } from './context.js';
import { boundedRoute, recordCounter, recordHistogram } from './metrics.js';
import type { StructuredLogger } from './logger.js';

interface RoutedRequest extends IncomingMessage { route?: { path?: unknown }; baseUrl?: string }
export function requestTelemetry(service: string, logger: StructuredLogger) {
  return (request: RoutedRequest, response: ServerResponse, next: () => void): void => {
    withRequestId(request.headers['x-request-id'], () => {
      const id = currentRequestId(); if (id) response.setHeader('x-request-id', id);
      const started = performance.now();
      const parent = context.active();
      try {
        if (id) {
          trace.getSpan(parent)?.setAttribute('request.id', id);
          // Express middleware may have its own active span; HTTP metadata owns the server span.
          const inbound = getRPCMetadata(parent);
          if (inbound?.type === RPCType.HTTP) inbound.span.setAttribute('request.id', id);
        }
      } catch { /* Optional trace correlation never changes request handling. */ }
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        const route = boundedRoute(typeof request.route?.path === 'string' ? `${request.baseUrl ?? ''}${request.route.path}` : undefined);
        const method = request.method ?? 'OTHER';
        const status = response.writableFinished ? response.statusCode : 499;
        const duration = (performance.now() - started) / 1_000;
        const attributes = { service, method, route, status_code: status };
        recordCounter('http.server.requests', 1, attributes);
        recordHistogram('http.server.duration', duration, attributes);
        // Bound route names also replace HTTP auto span names before export.
        try { trace.getSpan(parent)?.updateName(`${method} ${route}`); trace.getSpan(parent)?.setAttribute('http.route', route); } catch { /* Optional enrichment. */ }
        context.with(parent, () => logger.emit(status >= 500 ? 'error' : 'info', 'HTTP request completed', { method, route, status_code: status, duration_seconds: duration }, parent));
      };
      response.once('finish', finish); response.once('close', finish);
      next();
    });
  };
}
