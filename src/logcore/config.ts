import { LogcoreConfig } from './types';

const ALLOWED_ENVS = new Set(['prod', 'staging', 'dev', 'test', 'local']);

function sanitizeEnv(rawEnv?: string): string {
  if (!rawEnv) return 'dev';
  const lower = rawEnv.toLowerCase().trim();
  if (lower === 'production') return 'prod';
  if (ALLOWED_ENVS.has(lower)) return lower;
  return 'dev';
}

function sanitizeService(rawService?: string): string {
  if (!rawService) return 'api';
  const trimmed = rawService.trim();
  const validPattern = /^[a-z0-9][a-z0-9._-]{0,62}$/;
  if (validPattern.test(trimmed)) {
    return trimmed;
  }
  return 'api';
}

export function loadLogcoreConfig(overrides?: Partial<LogcoreConfig>): LogcoreConfig {
  const enabledEnv = process.env.LOGCORE_ENABLED;
  const isExplicitlyDisabled =
    enabledEnv !== undefined &&
    (enabledEnv.toLowerCase() === 'false' || enabledEnv === '0');

  return {
    enabled: overrides?.enabled ?? !isExplicitlyDisabled,
    url:
      overrides?.url ||
      process.env.LOGCORE_URL ||
      'https://logcore-dev-352942961463.us-east4.run.app',
    apiKey: overrides?.apiKey || process.env.LOGCORE_KEY || '',
    service: sanitizeService(overrides?.service || process.env.LOGCORE_SERVICE),
    env: sanitizeEnv(overrides?.env || process.env.LOGCORE_ENV),
    minSeverity: overrides?.minSeverity || process.env.LOGCORE_MIN_SEVERITY || 'ERROR',
  };
}
