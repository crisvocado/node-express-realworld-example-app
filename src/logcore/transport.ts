import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { canonicalJson } from './canonical-json';
import { parseError } from './stack-parser';
import { getCurrentTrace } from './trace';
import {
  LogcoreConfig,
  LogEntry,
  LogEnvelope,
  LogEnv,
  LogSeverity,
  TraceContext,
} from './types';

const SEVERITY_LEVELS: Record<LogSeverity, number> = {
  DEFAULT: 0,
  DEBUG: 100,
  INFO: 200,
  NOTICE: 300,
  WARNING: 400,
  ERROR: 500,
  CRITICAL: 600,
  ALERT: 700,
  EMERGENCY: 800,
};

const VALID_ENVS: Set<LogEnv> = new Set(['prod', 'staging', 'dev', 'test', 'local']);

export function normalizeEnv(rawEnv?: string): LogEnv {
  if (!rawEnv) return 'dev';
  const lower = rawEnv.toLowerCase().trim();
  if (lower === 'production') return 'prod';
  if (lower === 'development') return 'dev';
  if (VALID_ENVS.has(lower as LogEnv)) {
    return lower as LogEnv;
  }
  return 'dev';
}

export function normalizeService(rawService?: string): string {
  if (!rawService) return 'api';
  let cleaned = rawService.toLowerCase().trim().replace(/[^a-z0-9._-]/g, '-');
  if (!/^[a-z0-9]/.test(cleaned)) {
    cleaned = 'app-' + cleaned;
  }
  cleaned = cleaned.slice(0, 63);
  return cleaned || 'api';
}

export function clampLabels(labels?: Record<string, string>): Record<string, string> | undefined {
  if (!labels) return undefined;
  const entries = Object.entries(labels).slice(0, 32);
  if (entries.length === 0) return undefined;
  const clamped: Record<string, string> = {};
  for (const [k, v] of entries) {
    clamped[k.slice(0, 128)] = String(v).slice(0, 1024);
  }
  return clamped;
}

export function computeInsertId(entry: {
  timestamp: string;
  service: string;
  severity: string;
  message: string;
  context?: any;
}): string {
  const contextStr = canonicalJson(entry.context || {});
  const payload = `${entry.timestamp}|${entry.service}|${entry.severity}|${entry.message}|${contextStr}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function isSeverityAboveFloor(
  severity: LogSeverity,
  floor: LogSeverity = 'ERROR',
): boolean {
  return (SEVERITY_LEVELS[severity] ?? 0) >= (SEVERITY_LEVELS[floor] ?? 500);
}

export function createLogEntry(
  message: string,
  severity: LogSeverity = 'ERROR',
  options: {
    error?: any;
    trace?: TraceContext;
    labels?: Record<string, string>;
    context?: Record<string, any>;
    config?: LogcoreConfig;
  } = {},
): LogEntry {
  const cfg = options.config || {};
  const timestamp = new Date().toISOString();
  const service = normalizeService(cfg.service || process.env.LOGCORE_SERVICE || 'api');
  const env = normalizeEnv(
    cfg.env ||
      (process.env.LOGCORE_ENV as LogEnv) ||
      (process.env.NODE_ENV === 'production'
        ? 'prod'
        : process.env.NODE_ENV === 'test'
        ? 'test'
        : 'dev'),
  );

  let msg = message;
  if (!msg && options.error) {
    msg = options.error.message || String(options.error);
  }
  const clampedMessage = String(msg || '').slice(0, 65536);

  const errorInfo = options.error ? parseError(options.error) : undefined;
  const trace = options.trace || getCurrentTrace();
  const labels = clampLabels(options.labels);
  const context = options.context;

  const insert_id = computeInsertId({
    timestamp,
    service,
    severity,
    message: clampedMessage,
    context,
  });

  const entry: LogEntry = {
    timestamp,
    severity,
    message: clampedMessage,
    service,
    env,
    insert_id,
  };

  if (trace) {
    entry.trace = trace;
  }
  if (errorInfo) {
    entry.error = errorInfo;
  }
  if (labels && Object.keys(labels).length > 0) {
    entry.labels = labels;
  }
  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }

  return entry;
}

async function sendHttpRequest(
  url: string,
  apiKey: string,
  payload: LogEnvelope,
  timeoutMs = 10000,
): Promise<{ status: number; body: string }> {
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, body: text };
    } finally {
      clearTimeout(timer);
    }
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transportModule = parsedUrl.protocol === 'https:' ? https : http;
    const data = JSON.stringify(payload);

    const req = transportModule.request(
      parsedUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'x-api-key': apiKey,
        },
        timeout: timeoutMs,
      },
      res => {
        let responseBody = '';
        res.on('data', chunk => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: responseBody });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });

    req.write(data);
    req.end();
  });
}

async function flushBatch(
  entries: LogEntry[],
  config: LogcoreConfig,
): Promise<boolean> {
  if (entries.length === 0) return true;

  const envelope: LogEnvelope = {
    schema_version: 1,
    entries,
  };

  if (config.sender) {
    try {
      await config.sender(envelope);
      return true;
    } catch (err: any) {
      process.stderr.write(`[logcore] Custom sender failed: ${err?.message || String(err)}\n`);
      return false;
    }
  }

  const endpoint = config.url || process.env.LOGCORE_URL || 'https://logcore-dev-352942961463.us-east4.run.app';
  const url = endpoint.endsWith('/v1/logs')
    ? endpoint
    : `${endpoint.replace(/\/+$/, '')}/v1/logs`;
  const apiKey = config.key || process.env.LOGCORE_KEY || '';

  const maxRetries = config.maxRetries !== undefined ? config.maxRetries : 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await sendHttpRequest(url, apiKey, envelope);
      if (response.status >= 200 && response.status < 300) {
        return true;
      }

      // 429 or 5xx: retry with exponential backoff
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 250;
          await new Promise(r => setTimeout(r, delay));
          continue;
        } else {
          process.stderr.write(
            `[logcore] Delivery failed with status ${response.status} after ${maxRetries} retries: ${response.body}\n`,
          );
          return false;
        }
      }

      // Permanent rejection: other 4xx status codes
      process.stderr.write(
        `[logcore] Permanent rejection (${response.status}): ${response.body}\n`,
      );
      return false;
    } catch (netErr: any) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 250;
        await new Promise(r => setTimeout(r, delay));
        continue;
      } else {
        process.stderr.write(
          `[logcore] Network error after ${maxRetries} retries: ${netErr?.message || String(netErr)}\n`,
        );
        return false;
      }
    }
  }
  return false;
}

export class LogcoreTransport {
  private buffer: LogEntry[] = [];
  private consecutiveFailures = 0;
  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private config: LogcoreConfig;

  constructor(config: LogcoreConfig = {}) {
    this.config = config;
    this.startTimer();
  }

  public updateConfig(config: LogcoreConfig) {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): LogcoreConfig {
    return this.config;
  }

  private startTimer() {
    const interval = this.config.flushIntervalMs || 5000;
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, interval);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  public getIngestUrl(): string {
    const endpoint = this.config.url || process.env.LOGCORE_URL || 'https://logcore-dev-352942961463.us-east4.run.app';
    return endpoint.endsWith('/v1/logs')
      ? endpoint
      : `${endpoint.replace(/\/+$/, '')}/v1/logs`;
  }

  public enqueue(entry: LogEntry): void {
    const enabled =
      this.config.enabled !== undefined
        ? this.config.enabled
        : process.env.LOGCORE_ENABLED !== 'false';
    if (!enabled) {
      return;
    }

    const minSeverity =
      this.config.minSeverity ||
      (process.env.LOGCORE_MIN_SEVERITY as LogSeverity) ||
      'ERROR';
    if (!isSeverityAboveFloor(entry.severity, minSeverity)) {
      return;
    }

    if (this.consecutiveFailures >= 10) {
      this.buffer = [];
      return;
    }

    const maxBuf = this.config.maxBufferSize || 1000;
    while (this.buffer.length >= maxBuf) {
      this.buffer.shift();
    }

    this.buffer.push(entry);

    const batchThreshold = this.config.batchSize || 20;
    if (this.buffer.length >= batchThreshold) {
      this.flush().catch(() => {});
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }
    this.isFlushing = true;
    try {
      while (this.buffer.length > 0) {
        if (this.consecutiveFailures >= 10) {
          this.buffer = [];
          break;
        }
        const batch = this.buffer.splice(0, 200);
        const success = await flushBatch(batch, this.config);
        if (success) {
          this.consecutiveFailures = 0;
        } else {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= 10) {
            this.buffer = [];
            process.stderr.write(
              '[logcore] Circuit breaker tripped after 10 consecutive flush failures. Buffer dropped.\n',
            );
            break;
          }
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  public async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
