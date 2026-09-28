export type Severity =
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL'
  | 'FATAL';

export interface StackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
  inApp: boolean;
}

export interface ErrorPayload {
  type: string;
  message: string;
  stack: StackFrame[];
}

export interface TraceContext {
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
  trace?: TraceContext;
  error?: ErrorPayload;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
  source_project?: string;
}

export interface LogcoreEnvelope {
  schema_version: number;
  entries: LogcoreEntry[];
}

export interface LogcoreConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  service: string;
  env: string;
  minSeverity: string;
}

export interface LogOptions {
  severity?: string;
  message: string;
  error?: unknown;
  trace?: TraceContext;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
  timestamp?: string;
}
