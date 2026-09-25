import { captureError } from './logger';
import { flushTransport } from './transport';

export function installGlobalHandlers(): () => void {
  const onUncaughtException = (error: Error) => {
    try {
      captureError(
        error,
        `Uncaught Exception: ${error?.message || String(error)}`,
      );
      flushTransport().catch(() => {});
    } catch {
      // Swallow
    }
  };

  const onUnhandledRejection = (reason: unknown) => {
    try {
      if (reason instanceof Error) {
        captureError(
          reason,
          `Unhandled Rejection: ${reason.message}`,
        );
      } else {
        captureError(
          new Error(String(reason)),
          `Unhandled Rejection: ${String(reason)}`,
        );
      }
      flushTransport().catch(() => {});
    } catch {
      // Swallow
    }
  };

  const onExit = () => {
    flushTransport().catch(() => {});
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
