import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';
import { TraceContext } from './types';

export interface RequestLogContext {
  trace?: TraceContext;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
}

export const logContextStorage = new AsyncLocalStorage<RequestLogContext>();

/**
 * Parse W3C traceparent header: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function parseTraceparent(
  header?: string | string[],
): TraceContext | undefined {
  if (!header) return undefined;
  let traceparentStr: string;
  if (Array.isArray(header)) {
    if (header.length === 0) return undefined;
    traceparentStr = header[0];
  } else {
    traceparentStr = header;
  }

  const match =
    /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
      traceparentStr.trim(),
    );
  if (!match) return undefined;

  const [, , traceId, spanId, flags] = match;
  const sampled = (parseInt(flags, 16) & 1) === 1;

  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    sampled,
  };
}

export function generateTraceContext(): TraceContext {
  return {
    traceId: crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    sampled: true,
  };
}

export function getTraceContext(): TraceContext | undefined {
  return logContextStorage.getStore()?.trace;
}

export function getRequestContext(): RequestLogContext | undefined {
  return logContextStorage.getStore();
}
