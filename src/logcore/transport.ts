import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import {
  LogcoreConfig,
  LogcoreEntry,
  LogcoreEnvelope,
  LogOptions,
} from './types';
import { loadLogcoreConfig } from './config';
import { formatErrorPayload } from './stack-parser';
import { getCurrentContext, getCurrentTrace } from './context';

const SEVERITY_LEVELS: Record<string, number> = {
  DEBUG: 100,
  INFO: 200,
  WARN: 300,
  WARNING: 300,
  ERROR: 400,
  CRITICAL: 500,
  FATAL: 600,
};

function canonicalJson(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val) ?? 'null';
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalJson).join(',') + ']';
  }
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',') +
    '}'
  );
}

export function computeInsertId(
  timestamp: string,
  service: string,
  severity: string,
  message: string,
  context?: Record<string, unknown>,
): string {
  const contextStr = context ? canonicalJson(context) : '{}';
  const payload = `${timestamp}|${service}|${severity}|${message}|${contextStr}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function clampLabels(
  labels?: Record<string, string>,
): Record<string, string> | undefined {
  if (!labels || typeof labels !== 'object') return undefined;
  const clamped: Record<string, string> = {};
  const entries = Object.entries(labels).slice(0, 32);
  for (const [key, val] of entries) {
    if (key) {
      clamped[key.slice(0, 1024)] = String(val).slice(0, 1024);
    }
  }
  return Object.keys(clamped).length > 0 ? clamped : undefined;
}

export class LogcoreTransport {
  private config: LogcoreConfig;
  private buffer: LogcoreEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private consecutiveFailures = 0;
  private isSendingInternal = false;
  private onEntryListeners: Array<(entry: LogcoreEntry) => void> = [];

  private static readonly MAX_BUFFER_SIZE = 1000;
  private static readonly BATCH_SIZE = 20;
  private static readonly MAX_BATCH_SIZE = 200;
  private static readonly FLUSH_INTERVAL_MS = 5000;
  private static readonly MAX_CONSECUTIVE_FAILURES = 10;
  private static readonly MAX_RETRIES = 3;

  constructor(config?: LogcoreConfig) {
    this.config = config || loadLogcoreConfig();
  }

  public getConfig(): LogcoreConfig {
    return this.config;
  }

  public onEntry(listener: (entry: LogcoreEntry) => void): () => void {
    this.onEntryListeners.push(listener);
    return () => {
      this.onEntryListeners = this.onEntryListeners.filter(l => l !== listener);
    };
  }

  public updateConfig(newConfig: Partial<LogcoreConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public isLogcoreUrl(url: string): boolean {
    if (!this.config.url) return false;
    try {
      const configHost = new URL(this.config.url).host;
      const targetHost = new URL(url).host;
      return configHost === targetHost;
    } catch {
      return false;
    }
  }

  private shouldLog(severity: string): boolean {
    const sevScore = SEVERITY_LEVELS[severity.toUpperCase()] ?? 400;
    const minScore =
      SEVERITY_LEVELS[this.config.minSeverity.toUpperCase()] ?? 400;
    return sevScore >= minScore;
  }

  public log(options: LogOptions): void {
    if (!this.config.enabled) {
      return;
    }

    const severity = (options.severity || 'ERROR').toUpperCase();
    if (!this.shouldLog(severity)) {
      return;
    }

    try {
      const timestamp = options.timestamp || new Date().toISOString();
      const message = String(options.message || '').slice(0, 65536);
      const service = this.config.service;
      const env = this.config.env;

      const reqCtx = getCurrentContext();
      const context = options.context || reqCtx?.context;
      const trace = options.trace || reqCtx?.trace || getCurrentTrace();
      const labels = clampLabels({ ...reqCtx?.labels, ...options.labels });

      const insertId = computeInsertId(
        timestamp,
        service,
        severity,
        message,
        context,
      );

      const errorPayload = options.error
        ? formatErrorPayload(options.error)
        : undefined;

      const entry: LogcoreEntry = {
        timestamp,
        severity,
        message,
        service,
        env,
        insert_id: insertId,
      };

      if (trace) {
        entry.trace = trace;
      }
      if (errorPayload) {
        entry.error = errorPayload;
      }
      if (labels) {
        entry.labels = labels;
      }
      if (context && Object.keys(context).length > 0) {
        entry.context = context;
      }

      for (const listener of this.onEntryListeners) {
        try {
          listener(entry);
        } catch {
          // Swallow listener errors
        }
      }

      if (process.env.LOGCORE_PROBE !== 'true') {
        this.enqueue(entry);
      }
    } catch {
      // Swallowed: logging must never crash the host application
    }
  }

  private enqueue(entry: LogcoreEntry): void {
    if (this.buffer.length >= LogcoreTransport.MAX_BUFFER_SIZE) {
      // Drop oldest entries to maintain buffer cap
      const overflowCount =
        this.buffer.length - LogcoreTransport.MAX_BUFFER_SIZE + 1;
      this.buffer.splice(0, overflowCount);
    }

    this.buffer.push(entry);

    if (this.buffer.length >= LogcoreTransport.BATCH_SIZE) {
      this.triggerFlushAsync(0);
    } else if (!this.flushTimer) {
      this.scheduleFlush(LogcoreTransport.FLUSH_INTERVAL_MS);
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.triggerFlushAsync(0);
    }, delayMs);

    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private triggerFlushAsync(delayMs = 0): void {
    if (delayMs === 0) {
      setImmediate(() => {
        this.flush().catch(() => {});
      });
    } else {
      setTimeout(() => {
        this.flush().catch(() => {});
      }, delayMs);
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    if (
      this.consecutiveFailures >= LogcoreTransport.MAX_CONSECUTIVE_FAILURES
    ) {
      // Circuit breaker is tripped: empty buffer and refuse sending until reset
      this.buffer = [];
      return;
    }

    this.isFlushing = true;

    try {
      while (
        this.buffer.length > 0 &&
        this.consecutiveFailures < LogcoreTransport.MAX_CONSECUTIVE_FAILURES
      ) {
        const batch = this.buffer.splice(0, LogcoreTransport.MAX_BATCH_SIZE);
        if (batch.length === 0) break;

        const success = await this.sendBatchWithRetry(batch);
        if (!success) {
          // If sending completely failed after retries, circuit breaker counter was incremented
          break;
        }
      }
    } finally {
      this.isFlushing = false;
      if (this.buffer.length > 0 && !this.flushTimer) {
        this.scheduleFlush(LogcoreTransport.FLUSH_INTERVAL_MS);
      }
    }
  }

  private async sendBatchWithRetry(batch: LogcoreEntry[]): Promise<boolean> {
    if (this.isSendingInternal) {
      return false;
    }

    const envelope: LogcoreEnvelope = {
      schema_version: 1,
      entries: batch,
    };
    const payload = JSON.stringify(envelope);

    const baseUrl = this.config.url.replace(/\/+$/, '');
    const endpointUrl = `${baseUrl}/v1/logs`;
    const apiKey = this.config.apiKey;

    let attempt = 0;
    let delivered = false;

    while (attempt < LogcoreTransport.MAX_RETRIES && !delivered) {
      try {
        this.isSendingInternal = true;
        const res = await this.httpPost(endpointUrl, apiKey, payload);
        this.isSendingInternal = false;

        if (res.status >= 200 && res.status < 300) {
          delivered = true;
          this.consecutiveFailures = 0;
          return true;
        }

        if (res.status === 429 || res.status >= 500) {
          // Retryable status code: backoff 2^attempt * 250ms
          attempt++;
          if (attempt < LogcoreTransport.MAX_RETRIES) {
            const delay = Math.pow(2, attempt - 1) * 250;
            await new Promise(r => setTimeout(r, delay));
          }
        } else {
          // Permanent 4xx error (e.g. 400, 401, 403, 422): drop batch and echo to stderr
          process.stderr.write(
            `[logcore] Permanent rejection ${res.status}: ${res.body}\n`,
          );
          return false;
        }
      } catch {
        this.isSendingInternal = false;
        attempt++;
        if (attempt < LogcoreTransport.MAX_RETRIES) {
          const delay = Math.pow(2, attempt - 1) * 250;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    if (!delivered) {
      this.consecutiveFailures++;
      if (
        this.consecutiveFailures >= LogcoreTransport.MAX_CONSECUTIVE_FAILURES
      ) {
        process.stderr.write(
          '[logcore] Circuit breaker tripped after 10 consecutive failed flushes. Emptying buffer.\n',
        );
        this.buffer = [];
      }
      return false;
    }

    return true;
  }

  private httpPost(
    endpointUrl: string,
    apiKey: string,
    payload: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(endpointUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;

        const req = client.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'x-api-key': apiKey,
            },
            timeout: 10000,
          },
          res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
              body += chunk;
            });
            res.on('end', () => {
              resolve({ status: res.statusCode || 0, body });
            });
          },
        );

        req.on('timeout', () => {
          req.destroy(new Error('Logcore HTTP request timeout'));
        });

        req.on('error', err => {
          reject(err);
        });

        req.write(payload);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

let defaultTransport: LogcoreTransport | null = null;

export function getLogcoreTransport(config?: LogcoreConfig): LogcoreTransport {
  if (!defaultTransport) {
    defaultTransport = new LogcoreTransport(config);
  } else if (config) {
    defaultTransport.updateConfig(config);
  }
  return defaultTransport;
}
