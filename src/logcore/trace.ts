import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';
import { LogcoreTrace } from './types';

export const traceStorage = new AsyncLocalStorage<LogcoreTrace>();

export function parseTraceparent(header: string): LogcoreTrace | undefined {
  if (!header || typeof header !== 'string') {
    return undefined;
  }
  const parts = header.trim().split('-');
  if (parts.length < 4) {
    return undefined;
  }
  const traceId = parts[1];
  const spanId = parts[2];
  const flags = parts[3];

  if (traceId.length !== 32 || spanId.length !== 16) {
    return undefined;
  }

  const sampled = (parseInt(flags, 16) & 1) === 1;

  return {
    traceId,
    spanId,
    sampled,
  };
}

export function createTrace(sampled = true): LogcoreTrace {
  const traceId = crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  return {
    traceId,
    spanId,
    sampled,
  };
}

export function formatTraceparent(trace: LogcoreTrace): string {
  const flags = trace.sampled ? '01' : '00';
  return `00-${trace.traceId}-${trace.spanId}-${flags}`;
}

export function getCurrentTrace(): LogcoreTrace | undefined {
  return traceStorage.getStore();
}

export function runWithTrace<T>(trace: LogcoreTrace, fn: () => T): T {
  return traceStorage.run(trace, fn);
}
