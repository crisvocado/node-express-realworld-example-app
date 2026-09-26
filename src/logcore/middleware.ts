import { Request, Response, NextFunction } from 'express';
import { parseTraceparent, createTrace, runWithTrace } from './trace';
import { LogcoreTrace } from './types';

export function logcoreMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const traceparentHeader = req.headers['traceparent'] || req.headers['x-trace-parent'];
    let trace: LogcoreTrace | undefined;

    if (typeof traceparentHeader === 'string') {
      trace = parseTraceparent(traceparentHeader);
    }

    if (!trace) {
      trace = createTrace(true);
    }

    runWithTrace(trace, () => {
      next();
    });
  } catch {
    next();
  }
}

export function logcoreErrorMiddleware(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    if (err) {
      console.error(err);
    }
  } catch {
    // Never fail in error middleware
  }
  next(err);
}
