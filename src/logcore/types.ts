export type LogSeverity =
  | 'DEFAULT'
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
  file: string;
  line: number;
  column: number;
  inApp: boolean;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack?: StackFrame[];
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
  env: LogEnv;
  insert_id: string;
  trace?: TraceContext;
  error?: ErrorInfo;
  labels?: Record<string, string>;
  context?: Record<string, any>;
  [key: string]: any;
}

export interface LogEnvelope {
  schema_version: number;
  entries: LogEntry[];
}

export interface LogcoreConfig {
  url?: string;
  key?: string;
  enabled?: boolean;
  service?: string;
  env?: LogEnv;
  minSeverity?: LogSeverity;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  maxRetries?: number;
  sender?: (envelope: LogEnvelope) => Promise<void>;
}
