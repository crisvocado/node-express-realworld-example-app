import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { LogEntry, RequestEnvelope, LogcoreConfig } from './types';
import { getConfig } from './config';

export class HttpTransport {
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private config: LogcoreConfig;
  private readonly maxBufferSize = 1000;
  private readonly batchThreshold = 20;
  private readonly maxRequestSize = 200;
  private readonly flushIntervalMs = 5000;
  private readonly maxRetries = 3;
  private readonly circuitBreakerThreshold = 10;

  constructor(config?: LogcoreConfig) {
    this.config = config || getConfig();
    this.startFlushTimer();
  }

  public getIngestUrl(): string {
    let baseUrl = this.config.url.trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    if (!baseUrl.endsWith('/v1/logs')) {
      baseUrl = `${baseUrl}/v1/logs`;
    }
    return baseUrl;
  }

  public enqueue(entry: LogEntry): void {
    if (!this.config.enabled) {
      return;
    }

    if (this.buffer.length >= this.maxBufferSize) {
      // Drop oldest entry when buffer reaches cap
      this.buffer.shift();
    }

    this.buffer.push(entry);

    if (this.buffer.length >= this.batchThreshold) {
      this.flush().catch(() => {
        // Internal errors never propagate
      });
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush().catch(() => {});
      }
    }, this.flushIntervalMs);
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  public stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    if (this.circuitOpen) {
      this.buffer = [];
      return;
    }

    this.isFlushing = true;

    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.maxRequestSize);
        const success = await this.sendBatchWithRetry(batch);

        if (!success) {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
            this.circuitOpen = true;
            this.buffer = [];
            process.stderr.write(
              `[logcore] Circuit breaker tripped after ${this.consecutiveFailures} consecutive failed flushes. Emptying buffer.\n`,
            );
          }
          break;
        } else {
          this.consecutiveFailures = 0;
          this.circuitOpen = false;
        }
      }
    } catch {
      // Catch-all to never break caller
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendBatchWithRetry(entries: LogEntry[]): Promise<boolean> {
    if (entries.length === 0) return true;

    const payload: RequestEnvelope = {
      schema_version: 1,
      entries,
    };
    const bodyString = JSON.stringify(payload);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.postRequest(bodyString);

        if (result.status >= 200 && result.status < 300) {
          return true;
        }

        // 4xx other than 429: permanent rejection, do not retry
        if (
          result.status >= 400 &&
          result.status < 500 &&
          result.status !== 429
        ) {
          process.stderr.write(
            `[logcore] HTTP ${result.status} permanent rejection: ${result.body}\n`,
          );
          return false;
        }

        // 5xx or 429: retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delayMs = Math.pow(2, attempt) * 250;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (err: any) {
        // Network errors are retryable
        if (attempt < this.maxRetries) {
          const delayMs = Math.pow(2, attempt) * 250;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          process.stderr.write(
            `[logcore] Network error delivering logs: ${
              err?.message || err
            }\n`,
          );
          return false;
        }
      }
    }

    return false;
  }

  private postRequest(
    body: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      try {
        const ingestUrl = this.getIngestUrl();
        const parsedUrl = new url.URL(ingestUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers: Record<string, string | number> = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body, 'utf8'),
        };

        if (this.config.apiKey) {
          headers['x-api-key'] = this.config.apiKey;
        }

        const options: http.RequestOptions = {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method: 'POST',
          headers,
          timeout: 10000,
        };

        const req = client.request(options, (res) => {
          let responseBody = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            responseBody += chunk;
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              body: responseBody,
            });
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error('Request timed out'));
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

let defaultTransport: HttpTransport | null = null;

export function getTransport(): HttpTransport {
  if (!defaultTransport) {
    defaultTransport = new HttpTransport();
  }
  return defaultTransport;
}

export function flushTransport(): Promise<void> {
  if (defaultTransport) {
    return defaultTransport.flush();
  }
  return Promise.resolve();
}
