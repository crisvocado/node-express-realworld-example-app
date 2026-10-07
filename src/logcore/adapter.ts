import { createHash } from 'crypto';

type LogcoreEntry = {
  timestamp: string;
  severity: 'ERROR' | 'CRITICAL' | 'ALERT' | 'EMERGENCY';
  message: string;
  service: string;
  env: 'prod' | 'staging' | 'dev' | 'test' | 'local';
  insert_id: string;
  error?: {
    type: string;
    message: string;
    stack?: Array<{
      function: string;
      file?: string | null;
      line?: number | null;
      column?: number | null;
      inApp?: boolean;
    }>;
  };
};

type Sender = (body: string, url: string, key: string) => void;

const severityRank: Record<string, number> = {
  ERROR: 4,
  CRITICAL: 5,
  ALERT: 6,
  EMERGENCY: 7,
};

const parseStack = (error: Error) =>
  error.stack
    ?.split('\n')
    .slice(1, 51)
    .map((line) => {
      const match = line.match(/^\s*at (.*?) \((.*?):(\d+):(\d+)\)$/) ||
        line.match(/^\s*at (.*?):(\d+):(\d+)$/);
      if (!match) return undefined;
      const [, fn, file, lineNumber, column] = match;
      return {
        function: fn || '<anonymous>',
        file: file || null,
        line: Number(lineNumber),
        column: Number(column),
        inApp: !(file || '').includes('node_modules') && !(file || '').startsWith('node:'),
      };
    })
    .filter((frame): frame is NonNullable<typeof frame> => Boolean(frame));

export const createLogcoreAdapter = (sender: Sender = send) => {
  const url = process.env.LOGCORE_URL;
  const key = process.env.LOGCORE_KEY;
  const enabled = process.env.LOGCORE_ENABLED === 'true';
  const service = (process.env.LOGCORE_SERVICE || 'node-express-app').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 63);
  const env = (process.env.LOGCORE_ENV || 'dev') as LogcoreEntry['env'];

  return (error: unknown, severity = 'ERROR', message?: string) => {
    if (!enabled || !url || !key || (severityRank[severity] || 0) < 4) return;
    try {
      const exception = error instanceof Error ? error : undefined;
      const text = (message || exception?.message || String(error)).slice(0, 65536);
      const timestamp = new Date().toISOString();
      const entry: LogcoreEntry = {
        timestamp,
        severity: severity as LogcoreEntry['severity'],
        message: text,
        service,
        env,
        insert_id: createHash('sha256').update(`${timestamp}|${service}|${severity}|${text}|{}`).digest('hex').slice(0, 32),
      };
      if (exception) {
        entry.error = { type: exception.name || 'Error', message: exception.message.slice(0, 65536) };
        const stack = parseStack(exception);
        if (stack?.length) entry.error.stack = stack;
      }
      sender(JSON.stringify({ schema_version: 1, entries: [entry] }), `${url.replace(/\/$/, '')}/v1/logs`, key);
    } catch {
      // Transport failures must never affect the application error path.
    }
  };
};

const send: Sender = (body, url, key) => {
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body,
  }).catch(() => undefined);
};
