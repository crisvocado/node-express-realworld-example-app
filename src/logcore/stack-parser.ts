import { ErrorObject, StackFrame } from './types';

const STACK_LINE_REGEX_1 = /^\s*at\s+(?:async\s+)?(?:new\s+)?([^(\s]+(?:\s+\[as\s+[^\]]+\])?)\s+\((.+):(\d+):(\d+)\)$/;
const STACK_LINE_REGEX_2 = /^\s*at\s+(?:async\s+)?(?:new\s+)?(.+):(\d+):(\d+)$/;
const STACK_LINE_REGEX_3 = /^\s*at\s+(.+)$/;

function parseFrameLine(line: string): StackFrame | null {
  const match1 = STACK_LINE_REGEX_1.exec(line);
  if (match1) {
    const fnName = match1[1] || '<anonymous>';
    const file = match1[2];
    const lineNum = parseInt(match1[3], 10);
    const colNum = parseInt(match1[4], 10);
    const inApp = !file.includes('node_modules') && !file.startsWith('node:') && !file.startsWith('internal/');
    return {
      function: fnName.slice(0, 256),
      file: file.slice(0, 1024),
      line: isNaN(lineNum) ? null : lineNum,
      column: isNaN(colNum) ? null : colNum,
      inApp,
    };
  }

  const match2 = STACK_LINE_REGEX_2.exec(line);
  if (match2) {
    const file = match2[1];
    const lineNum = parseInt(match2[2], 10);
    const colNum = parseInt(match2[3], 10);
    const inApp = !file.includes('node_modules') && !file.startsWith('node:') && !file.startsWith('internal/');
    return {
      function: '<anonymous>',
      file: file.slice(0, 1024),
      line: isNaN(lineNum) ? null : lineNum,
      column: isNaN(colNum) ? null : colNum,
      inApp,
    };
  }

  const match3 = STACK_LINE_REGEX_3.exec(line);
  if (match3) {
    const fnName = match3[1].trim();
    return {
      function: fnName.slice(0, 256) || '<anonymous>',
      file: null,
      line: null,
      column: null,
      inApp: false,
    };
  }

  return null;
}

export function parseStackTrace(stackStr?: string): StackFrame[] {
  if (!stackStr || typeof stackStr !== 'string') return [];
  const lines = stackStr.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    if (!line.trim().startsWith('at ')) continue;
    const frame = parseFrameLine(line);
    if (frame) {
      frames.push(frame);
      if (frames.length >= 50) break;
    }
  }

  return frames;
}

export function parseError(err: unknown): ErrorObject | undefined {
  if (!err) return undefined;

  if (err instanceof Error) {
    // Traverse cause chain to root
    const chain: Error[] = [err];
    let current: unknown = (err as { cause?: unknown }).cause;
    while (current instanceof Error && !chain.includes(current)) {
      chain.push(current);
      current = (current as { cause?: unknown }).cause;
    }

    // Root cause frames first
    const allFrames: StackFrame[] = [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const e = chain[i];
      if (e.stack) {
        const frames = parseStackTrace(e.stack);
        for (const f of frames) {
          if (allFrames.length < 50) {
            allFrames.push(f);
          }
        }
      }
    }

    const type = (err.name || err.constructor?.name || 'Error').slice(0, 256);
    const message = (err.message || String(err)).slice(0, 65536);

    const errorObj: ErrorObject = {
      type,
      message,
    };

    if (allFrames.length > 0) {
      errorObj.stack = allFrames;
    }

    return errorObj;
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const type = (typeof record.name === 'string' ? record.name : 'Error').slice(0, 256);
    const message = (typeof record.message === 'string' ? record.message : JSON.stringify(err)).slice(0, 65536);
    const stackStr = typeof record.stack === 'string' ? record.stack : undefined;
    const stack = stackStr ? parseStackTrace(stackStr) : undefined;

    return {
      type,
      message,
      ...(stack && stack.length > 0 ? { stack } : {}),
    };
  }

  return {
    type: 'Error',
    message: String(err).slice(0, 65536),
  };
}
