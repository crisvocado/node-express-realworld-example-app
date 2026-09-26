import { LogcoreStackFrame, LogcoreError } from './types';

function isInApp(filePath: string): boolean {
  if (!filePath || filePath === '<unknown>' || filePath === '<anonymous>') {
    return false;
  }
  if (
    filePath.startsWith('node:') ||
    filePath.startsWith('internal/') ||
    filePath.startsWith('node_modules/')
  ) {
    return false;
  }
  if (filePath.includes('/node_modules/') || filePath.includes('\\node_modules\\')) {
    return false;
  }
  return true;
}

function parseFrameLine(line: string): LogcoreStackFrame | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) {
    return null;
  }

  // Pattern 1: at funcName (/path/to/file.ts:10:5) or at async funcName (/path/to/file.ts:10:5)
  const parenMatch = /^\s*at\s+(?:async\s+)?(.+?)\s+\((.+?):(\d+):(\d+)\)$/.exec(trimmed);
  if (parenMatch) {
    const rawFn = parenMatch[1].trim();
    const file = parenMatch[2].trim();
    const lineNum = parseInt(parenMatch[3], 10) || 0;
    const colNum = parseInt(parenMatch[4], 10) || 0;
    const fnName =
      rawFn === '<anonymous>' || rawFn === 'Object.<anonymous>' || !rawFn ? '<anon>' : rawFn;
    return {
      function: fnName,
      file,
      line: lineNum,
      column: colNum,
      inApp: isInApp(file),
    };
  }

  // Pattern 2: at /path/to/file.ts:10:5 or at async /path/to/file.ts:10:5
  const directMatch = /^\s*at\s+(?:async\s+)?(.+?):(\d+):(\d+)$/.exec(trimmed);
  if (directMatch) {
    const file = directMatch[1].trim();
    const lineNum = parseInt(directMatch[2], 10) || 0;
    const colNum = parseInt(directMatch[3], 10) || 0;
    return {
      function: '<anon>',
      file,
      line: lineNum,
      column: colNum,
      inApp: isInApp(file),
    };
  }

  // Pattern 3: at funcName (native) or other non-file frames
  const nativeMatch = /^\s*at\s+(?:async\s+)?(.+?)(?:\s+\((.+?)\))?$/.exec(trimmed);
  if (nativeMatch) {
    const rawFn = nativeMatch[1].trim();
    const file = nativeMatch[2] ? nativeMatch[2].trim() : '<unknown>';
    const fnName =
      rawFn === '<anonymous>' || rawFn === 'Object.<anonymous>' || !rawFn ? '<anon>' : rawFn;
    return {
      function: fnName,
      file,
      line: 0,
      column: 0,
      inApp: isInApp(file),
    };
  }

  return null;
}

export function parseStackTrace(err: Error): LogcoreStackFrame[] {
  const frames: LogcoreStackFrame[] = [];

  // Traverse the cause chain to root first, so root/innermost error frames come first
  const causeChain: Error[] = [];
  let curr: unknown = (err as any).cause;
  while (curr instanceof Error && !causeChain.includes(curr)) {
    causeChain.unshift(curr);
    curr = (curr as any).cause;
  }

  for (const causeErr of causeChain) {
    if (typeof causeErr.stack === 'string') {
      const lines = causeErr.stack.split('\n');
      for (const line of lines) {
        const frame = parseFrameLine(line);
        if (frame) {
          frames.push(frame);
          if (frames.length >= 50) break;
        }
      }
    }
  }

  // Add the raised error's own frames
  if (frames.length < 50 && typeof err.stack === 'string') {
    const lines = err.stack.split('\n');
    for (const line of lines) {
      const frame = parseFrameLine(line);
      if (frame) {
        frames.push(frame);
        if (frames.length >= 50) break;
      }
    }
  }

  return frames.slice(0, 50);
}

export function parseError(err: unknown): LogcoreError | undefined {
  if (!(err instanceof Error)) {
    return undefined;
  }

  const stack = parseStackTrace(err);
  return {
    type: err.name || 'Error',
    message: err.message || String(err),
    stack,
  };
}
