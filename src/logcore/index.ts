import { LogcoreConfig } from './types';
import { loadLogcoreConfig } from './config';
import { getLogcoreTransport, LogcoreTransport } from './transport';
import { installConsoleHook, installProcessHandlers } from './handlers';

export * from './types';
export * from './config';
export * from './context';
export * from './stack-parser';
export * from './transport';
export * from './handlers';
export * from './middleware';

let isInitialized = false;
let cleanupFns: Array<() => void> = [];

export function initLogcore(
  customConfig?: Partial<LogcoreConfig>,
): { uninstall: () => void; transport: LogcoreTransport } {
  const config = loadLogcoreConfig(customConfig);
  const transport = getLogcoreTransport(config);

  if (!isInitialized) {
    const uninstallHandlers = installProcessHandlers(transport);
    const uninstallConsole = installConsoleHook(transport);

    cleanupFns = [uninstallHandlers, uninstallConsole];
    isInitialized = true;
  }

  return {
    transport,
    uninstall: () => {
      cleanupFns.forEach(fn => fn());
      cleanupFns = [];
      isInitialized = false;
    },
  };
}
