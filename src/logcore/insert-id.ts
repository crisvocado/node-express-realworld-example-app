import * as crypto from 'crypto';

function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(',') + '}';
}

export function computeInsertId(
  timestamp: string,
  service: string,
  severity: string,
  message: string,
  context?: Record<string, unknown>
): string {
  const contextStr = context ? canonicalize(context) : '';
  const payload = `${timestamp}|${service}|${severity}|${message}|${contextStr}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
