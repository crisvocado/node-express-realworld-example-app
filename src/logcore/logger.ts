import * as crypto from 'crypto';
import { LogEntry, LogSeverity, TraceContext } from './types';
import { getConfig, shouldLog } from './config';
import { parseError } from './stack-parser';
import { getRequestContext } from './context';
import { getTransport } from './transport';

export function computeInsertId(
  timestamp: string,
  service: string,
  severity: string,
  message: string,
  context?: Record<string, unknown>,
): string {
  const parts = [
    timestamp,
    service,
    severity,
    message,
    context ? JSON.stringify(context) : '{}',
  ];
  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32);
}

export function clampLabels(
  labels?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!labels) return undefined;
  const result: Record<string, string> = {};
  const entries = Object.entries(labels);
  const maxEntries = Math.min(entries.length, 32);

  for (let i = 0; i < maxEntries; i++) {
    const [key, val] = entries[i];
    if (key) {
      result[key] = String(val ?? '').slice(0, 1024);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function captureError(
  err: unknown,
  customMessage?: string,
  customLabels?: Record<string, string>,
  customContext?: Record<string, unknown>,
): void {
  try {
    const config = getConfig();
    if (!config.enabled) return;

    const severity: LogSeverity = 'ERROR';
    if (!shouldLog(severity, config.minSeverity)) return;

    const errorDetail = parseError(err);
    const message = (
      customMessage ||
      errorDetail.message ||
      errorDetail.type ||
      'Error'
    ).slice(0, 65536);
    const timestamp = new Date().toISOString();

    const reqContext = getRequestContext();
    const trace: TraceContext | undefined = reqContext?.trace;

    const mergedLabels = clampLabels({
      ...(reqContext?.labels || {}),
      ...(customLabels || {}),
    });

    const mergedContext: Record<string, unknown> | undefined =
      reqContext?.context || customContext
        ? { ...(reqContext?.context || {}), ...(customContext || {}) }
        : undefined;

    const insert_id = computeInsertId(
      timestamp,
      config.service,
      severity,
      message,
      mergedContext,
    );

    const entry: LogEntry = {
      timestamp,
      severity,
      message,
      service: config.service,
      env: config.env,
      insert_id,
    };

    if (trace) {
      entry.trace = trace;
    }

    if (errorDetail) {
      entry.error = errorDetail;
    }

    if (mergedLabels) {
      entry.labels = mergedLabels;
    }

    if (mergedContext) {
      entry.context = mergedContext;
    }

    getTransport().enqueue(entry);
  } catch {
    // Swallow any logger failure so application is never broken
  }
}

export function captureLog(
  severity: LogSeverity,
  message: string,
  customLabels?: Record<string, string>,
  customContext?: Record<string, unknown>,
): void {
  try {
    const config = getConfig();
    if (!config.enabled) return;

    if (!shouldLog(severity, config.minSeverity)) return;

    const clampedMessage = (message || '').slice(0, 65536);
    const timestamp = new Date().toISOString();

    const reqContext = getRequestContext();
    const trace: TraceContext | undefined = reqContext?.trace;

    const mergedLabels = clampLabels({
      ...(reqContext?.labels || {}),
      ...(customLabels || {}),
    });

    const mergedContext: Record<string, unknown> | undefined =
      reqContext?.context || customContext
        ? { ...(reqContext?.context || {}), ...(customContext || {}) }
        : undefined;

    const insert_id = computeInsertId(
      timestamp,
      config.service,
      severity,
      clampedMessage,
      mergedContext,
    );

    const entry: LogEntry = {
      timestamp,
      severity,
      message: clampedMessage,
      service: config.service,
      env: config.env,
      insert_id,
    };

    if (trace) {
      entry.trace = trace;
    }

    if (mergedLabels) {
      entry.labels = mergedLabels;
    }

    if (mergedContext) {
      entry.context = mergedContext;
    }

    getTransport().enqueue(entry);
  } catch {
    // Swallow
  }
}
