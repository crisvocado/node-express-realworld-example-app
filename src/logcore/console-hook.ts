import * as util from 'util';
import { captureError, captureLog } from './logger';

export function installConsoleHook(): () => void {
  const originalConsoleError = console.error;

  console.error = function (...args: any[]) {
    try {
      const errorArg = args.find((arg) => arg instanceof Error);
      const formatted = util.format(...args);

      if (errorArg) {
        captureError(errorArg, formatted);
      } else {
        captureLog('ERROR', formatted);
      }
    } catch {
      // Swallowing hook error so console.error never throws
    }

    originalConsoleError.apply(console, args);
  };

  return () => {
    console.error = originalConsoleError;
  };
}
