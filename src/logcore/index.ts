import { setupGlobalHandlers } from './global';
import { createLogEntry, LogcoreTransport } from './transport';
import {
  LogcoreConfig,
  LogEntry,
  LogSeverity,
  TraceContext,
} from './types';

let transportInstance: LogcoreTransport | null = null;
let globalCleanup: (() => void) | null = null;

/**
 * Initializes logcore structured logging.
 */
export function initLogcore(config: LogcoreConfig = {}): LogcoreTransport {
  if (!transportInstance) {
    transportInstance = new LogcoreTransport(config);
    globalCleanup = setupGlobalHandlers();
  } else {
    transportInstance.updateConfig(config);
  }
  return transportInstance;
}

/**
 * Gets the current transport instance or initializes default.
 */
export function getTransport(): LogcoreTransport {
  if (!transportInstance) {
    transportInstance = new LogcoreTransport();
    globalCleanup = setupGlobalHandlers();
  }
  return transportInstance;
}

/**
 * Captures an error and sends it to logcore structured logging.
 */
export function captureError(
  error: any,
  options: {
    req?: any;
    trace?: TraceContext;
    labels?: Record<string, string>;
    context?: Record<string, any>;
  } = {},
): LogEntry {
  try {
    const transport = getTransport();
    let trace = options.trace;
    if (!trace && options.req && (options.req as any).traceContext) {
      trace = (options.req as any).traceContext;
    }

    const entry = createLogEntry('', 'ERROR', {
      error,
      trace,
      labels: options.labels,
      context: options.context,
      config: transport.getConfig(),
    });

    transport.enqueue(entry);
    return entry;
  } catch {
    // Swallowed: Logging must never crash the host application
    return null as any;
  }
}

/**
 * Captures a structured log message.
 */
export function captureLog(
  message: string,
  severity: LogSeverity = 'INFO',
  options: {
    error?: any;
    trace?: TraceContext;
    labels?: Record<string, string>;
    context?: Record<string, any>;
  } = {},
): LogEntry {
  try {
    const transport = getTransport();
    const entry = createLogEntry(message, severity, {
      error: options.error,
      trace: options.trace,
      labels: options.labels,
      context: options.context,
      config: transport.getConfig(),
    });

    transport.enqueue(entry);
    return entry;
  } catch {
    return null as any;
  }
}

/**
 * Flushes all pending log batches.
 */
export async function flushLogcore(): Promise<void> {
  if (transportInstance) {
    await transportInstance.flush();
  }
}

/**
 * Closes the transport and uninstalls global handlers.
 */
export async function closeLogcore(): Promise<void> {
  if (globalCleanup) {
    globalCleanup();
    globalCleanup = null;
  }
  if (transportInstance) {
    await transportInstance.close();
    transportInstance = null;
  }
}

export * from './types';
export * from './canonical-json';
export * from './stack-parser';
export * from './trace';
export * from './transport';
export * from './middleware';
export * from './global';
