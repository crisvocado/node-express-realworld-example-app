import { Request, Response, NextFunction } from 'express';
import {
  logContextStorage,
  parseTraceparent,
  generateTraceContext,
} from './context';
import { captureError } from './logger';

export function traceContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const trace =
    parseTraceparent(req.headers['traceparent'] as string) ||
    generateTraceContext();

  logContextStorage.run(
    {
      trace,
      context: {
        http: {
          method: req.method,
          path: req.path || req.url,
        },
      },
    },
    () => {
      next();
    },
  );
}

export function errorLoggingMiddleware(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const status = err?.status || err?.statusCode || err?.errorCode || 500;
    // Log 5xx server errors or untyped unhandled exceptions
    if (typeof status !== 'number' || status >= 500) {
      captureError(err, undefined, undefined, {
        http: {
          method: req.method,
          url: req.originalUrl || req.url,
          statusCode: status,
        },
      });
    }
  } catch {
    // Error logging must never interrupt request lifecycle
  }
  next(err);
}
