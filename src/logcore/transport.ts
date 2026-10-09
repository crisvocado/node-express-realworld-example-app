import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import {
  LogEntry,
  LogEnv,
  LogSeverity,
  LogcoreConfig,
  LogcoreEnvelope,
  TraceContext,
  ErrorObject,
} from './types';

const SEVERITY_ORDER: Record<LogSeverity, number> = {
  DEBUG: 100,
  INFO: 200,
  NOTICE: 300,
  WARNING: 400,
  ERROR: 500,
  CRITICAL: 600,
  ALERT: 700,
  EMERGENCY: 800,
};

function sanitizeServiceName(name?: string): string {
  if (!name) return 'node-express-app';
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  return sanitized.slice(0, 63) || 'node-express-app';
}

function normalizeEnv(env?: string): LogEnv {
  if (!env) return 'dev';
  const lower = env.toLowerCase().trim();
  if (lower === 'production' || lower === 'prod') return 'prod';
  if (lower === 'staging' || lower === 'stage') return 'staging';
  if (lower === 'development' || lower === 'dev') return 'dev';
  if (lower === 'test' || lower === 'testing') return 'test';
  if (lower === 'local') return 'local';
  return 'dev';
}

function normalizeSeverity(sev?: string): LogSeverity {
  if (!sev) return 'ERROR';
  const upper = sev.toUpperCase().trim() as LogSeverity;
  if (SEVERITY_ORDER[upper] !== undefined) {
    return upper;
  }
  return 'ERROR';
}

export function getConfig(): LogcoreConfig {
  const urlVal = process.env.LOGCORE_URL || 'https://logcore-dev-352942961463.us-east4.run.app';
  const keyVal = process.env.LOGCORE_KEY || '';
  const enabledVal = process.env.LOGCORE_ENABLED;
  const isEnabled = enabledVal !== undefined ? enabledVal.toLowerCase() === 'true' : Boolean(keyVal || urlVal);

  return {
    url: urlVal,
    key: keyVal,
    enabled: isEnabled,
    service: sanitizeServiceName(process.env.LOGCORE_SERVICE || 'node-express-realworld-example-app'),
    env: normalizeEnv(process.env.LOGCORE_ENV || process.env.NODE_ENV),
    minSeverity: normalizeSeverity(process.env.LOGCORE_MIN_SEVERITY || 'ERROR'),
  };
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return '{' + entries.join(',') + '}';
}

function computeInsertId(
  timestamp: string,
  service: string,
  severity: string,
  message: string,
  context?: Record<string, unknown>,
): string {
  const contextStr = context ? canonicalJson(context) : '';
  const payload = `${timestamp}|${service}|${severity}|${message}|${contextStr}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function sanitizeLabels(labels?: Record<string, string>): Record<string, string> | undefined {
  if (!labels || typeof labels !== 'object') return undefined;
  const result: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(labels)) {
    if (count >= 32) break;
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
      result[key] = String(value).slice(0, 1024);
      count++;
    }
  }
  return count > 0 ? result : undefined;
}

type CustomSender = (envelope: LogcoreEnvelope) => Promise<void> | void;

let customSender: CustomSender | null = null;
const buffer: LogEntry[] = [];
const BUFFER_CAP = 1000;
const BATCH_SIZE = 20;
const MAX_ENTRIES_PER_REQUEST = 200;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 10;
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;

export function setCustomSender(sender: CustomSender | null): void {
  customSender = sender;
}

function startTimerIfNeeded() {
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushLogs().catch(() => {
        // Suppress unhandled flush error
      });
    }, 5000);
    if (flushTimer.unref) {
      flushTimer.unref();
    }
  }
}

export function enqueueLog(input: {
  severity: LogSeverity;
  message: string;
  error?: ErrorObject | null;
  trace?: TraceContext | null;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
}): void {
  const config = getConfig();

  if ((SEVERITY_ORDER[input.severity] || 0) < (SEVERITY_ORDER[config.minSeverity] || 500)) {
    return;
  }

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !customSender) {
    // Circuit breaker open
    return;
  }

  const timestamp = new Date().toISOString();
  const message = (input.message || 'Error').slice(0, 65536);
  const insertId = computeInsertId(timestamp, config.service, input.severity, message, input.context);

  const entry: LogEntry = {
    timestamp,
    severity: input.severity,
    message,
    service: config.service,
    env: config.env,
    insert_id: insertId,
  };

  if (input.trace && input.trace.traceId) {
    entry.trace = {
      traceId: input.trace.traceId,
      ...(input.trace.spanId ? { spanId: input.trace.spanId } : {}),
      ...(input.trace.sampled !== undefined ? { sampled: input.trace.sampled } : {}),
    };
  }

  if (input.error && input.error.type && input.error.message) {
    entry.error = input.error;
  }

  const labels = sanitizeLabels(input.labels);
  if (labels) {
    entry.labels = labels;
  }

  if (input.context && Object.keys(input.context).length > 0) {
    entry.context = input.context;
  }

  if (buffer.length >= BUFFER_CAP) {
    buffer.shift(); // Drop oldest
  }

  buffer.push(entry);

  if (buffer.length >= BATCH_SIZE) {
    setImmediate(() => {
      flushLogs().catch(() => {
        // Suppress unhandled flush error
      });
    });
  } else {
    startTimerIfNeeded();
  }
}

function postJson(
  endpointUrl: string,
  apiKey: string,
  body: string,
  timeoutMs = 10000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new url.URL(endpointUrl);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(
        parsed,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let resBody = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            resBody += chunk;
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              body: resBody,
            });
          });
        },
      );

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy(new Error('Request timed out'));
      });

      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function sendBatchWithRetry(
  envelope: LogcoreEnvelope,
  config: LogcoreConfig,
): Promise<boolean> {
  const body = JSON.stringify(envelope);
  const base = config.url.replace(/\/+$/, '');
  const endpoint = base.endsWith('/v1/logs') ? base : `${base}/v1/logs`;

  let attempt = 0;
  const maxRetries = 3;

  while (attempt <= maxRetries) {
    try {
      const res = await postJson(endpoint, config.key, body, 10000);
      if (res.status >= 200 && res.status < 300) {
        return true;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 250;
          await new Promise((r) => setTimeout(r, delay));
          attempt++;
          continue;
        }
        return false;
      }

      // Permanent rejection on other 4xx
      process.stderr.write(`[logcore] Log submission rejected (${res.status}): ${res.body}\n`);
      return false;
    } catch (_) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 250;
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      return false;
    }
  }

  return false;
}

export async function flushLogs(): Promise<void> {
  if (isFlushing || buffer.length === 0) return;
  isFlushing = true;

  try {
    const config = getConfig();

    while (buffer.length > 0) {
      const batch = buffer.splice(0, MAX_ENTRIES_PER_REQUEST);
      const envelope: LogcoreEnvelope = {
        schema_version: 1,
        entries: batch,
      };

      if (customSender) {
        await customSender(envelope);
        consecutiveFailures = 0;
        continue;
      }

      if (!config.enabled || !config.key) {
        // Disabled or unconfigured; drop batch silently
        continue;
      }

      const success = await sendBatchWithRetry(envelope, config);
      if (success) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          buffer.length = 0; // Clear buffer
          process.stderr.write('[logcore] Circuit breaker triggered after 10 failed flushes\n');
        }
      }
    }
  } finally {
    isFlushing = false;
  }
}
