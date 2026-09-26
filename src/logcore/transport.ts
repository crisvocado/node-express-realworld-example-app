import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { LogcoreEntry, LogcoreEnvelope, LogcoreConfig } from './types';
import { getLogcoreConfig } from './config';

export class LogcoreTransport {
  private config: LogcoreConfig;
  private queue: LogcoreEntry[] = [];
  private readonly maxBufferSize = 1000;
  private readonly batchSize = 20;
  private readonly maxBatchPerRequest = 200;
  private readonly flushIntervalMs = 5000;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 10;
  private isFlushing = false;
  private isCircuitOpen = false;

  constructor(config?: Partial<LogcoreConfig>) {
    this.config = { ...getLogcoreConfig(), ...config };
    this.startTimer();
  }

  public updateConfig(config: Partial<LogcoreConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): LogcoreConfig {
    return this.config;
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isSelfUrl(url: string): boolean {
    try {
      const targetUrl = new URL(url);
      const configUrl = new URL(this.config.url);
      return targetUrl.host === configUrl.host && targetUrl.pathname.startsWith('/v1/logs');
    } catch {
      return false;
    }
  }

  private shouldLogSeverity(severity: string): boolean {
    const severities = ['DEBUG', 'INFO', 'WARN', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
    const minSeverity = this.config.minSeverity || 'ERROR';
    const minIndex =
      severities.indexOf(minSeverity) !== -1
        ? severities.indexOf(minSeverity)
        : severities.indexOf('ERROR');
    const currIndex = severities.indexOf(severity.toUpperCase());
    if (currIndex === -1) {
      return severity.toUpperCase() === 'ERROR';
    }
    return currIndex >= minIndex;
  }

  public send(entry: LogcoreEntry): void {
    if (!this.config.enabled) return;
    if (!this.shouldLogSeverity(entry.severity)) return;
    if (this.isCircuitOpen) return;

    // Clamps
    if (entry.message && entry.message.length > 65536) {
      entry.message = entry.message.slice(0, 65536);
    }
    if (entry.labels) {
      const keys = Object.keys(entry.labels).slice(0, 32);
      const clampedLabels: Record<string, string> = {};
      for (const k of keys) {
        const val = String(entry.labels[k]);
        clampedLabels[k] = val.length > 1024 ? val.slice(0, 1024) : val;
      }
      entry.labels = clampedLabels;
    }
    if (entry.error && entry.error.stack && entry.error.stack.length > 50) {
      entry.error.stack = entry.error.stack.slice(0, 50);
    }

    // Buffer cap: drop oldest when full
    if (this.queue.length >= this.maxBufferSize) {
      this.queue.shift();
    }

    this.queue.push(entry);

    if (this.queue.length >= this.batchSize) {
      setImmediate(() => {
        this.flush().catch(() => {});
      });
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0 || this.isCircuitOpen) {
      return;
    }

    this.isFlushing = true;
    try {
      while (this.queue.length > 0 && !this.isCircuitOpen) {
        const batch = this.queue.splice(0, this.maxBatchPerRequest);
        if (batch.length === 0) break;

        const success = await this.sendBatchWithRetry(batch);
        if (!success) {
          break;
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendBatchWithRetry(batch: LogcoreEntry[], attempt = 0): Promise<boolean> {
    const envelope: LogcoreEnvelope = {
      schema_version: 1,
      entries: batch,
    };

    const payload = JSON.stringify(envelope);

    try {
      const result = await this.postPayload(payload);

      if (result.status >= 200 && result.status < 300) {
        this.consecutiveFailures = 0;
        return true;
      }

      // Permanent rejection on non-retryable 4xx (except 429)
      if (result.status >= 400 && result.status < 500 && result.status !== 429) {
        process.stderr.write(
          `[logcore] Permanent rejection (HTTP ${result.status}): ${result.body}\n`,
        );
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.tripCircuitBreaker();
        }
        return false;
      }

      // Retryable: 429 or 5xx
      if (attempt < 3) {
        const backoffMs = Math.pow(2, attempt) * 250;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.sendBatchWithRetry(batch, attempt + 1);
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.tripCircuitBreaker();
        }
        return false;
      }
    } catch {
      // Network error is retryable
      if (attempt < 3) {
        const backoffMs = Math.pow(2, attempt) * 250;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.sendBatchWithRetry(batch, attempt + 1);
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.tripCircuitBreaker();
        }
        return false;
      }
    }
  }

  private tripCircuitBreaker(): void {
    this.isCircuitOpen = true;
    this.queue = [];
    process.stderr.write(
      `[logcore] Circuit breaker tripped after ${this.maxConsecutiveFailures} consecutive failures. Transport disabled.\n`,
    );
  }

  private postPayload(payload: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      try {
        const baseUrl = this.config.url.replace(/\/+$/, '');
        const fullUrl = new URL(`${baseUrl}/v1/logs`);
        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload).toString(),
        };

        if (this.config.apiKey) {
          headers['x-api-key'] = this.config.apiKey;
        }

        const options: http.RequestOptions = {
          hostname: fullUrl.hostname,
          port: fullUrl.port || (isHttps ? 443 : 80),
          path: fullUrl.pathname + fullUrl.search,
          method: 'POST',
          headers,
          timeout: 5000,
        };

        const req = client.request(options, res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              body,
            });
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error('Request timed out'));
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

export function getTransport(): LogcoreTransport {
  if (!defaultTransport) {
    defaultTransport = new LogcoreTransport();
  }
  return defaultTransport;
}
