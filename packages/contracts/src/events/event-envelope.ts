import {
  randomUUID,
} from 'node:crypto';

export interface EventEnvelope<
  TType extends string = string,
  TPayload = unknown,
> {
  id: string;

  type: TType;

  version: number;

  producer: string;

  occurredAt: string;

  payload: TPayload;
}

export function createEventEnvelope<
  TType extends string,
  TPayload,
>(
  type: TType,
  producer: string,
  payload: TPayload,
): EventEnvelope<
  TType,
  TPayload
> {
  return {
    id:
      randomUUID(),

    type,

    version:
      1,

    producer,

    occurredAt:
      new Date()
        .toISOString(),

    payload,
  };
}

export function isEventEnvelope(
  value: unknown,
): value is EventEnvelope {
  if (
    value === null ||
    typeof value !==
      'object'
  ) {
    return false;
  }

  const candidate =
    value as Record<
      string,
      unknown
    >;

  return (
    typeof candidate.id ===
      'string' &&
    typeof candidate.type ===
      'string' &&
    typeof candidate.version ===
      'number' &&
    typeof candidate.producer ===
      'string' &&
    typeof candidate.occurredAt ===
      'string' &&
    Object.prototype
      .hasOwnProperty.call(
        candidate,
        'payload',
      )
  );
}
// Барлық RabbitMQ event-тері үшін бірдей стандартты envelope жасайды: id, type, producer, time, payload.