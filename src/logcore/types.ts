export type LogSeverity =
  | 'DEFAULT'
  | 'DEBUG'
  | 'INFO'
  | 'NOTICE'
  | 'WARNING'
  | 'WARN'
  | 'ERROR'
  | 'CRITICAL'
  | 'ALERT'
  | 'EMERGENCY';

export type LogEnvironment = 'prod' | 'staging' | 'dev' | 'test' | 'local';

export interface StackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
  inApp: boolean;
}

export interface ErrorDetail {
  type: string;
  message: string;
  stack: StackFrame[];
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export interface LogEntry {
  timestamp: string;
  severity: LogSeverity;
  message: string;
  service: string;
  env: LogEnvironment;
  insert_id: string;
  trace?: TraceContext;
  error?: ErrorDetail;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
}

export interface RequestEnvelope {
  schema_version: number;
  entries: LogEntry[];
}

export interface LogcoreConfig {
  url: string;
  apiKey: string;
  enabled: boolean;
  service: string;
  env: LogEnvironment;
  minSeverity: LogSeverity;
}
