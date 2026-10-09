import { Request, Response, NextFunction } from 'express';
import { runWithTrace, parseTraceparent, getTraceContext } from './trace';
import { parseError } from './stack-parser';
import { enqueueLog } from './transport';

export function logcoreMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceparent = req.headers['traceparent'];
  const trace = parseTraceparent(traceparent);
  if (trace) {
    runWithTrace(trace, () => next());
  } else {
    next();
  }
}

export function logcoreErrorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    if (err) {
      const errRecord = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
      const statusCode =
        Number(errRecord.status) ||
        Number(errRecord.statusCode) ||
        Number(errRecord.errorCode) ||
        500;

      const message =
        typeof errRecord.message === 'string'
          ? errRecord.message
          : err instanceof Error
          ? err.message
          : String(err);

      const errorObj = parseError(err);
      const trace = getTraceContext();

      enqueueLog({
        severity: 'ERROR',
        message: message || 'Unhandled error',
        error: errorObj,
        trace,
        context: {
          http: {
            method: req.method,
            url: req.originalUrl || req.url,
            status_code: statusCode,
          },
        },
      });
    }
  } catch (_) {
    // Suppress error in middleware
  }

  next(err);
}
