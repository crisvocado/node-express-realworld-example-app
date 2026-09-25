import { captureError, captureLog, flushLogcore } from './index';

let isInstalled = false;
let originalConsoleError: typeof console.error | null = null;
let isInternalLogging = false;

/**
 * Installs global error handlers and patches console.error.
 * Returns an uninstall cleanup function.
 */
export function setupGlobalHandlers(): () => void {
  if (isInstalled) {
    return () => {};
  }
  isInstalled = true;

  // Intercept console.error
  originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    try {
      if (originalConsoleError) {
        originalConsoleError.apply(console, args);
      }
      if (!isInternalLogging) {
        isInternalLogging = true;
        try {
          const firstArg = args[0];
          if (firstArg instanceof Error) {
            captureError(firstArg);
          } else {
            const message = args
              .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
              .join(' ');
            if (!message.startsWith('[logcore]')) {
              captureLog(message, 'ERROR');
            }
          }
        } finally {
          isInternalLogging = false;
        }
      }
    } catch {
      // Swallowed: Logging failures must never impact application execution
    }
  };

  const onUncaughtException = (err: Error) => {
    try {
      captureError(err);
      flushLogcore().catch(() => {});
    } catch {
      // Swallowed
    }
  };

  const onUnhandledRejection = (reason: any) => {
    try {
      if (reason instanceof Error) {
        captureError(reason);
      } else {
        captureLog(String(reason), 'ERROR');
      }
      flushLogcore().catch(() => {});
    } catch {
      // Swallowed
    }
  };

  const onShutdown = () => {
    flushLogcore().catch(() => {});
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);
  process.on('beforeExit', onShutdown);
  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);

  return function uninstall() {
    if (originalConsoleError) {
      console.error = originalConsoleError;
      originalConsoleError = null;
    }
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
    process.removeListener('beforeExit', onShutdown);
    process.removeListener('SIGTERM', onShutdown);
    process.removeListener('SIGINT', onShutdown);
    isInstalled = false;
  };
}
