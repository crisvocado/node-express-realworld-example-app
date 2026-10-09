import { AsyncLocalStorage } from 'async_hooks';
import { TraceContext } from './types';

const traceStorage = new AsyncLocalStorage<TraceContext>();

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header?: string | string[]): TraceContext | undefined {
  if (!header) return undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return undefined;

  const match = TRACEPARENT_REGEX.exec(raw.trim());
  if (!match) return undefined;

  const traceId = match[1];
  const spanId = match[2];
  const flags = match[3];

  if (/^0{32}$/.test(traceId) || /^0{16}$/.test(spanId)) {
    return undefined;
  }

  const sampled = (parseInt(flags, 16) & 1) === 1;

  return {
    traceId,
    spanId,
    sampled,
  };
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function runWithTrace<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}
