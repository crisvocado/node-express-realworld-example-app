import { installConsoleHook } from './console-hook';
import { installGlobalHandlers } from './global-handlers';
import { flushTransport } from './transport';

let initialized = false;
let cleanupHooks: (() => void)[] = [];

export function initLogcore(): () => void {
  if (initialized) {
    return cleanup;
  }
  initialized = true;

  const uninstallConsole = installConsoleHook();
  const uninstallGlobals = installGlobalHandlers();

  cleanupHooks = [uninstallConsole, uninstallGlobals];

  return cleanup;
}

export function cleanup(): void {
  for (const fn of cleanupHooks) {
    try {
      fn();
    } catch {
      // Ignore cleanup error
    }
  }
  cleanupHooks = [];
  flushTransport().catch(() => {});
  initialized = false;
}

export {
  traceContextMiddleware,
  errorLoggingMiddleware,
} from './express-middleware';
export { captureError, captureLog } from './logger';
export { flushTransport, getTransport } from './transport';
export * from './types';
