import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';
import { TraceContext } from './types';

export interface RequestContext {
  trace: TraceContext;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
}

export const logcoreStorage = new AsyncLocalStorage<RequestContext>();

export function parseTraceparent(
  header?: string | string[],
): TraceContext | null {
  if (!header) return null;
  const val = Array.isArray(header) ? header[0] : header;
  if (!val || typeof val !== 'string') return null;

  const match = val
    .trim()
    .match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (!match) return null;

  const [, traceId, spanId, flags] = match;
  if (
    traceId === '00000000000000000000000000000000' ||
    spanId === '0000000000000000'
  ) {
    return null;
  }

  const sampled = (parseInt(flags, 16) & 1) === 1;
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    sampled,
  };
}

export function generateTrace(): TraceContext {
  return {
    traceId: crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    sampled: true,
  };
}

export function getCurrentTrace(): TraceContext | undefined {
  return logcoreStorage.getStore()?.trace;
}

export function getCurrentContext(): RequestContext | undefined {
  return logcoreStorage.getStore();
}
