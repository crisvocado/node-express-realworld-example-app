import { installConsoleInterceptor, uninstall } from './console-interceptor';
import { getTransport, LogcoreTransport } from './transport';
import { LogcoreConfig } from './types';

export * from './types';
export * from './config';
export * from './stack-parser';
export * from './insert-id';
export * from './trace';
export * from './transport';
export * from './console-interceptor';
export * from './middleware';

export function initLogcore(config?: Partial<LogcoreConfig>): {
  uninstall: () => void;
  flush: () => Promise<void>;
  transport: LogcoreTransport;
} {
  const transport = getTransport();
  if (config) {
    transport.updateConfig(config);
  }
  const uninstallFn = installConsoleInterceptor();
  return {
    uninstall: uninstallFn,
    flush: () => transport.flush(),
    transport,
  };
}
