import * as util from 'util';
import { getTransport } from './transport';
import { parseError } from './stack-parser';
import { computeInsertId } from './insert-id';
import { getCurrentTrace } from './trace';
import { LogcoreEntry } from './types';

let originalConsoleError: ((...args: any[]) => void) | null = null;
let isInstalled = false;
let uncaughtHandler: ((err: Error) => void) | null = null;
let unhandledRejectionHandler: ((reason: unknown) => void) | null = null;
let exitHandler: (() => void) | null = null;
let sigintHandler: (() => void) | null = null;
let sigtermHandler: (() => void) | null = null;

export function installConsoleInterceptor(): () => void {
  if (isInstalled) {
    return uninstall;
  }

  originalConsoleError = console.error;
  const transport = getTransport();

  console.error = function (...args: any[]): void {
    try {
      // 1. Call original console.error to preserve existing application logging
      if (originalConsoleError) {
        originalConsoleError.apply(console, args);
      }

      // 2. Extract error object and context args
      let errorObj: Error | undefined;
      const contextArgs: unknown[] = [];
      const stringParts: string[] = [];

      for (const arg of args) {
        if (arg instanceof Error && !errorObj) {
          errorObj = arg;
        } else if (typeof arg === 'string') {
          stringParts.push(arg);
        } else {
          contextArgs.push(arg);
        }
      }

      const formattedMessage =
        stringParts.length > 0
          ? stringParts.join(' ')
          : errorObj
          ? errorObj.message || String(errorObj)
          : util.format(...args);

      const parsedErr = errorObj ? parseError(errorObj) : undefined;
      const config = transport.getConfig();
      const timestamp = new Date().toISOString();
      const severity = 'ERROR';
      const service = config.service;
      const env = config.env;

      let context: Record<string, unknown> | undefined;
      if (
        contextArgs.length === 1 &&
        typeof contextArgs[0] === 'object' &&
        contextArgs[0] !== null &&
        !Array.isArray(contextArgs[0])
      ) {
        context = contextArgs[0] as Record<string, unknown>;
      } else if (contextArgs.length > 0) {
        context = { args: contextArgs };
      }

      const insertId = computeInsertId(timestamp, service, severity, formattedMessage, context);
      const trace = getCurrentTrace();

      const entry: LogcoreEntry = {
        timestamp,
        severity,
        message: formattedMessage,
        service,
        env,
        insert_id: insertId,
      };

      if (trace) {
        entry.trace = trace;
      }
      if (parsedErr) {
        entry.error = parsedErr;
      }
      if (context) {
        entry.context = context;
      }

      transport.send(entry);
    } catch {
      // Never throw from console interceptor
    }
  };

  // Process lifecycle hooks
  uncaughtHandler = (err: Error) => {
    try {
      console.error(err);
      transport.flush().catch(() => {});
    } catch {}
  };

  unhandledRejectionHandler = (reason: unknown) => {
    try {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      console.error(err);
      transport.flush().catch(() => {});
    } catch {}
  };

  exitHandler = () => {
    try {
      transport.flush().catch(() => {});
    } catch {}
  };

  sigintHandler = () => {
    transport
      .flush()
      .finally(() => process.exit(0))
      .catch(() => process.exit(0));
  };

  sigtermHandler = () => {
    transport
      .flush()
      .finally(() => process.exit(0))
      .catch(() => process.exit(0));
  };

  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', unhandledRejectionHandler);
  process.on('beforeExit', exitHandler);
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  isInstalled = true;
  return uninstall;
}

export function uninstall(): void {
  if (!isInstalled) return;

  if (originalConsoleError) {
    console.error = originalConsoleError;
    originalConsoleError = null;
  }

  if (uncaughtHandler) {
    process.removeListener('uncaughtException', uncaughtHandler);
    uncaughtHandler = null;
  }
  if (unhandledRejectionHandler) {
    process.removeListener('unhandledRejection', unhandledRejectionHandler);
    unhandledRejectionHandler = null;
  }
  if (exitHandler) {
    process.removeListener('beforeExit', exitHandler);
    exitHandler = null;
  }
  if (sigintHandler) {
    process.removeListener('SIGINT', sigintHandler);
    sigintHandler = null;
  }
  if (sigtermHandler) {
    process.removeListener('SIGTERM', sigtermHandler);
    sigtermHandler = null;
  }

  const transport = getTransport();
  transport.stopTimer();

  isInstalled = false;
}
