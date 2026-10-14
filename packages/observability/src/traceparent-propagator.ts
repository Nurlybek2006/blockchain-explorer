import type { Context, TextMapGetter, TextMapPropagator, TextMapSetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/** W3C traceparent is sufficient for this stack; arbitrary vendor state is excluded. */
export class TraceparentPropagator implements TextMapPropagator {
  private readonly delegate = new W3CTraceContextPropagator();
  inject<T>(parent: Context, carrier: T, setter: TextMapSetter<T>): void {
    this.delegate.inject(parent, carrier, { set: (target, key, value) => { if (key === 'traceparent') setter.set(target, key, value); } });
  }
  extract<T>(parent: Context, carrier: T, getter: TextMapGetter<T>): Context {
    return this.delegate.extract(parent, carrier, {
      keys: target => getter.keys(target).filter(key => key.toLowerCase() === 'traceparent'),
      get: (target, key) => key === 'traceparent' ? getter.get(target, key) : undefined,
    });
  }
  fields(): string[] { return ['traceparent']; }
}
