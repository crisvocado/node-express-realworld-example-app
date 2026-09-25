import { StackFrame, ErrorDetail } from './types';

const FRAME_REGEXES = [
  // "    at async functionName (/path/to/file.ts:10:20)"
  /^\s*at\s+(?:async\s+)?(.+?)\s+\((?:file:\/\/)?(.+?):(\d+):(\d+)\)$/,
  // "    at /path/to/file.ts:10:20"
  /^\s*at\s+(?:async\s+)?(?:file:\/\/)?(.+?):(\d+):(\d+)$/,
  // "    at async functionName (<anonymous>)"
  /^\s*at\s+(?:async\s+)?(.+?)\s+\((<anonymous>|native)\)$/,
];

export function isInternalOrDependency(filePath: string): boolean {
  if (!filePath) return true;
  if (
    filePath === '<anonymous>' ||
    filePath === '<native>' ||
    filePath === 'native'
  ) {
    return true;
  }
  if (
    filePath.includes('/node_modules/') ||
    filePath.includes('\\node_modules\\')
  ) {
    return true;
  }
  if (
    filePath.startsWith('node:') ||
    filePath.startsWith('internal/') ||
    filePath.startsWith('(node:')
  ) {
    return true;
  }
  return false;
}

export function parseStackLine(line: string): StackFrame | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) {
    return null;
  }

  // Check Pattern 1: at fn (file:line:col)
  let match = FRAME_REGEXES[0].exec(line);
  if (match) {
    const fnName = match[1].trim();
    const file = match[2].trim();
    const lineNum = parseInt(match[3], 10) || 1;
    const colNum = parseInt(match[4], 10) || 1;
    return {
      function: fnName || '<anon>',
      file,
      line: lineNum,
      column: colNum,
      inApp: !isInternalOrDependency(file),
    };
  }

  // Check Pattern 2: at file:line:col
  match = FRAME_REGEXES[1].exec(line);
  if (match) {
    const file = match[1].trim();
    const lineNum = parseInt(match[2], 10) || 1;
    const colNum = parseInt(match[3], 10) || 1;
    return {
      function: '<anon>',
      file,
      line: lineNum,
      column: colNum,
      inApp: !isInternalOrDependency(file),
    };
  }

  // Check Pattern 3: at fn (<anonymous>)
  match = FRAME_REGEXES[2].exec(line);
  if (match) {
    const fnName = match[1].trim();
    const file = match[2].trim();
    return {
      function: fnName || '<anon>',
      file,
      line: 1,
      column: 1,
      inApp: false,
    };
  }

  return null;
}

export function parseStackTrace(stackString?: string): StackFrame[] {
  if (!stackString) return [];
  const lines = stackString.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const frame = parseStackLine(line);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

export function parseError(err: unknown): ErrorDetail {
  if (!err) {
    return {
      type: 'Error',
      message: 'Unknown error',
      stack: [],
    };
  }

  if (typeof err !== 'object') {
    return {
      type: 'Error',
      message: String(err),
      stack: [],
    };
  }

  const errorObj = err as any;
  const topType = errorObj.name || errorObj.constructor?.name || 'Error';
  const topMessage =
    typeof errorObj.message === 'string'
      ? errorObj.message
      : String(errorObj.message || topType);

  // Traverse cause chain to root
  const chain: any[] = [];
  let curr: any = errorObj;
  const visited = new Set<any>();

  while (curr && typeof curr === 'object' && !visited.has(curr)) {
    visited.add(curr);
    chain.push(curr);
    curr = curr.cause;
  }

  // Root cause frames go first
  const allFrames: StackFrame[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const errorInChain = chain[i];
    if (typeof errorInChain.stack === 'string') {
      const frames = parseStackTrace(errorInChain.stack);
      allFrames.push(...frames);
    }
  }

  // Clamp to at most 50 frames
  const clampedFrames = allFrames.slice(0, 50);

  return {
    type: String(topType),
    message: String(topMessage).slice(0, 65536),
    stack: clampedFrames,
  };
}
