import { LogcoreTransport } from './transport';
import { getCurrentTrace } from './context';

export function installProcessHandlers(
  transport: LogcoreTransport,
): () => void {
  const onUncaughtException = (error: Error) => {
    try {
      transport.log({
        severity: 'ERROR',
        message: error?.message || 'Uncaught Exception',
        error,
        trace: getCurrentTrace(),
      });
      // Best-effort flush before exit
      transport.flush().catch(() => {});
    } catch {
      // Swallowed
    }
  };

  const onUnhandledRejection = (reason: unknown) => {
    try {
      const isErr = reason instanceof Error;
      const message = isErr
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : 'Unhandled Rejection';
      transport.log({
        severity: 'ERROR',
        message,
        error: reason,
        trace: getCurrentTrace(),
      });
      transport.flush().catch(() => {});
    } catch {
      // Swallowed
    }
  };

  const onExit = () => {
    try {
      transport.flush().catch(() => {});
    } catch {
      // Swallowed
    }
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);
  process.on('beforeExit', onExit);
  process.on('SIGTERM', onExit);
  process.on('SIGINT', onExit);

  return () => {
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
    process.removeListener('beforeExit', onExit);
    process.removeListener('SIGTERM', onExit);
    process.removeListener('SIGINT', onExit);
  };
}

export function installConsoleHook(
  transport: LogcoreTransport,
): () => void {
  const originalError = console.error;
  let isHandling = false;

  console.error = function (...args: unknown[]) {
    if (process.env.LOGCORE_SILENT_CONSOLE !== 'true') {
      try {
        originalError.apply(console, args);
      } catch {
        // Safe execution of original console.error
      }
    }

    if (isHandling) {
      return;
    }

    try {
      isHandling = true;

      let extractedError: unknown = undefined;
      const messageParts: string[] = [];

      for (const arg of args) {
        if (arg instanceof Error) {
          if (!extractedError) {
            extractedError = arg;
          }
          messageParts.push(arg.message || String(arg));
        } else if (typeof arg === 'object' && arg !== null) {
          const obj = arg as Record<string, unknown>;
          if (!extractedError && (obj.name || obj.message || obj.stack)) {
            extractedError = arg;
          }
          try {
            messageParts.push(JSON.stringify(arg));
          } catch {
            messageParts.push(String(arg));
          }
        } else {
          messageParts.push(String(arg));
        }
      }

      const message =
        messageParts.join(' ').trim() ||
        (extractedError instanceof Error ? extractedError.message : 'Error event');

      transport.log({
        severity: 'ERROR',
        message,
        error: extractedError,
        trace: getCurrentTrace(),
      });
    } catch {
      // Swallowed to prevent disruption
    } finally {
      isHandling = false;
    }
  };

  return () => {
    console.error = originalError;
  };
}
