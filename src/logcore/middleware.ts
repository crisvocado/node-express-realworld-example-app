import { Request, Response, NextFunction } from 'express';
import { parseTraceparent, generateTrace, logcoreStorage, getCurrentTrace } from './context';
import { getLogcoreTransport } from './transport';

export function logcoreRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const trace =
    parseTraceparent(
      req.headers['traceparent'] || req.headers['trace-parent'],
    ) || generateTrace();

  (req as Request & { trace?: unknown }).trace = trace;

  logcoreStorage.run({ trace }, () => {
    next();
  });
}

export function logcoreErrorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err) {
    const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
    const status = errObj ? (errObj.status || errObj.statusCode || errObj.errorCode) : undefined;
    const isClientError =
      typeof status === 'number' && status >= 400 && status < 500;

    if (!isClientError) {
      const trace = ((req as Request & { trace?: unknown })?.trace as unknown as ReturnType<typeof getCurrentTrace>) || getCurrentTrace();
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Internal Server Error';

      getLogcoreTransport().log({
        severity: 'ERROR',
        message,
        error: err instanceof Error ? err : undefined,
        trace,
      });
    }
  }
  next(err);
}
