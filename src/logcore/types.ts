export interface LogcoreStackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
  inApp: boolean;
}

export interface LogcoreError {
  type: string;
  message: string;
  stack: LogcoreStackFrame[];
}

export interface LogcoreTrace {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export interface LogcoreEntry {
  timestamp: string;
  severity: string;
  message: string;
  service: string;
  env: string;
  insert_id: string;
  trace?: LogcoreTrace;
  error?: LogcoreError;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
}

export interface LogcoreEnvelope {
  schema_version: number;
  entries: LogcoreEntry[];
}

export interface LogcoreConfig {
  service: string;
  env: string;
  url: string;
  apiKey: string;
  enabled: boolean;
  minSeverity: string;
}
