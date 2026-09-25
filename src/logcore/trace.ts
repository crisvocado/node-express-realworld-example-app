import * as crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { TraceContext } from './types';

export const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Parses a W3C traceparent header: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function parseTraceparent(header?: string): TraceContext | null {
  if (!header || typeof header !== 'string') {
    return null;
  }
  const parts = header.trim().split('-');
  if (parts.length < 4) {
    return null;
  }
  const [, traceId, spanId, flags] = parts;
  if (!/^[0-9a-f]{32}$/i.test(traceId) || !/^[0-9a-f]{16}$/i.test(spanId)) {
    return null;
  }
  const sampled = (parseInt(flags, 16) & 1) === 1;
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    sampled,
  };
}

/**
 * Generates a fresh W3C TraceContext.
 */
export function generateTrace(sampled = true): TraceContext {
  return {
    traceId: crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    sampled,
  };
}

/**
 * Formats a TraceContext into a W3C traceparent header string.
 */
export function formatTraceparent(trace: TraceContext): string {
  const flags = trace.sampled ? '01' : '00';
  return `00-${trace.traceId}-${trace.spanId}-${flags}`;
}

/**
 * Retrieves the active trace context from AsyncLocalStorage.
 */
export function getCurrentTrace(): TraceContext | undefined {
  return traceStorage.getStore();
}
