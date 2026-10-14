import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { AggregationTemporality, InstrumentType, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ExportResult } from '@opentelemetry/core';
import { safeMetricExemplars } from './metric-privacy.js';

/** Cumulative counters/histograms retain totals; gauges must forget missing samples. */
export function metricTemporality(type: InstrumentType): AggregationTemporality {
  return type === InstrumentType.OBSERVABLE_GAUGE || type === InstrumentType.GAUGE ? AggregationTemporality.DELTA : AggregationTemporality.CUMULATIVE;
}
export class SafeMetricExporter extends OTLPMetricExporter {
  override selectAggregationTemporality(type: InstrumentType): AggregationTemporality { return metricTemporality(type); }
  override export(metrics: ResourceMetrics, callback: (result: ExportResult) => void): void {
    // SDK 2.12 does not currently attach exemplars to MetricData, but exporters
    // accepting richer producers must not reintroduce filtered secret labels.
    for (const scope of metrics.scopeMetrics) for (const metric of scope.metrics) for (const point of metric.dataPoints) {
      if ('exemplars' in point) Reflect.set(point, 'exemplars', safeMetricExemplars(point.exemplars));
    }
    super.export(metrics, callback);
  }
}
