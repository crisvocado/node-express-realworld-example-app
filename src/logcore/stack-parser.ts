import { ErrorInfo, StackFrame } from './types';

/**
 * Traverses an Error's cause chain to find the root cause exception.
 */
export function extractRootError(err: any): Error {
  let current = err;
  while (current && current.cause && current.cause instanceof Error) {
    current = current.cause;
  }
  return current || err;
}

/**
 * Parses a V8 stack trace string into structured StackFrame objects.
 * Innermost frame is first (index 0).
 */
export function parseStackTrace(stackStr?: string): StackFrame[] {
  if (!stackStr || typeof stackStr !== 'string') {
    return [];
  }

  const lines = stackStr.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) {
      continue;
    }

    // Pattern 1: at functionName (path/to/file.ext:12:34) or at async functionName (path/to/file.ext:12:34)
    const parenMatch = trimmed.match(/^at\s+(?:async\s+)?(?:new\s+)?(?:Object\.)?(.*?)\s*\((.+?):(\d+):(\d+)\)$/);
    if (parenMatch) {
      const rawFn = parenMatch[1].trim();
      const file = parenMatch[2].trim();
      const lineNum = parseInt(parenMatch[3], 10);
      const colNum = parseInt(parenMatch[4], 10);

      let fnName = rawFn;
      if (!fnName || fnName === '<anonymous>' || fnName === 'Object.<anonymous>') {
        fnName = '<anon>';
      }

      const isInternal =
        file.startsWith('node:') ||
        file.startsWith('internal/') ||
        file.includes('node:internal') ||
        file.includes('(node:');
      const isNodeModules = file.includes('node_modules');
      const inApp = !isInternal && !isNodeModules;

      frames.push({
        function: fnName,
        file,
        line: isNaN(lineNum) ? 1 : lineNum,
        column: isNaN(colNum) ? 0 : colNum,
        inApp,
      });
      continue;
    }

    // Pattern 2: at path/to/file.ext:12:34 or at async path/to/file.ext:12:34
    const noParenMatch = trimmed.match(/^at\s+(?:async\s+)?(?:new\s+)?(?:Object\.)?(.+?):(\d+):(\d+)$/);
    if (noParenMatch) {
      const file = noParenMatch[1].trim();
      const lineNum = parseInt(noParenMatch[2], 10);
      const colNum = parseInt(noParenMatch[3], 10);

      const isInternal =
        file.startsWith('node:') ||
        file.startsWith('internal/') ||
        file.includes('node:internal') ||
        file.includes('(node:');
      const isNodeModules = file.includes('node_modules');
      const inApp = !isInternal && !isNodeModules;

      frames.push({
        function: '<anon>',
        file,
        line: isNaN(lineNum) ? 1 : lineNum,
        column: isNaN(colNum) ? 0 : colNum,
        inApp,
      });
      continue;
    }
  }

  return frames.slice(0, 50);
}

/**
 * Extracts ErrorInfo with parsed stack from an error object.
 */
export function parseError(err: any): ErrorInfo {
  if (!err) {
    return { type: 'Error', message: 'Unknown error' };
  }

  const root = extractRootError(err);
  const type =
    (root && root.name) ||
    (root && root.constructor && root.constructor.name) ||
    'Error';
  const message = (root && root.message) || String(root);
  const stack = parseStackTrace(
    root && root.stack ? root.stack : err && err.stack ? err.stack : '',
  );

  return {
    type,
    message,
    ...(stack.length > 0 ? { stack } : {}),
  };
}
