import { Request, Response, NextFunction } from 'express';
import { formatTraceparent, generateTrace, parseTraceparent, traceStorage } from './trace';
import { captureError } from './index';

/**
 * Express middleware for W3C traceparent propagation and async context binding.
 */
export function logcoreMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawTraceparent = req.headers['traceparent'] as string | undefined;
    const trace = parseTraceparent(rawTraceparent) || generateTrace(true);

    (req as any).traceContext = trace;
    res.setHeader('traceparent', formatTraceparent(trace));

    traceStorage.run(trace, () => {
      next();
    });
  };
}

/**
 * Express error handling middleware to capture server errors to logcore.
 */
export function logcoreErrorMiddleware() {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    try {
      // Handled client errors (< 500) like 401 Unauthorized or 422 Validation errors are not server faults
      const statusCode = err && (err.errorCode || err.status || err.statusCode);
      const isClientError = typeof statusCode === 'number' && statusCode < 500;

      if (!isClientError) {
        captureError(err, {
          req,
          context: {
            http: {
              method: req.method,
              url: req.originalUrl || req.url,
              statusCode: statusCode || 500,
            },
          },
        });
      }
    } catch {
      // Swallowed: Logging failures must never impact application execution
    }
    next(err);
  };
}
