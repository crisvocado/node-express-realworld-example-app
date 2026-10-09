import * as util from 'util';
import { LogSeverity } from './types';
import { parseError } from './stack-parser';
import { getTraceContext } from './trace';
import { enqueueLog, flushLogs, setCustomSender } from './transport';
import { logcoreMiddleware, logcoreErrorMiddleware } from './middleware';

let isHooked = false;
let isLoggingInternal = false;
let initialized = false;

function handleConsole(severity: LogSeverity, args: unknown[]) {
  if (args.length === 0) return;

  let errorObj: ReturnType<typeof parseError>;
  let firstError: Error | undefined;

  for (const arg of args) {
    if (arg instanceof Error) {
      firstError = arg;
      break;
    }
  }

  if (firstError) {
    errorObj = parseError(firstError);
  }

  let message = '';
  if (args.length === 1 && args[0] instanceof Error) {
    message = args[0].message || 'Error';
  } else {
    message = util.format(...args);
  }

  const trace = getTraceContext();

  enqueueLog({
    severity,
    message: message || (errorObj ? errorObj.message : 'Error'),
    error: errorObj,
    trace,
  });
}

export function hookConsole(): () => void {
  if (isHooked) {
    return () => {
      // unhook if needed
    };
  }
  isHooked = true;

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  console.error = function (...args: unknown[]) {
    originalConsoleError.apply(console, args);

    if (isLoggingInternal) return;
    try {
      isLoggingInternal = true;
      handleConsole('ERROR', args);
    } catch (_) {
      // Never throw from logger hook
    } finally {
      isLoggingInternal = false;
    }
  };

  console.warn = function (...args: unknown[]) {
    originalConsoleWarn.apply(console, args);

    if (isLoggingInternal) return;
    try {
      isLoggingInternal = true;
      handleConsole('WARNING', args);
    } catch (_) {
      // Never throw from logger hook
    } finally {
      isLoggingInternal = false;
    }
  };

  return () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    isHooked = false;
  };
}

function registerProcessHooks(): void {
  process.on('uncaughtException', (err) => {
    try {
      const errorObj = parseError(err);
      enqueueLog({
        severity: 'CRITICAL',
        message: err instanceof Error ? err.message : String(err),
        error: errorObj,
        trace: getTraceContext(),
      });
      flushLogs().catch(() => {
        // ignore
      });
    } catch (_) {
      // ignore
    }
  });

  process.on('unhandledRejection', (reason) => {
    try {
      const errorObj = parseError(reason);
      enqueueLog({
        severity: 'ERROR',
        message: reason instanceof Error ? reason.message : `Unhandled rejection: ${reason}`,
        error: errorObj,
        trace: getTraceContext(),
      });
    } catch (_) {
      // ignore
    }
  });

  process.on('beforeExit', () => {
    flushLogs().catch(() => {
      // ignore
    });
  });
}

export function initLogcore(): void {
  if (initialized) return;
  initialized = true;
  hookConsole();
  registerProcessHooks();
}

export {
  logcoreMiddleware,
  logcoreErrorMiddleware,
  flushLogs,
  setCustomSender,
};
export * from './types';
export * from './trace';
