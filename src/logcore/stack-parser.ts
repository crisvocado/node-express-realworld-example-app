import { ErrorPayload, StackFrame } from './types';

export function getRootError(err: Error): Error {
  let current: Error = err;
  const visited = new Set<Error>();
  visited.add(current);

  while (
    current &&
    (current as unknown as { cause?: unknown }).cause instanceof Error
  ) {
    const next = (current as unknown as { cause: Error }).cause;
    if (visited.has(next)) {
      break;
    }
    visited.add(next);
    current = next;
  }

  return current;
}

export function parseStackTrace(err: Error): StackFrame[] {
  const root = getRootError(err);
  const stack = root.stack || err.stack;
  if (!stack || typeof stack !== 'string') {
    return [];
  }

  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  // Matches V8 stack frames such as:
  // "    at functionName (/path/to/file.ts:12:34)"
  // "    at async functionName (/path/to/file.ts:12:34)"
  // "    at /path/to/file.ts:12:34"
  // "    at Module._compile (node:internal/modules/cjs/loader:1218:27)"
  const frameRegex = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/;

  for (const line of lines) {
    const match = line.match(frameRegex);
    if (match) {
      let funcName = '<anon>';
      let filePath = '';
      let lineNum = 0;
      let colNum = 0;

      if (match[1] !== undefined && match[2] !== undefined) {
        funcName = match[1].trim() || '<anon>';
        filePath = match[2].trim();
        lineNum = parseInt(match[3], 10);
        colNum = parseInt(match[4], 10);
      } else if (match[5] !== undefined) {
        filePath = match[5].trim();
        lineNum = parseInt(match[6], 10);
        colNum = parseInt(match[7], 10);
      }

      if (filePath) {
        if (
          funcName === 'Object.<anonymous>' ||
          funcName === '<anonymous>' ||
          funcName === 'null.<anonymous>'
        ) {
          funcName = '<anon>';
        }

        const isNodeInternal =
          filePath.startsWith('node:') ||
          filePath.startsWith('internal/') ||
          !filePath.includes('/') ||
          filePath === 'native';
        const isNodeModules = filePath.includes('node_modules');
        const inApp = !isNodeInternal && !isNodeModules;

        frames.push({
          function: funcName,
          file: filePath,
          line: isNaN(lineNum) ? 0 : lineNum,
          column: isNaN(colNum) ? 0 : colNum,
          inApp,
        });

        if (frames.length >= 50) {
          break;
        }
      }
    }
  }

  return frames;
}

export function formatErrorPayload(err: unknown): ErrorPayload | undefined {
  if (!err) {
    return undefined;
  }

  if (err instanceof Error) {
    const type = err.name || err.constructor?.name || 'Error';
    const message = err.message || String(err);
    const stack = parseStackTrace(err);

    return {
      type: type.slice(0, 256),
      message: message.slice(0, 65536),
      stack,
    };
  }

  if (typeof err === 'object') {
    const errObj = err as Record<string, unknown>;
    const type =
      errObj.name ||
      (errObj.constructor && errObj.constructor.name) ||
      'Error';
    const message = errObj.message || JSON.stringify(err);
    return {
      type: String(type).slice(0, 256),
      message: String(message).slice(0, 65536),
      stack: [],
    };
  }

  return {
    type: 'Error',
    message: String(err).slice(0, 65536),
    stack: [],
  };
}
