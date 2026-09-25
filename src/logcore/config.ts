import { LogcoreConfig, LogEnvironment, LogSeverity } from './types';

export const VALID_ENVIRONMENTS: readonly LogEnvironment[] = [
  'prod',
  'staging',
  'dev',
  'test',
  'local',
] as const;

export const SEVERITY_LEVELS: Record<LogSeverity, number> = {
  DEFAULT: 0,
  DEBUG: 100,
  INFO: 200,
  NOTICE: 300,
  WARNING: 400,
  WARN: 400,
  ERROR: 500,
  CRITICAL: 600,
  ALERT: 700,
  EMERGENCY: 800,
};

export function normalizeEnv(rawEnv?: string): LogEnvironment {
  if (!rawEnv) return 'dev';
  const lower = rawEnv.toLowerCase().trim();

  if (lower === 'production' || lower === 'prod') return 'prod';
  if (lower === 'staging' || lower === 'stage') return 'staging';
  if (lower === 'development' || lower === 'dev') return 'dev';
  if (lower === 'testing' || lower === 'test') return 'test';
  if (lower === 'local' || lower === 'localhost') return 'local';

  if (VALID_ENVIRONMENTS.includes(lower as LogEnvironment)) {
    return lower as LogEnvironment;
  }

  return 'dev';
}

export function normalizeServiceName(rawService?: string): string {
  if (!rawService) return 'node-express-realworld-example-app';
  // Service pattern: ^[a-z0-9][a-z0-9._-]{0,62}$
  const cleaned = rawService
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .slice(0, 63);

  if (!cleaned || !/^[a-z0-9]/.test(cleaned)) {
    return 'node-express-realworld-example-app';
  }
  return cleaned;
}

export function normalizeSeverity(rawSeverity?: string): LogSeverity {
  if (!rawSeverity) return 'ERROR';
  const upper = rawSeverity.toUpperCase().trim() as LogSeverity;
  if (upper in SEVERITY_LEVELS) {
    return upper;
  }
  return 'ERROR';
}

export function shouldLog(entrySeverity: LogSeverity, minSeverity: LogSeverity): boolean {
  const entryLevel = SEVERITY_LEVELS[entrySeverity] ?? 500;
  const minLevel = SEVERITY_LEVELS[minSeverity] ?? 500;
  return entryLevel >= minLevel;
}

export function getConfig(): LogcoreConfig {
  const enabledEnv = process.env.LOGCORE_ENABLED;
  const enabled =
    enabledEnv !== undefined
      ? enabledEnv === 'true' || enabledEnv === '1' || enabledEnv === 'yes'
      : true;

  return {
    url:
      process.env.LOGCORE_URL ||
      'https://logcore-dev-352942961463.us-east4.run.app',
    apiKey: process.env.LOGCORE_KEY || '',
    enabled,
    service: normalizeServiceName(
      process.env.LOGCORE_SERVICE || 'node-express-realworld-example-app',
    ),
    env: normalizeEnv(process.env.LOGCORE_ENV || process.env.NODE_ENV),
    minSeverity: normalizeSeverity(process.env.LOGCORE_MIN_SEVERITY),
  };
}
