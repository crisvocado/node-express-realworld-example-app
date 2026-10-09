export type LogSeverity =
  | 'DEBUG'
  | 'INFO'
  | 'NOTICE'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL'
  | 'ALERT'
  | 'EMERGENCY';

export type LogEnv = 'prod' | 'staging' | 'dev' | 'test' | 'local';

export interface StackFrame {
  function: string;
  file?: string | null;
  line?: number | null;
  column?: number | null;
  inApp?: boolean;
}

export interface ErrorObject {
  type: string;
  message: string;
  stack?: StackFrame[];
}

export interface TraceContext {
  traceId: string;
  spanId?: string | null;
  sampled?: boolean;
}

export interface LogEntry {
  timestamp: string;
  severity: LogSeverity;
  message: string;
  service: string;
  env: LogEnv;
  insert_id: string;
  source_project?: string | null;
  trace?: TraceContext | null;
  error?: ErrorObject | null;
  labels?: Record<string, string>;
  context?: Record<string, unknown>;
}

export interface LogcoreEnvelope {
  schema_version: 1;
  entries: LogEntry[];
}

export interface LogcoreConfig {
  url: string;
  key: string;
  enabled: boolean;
  service: string;
  env: LogEnv;
  minSeverity: LogSeverity;
}
