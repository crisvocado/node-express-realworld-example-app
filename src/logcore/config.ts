import { LogcoreConfig } from './types';

export function getLogcoreConfig(): LogcoreConfig {
  const service = process.env.LOGCORE_SERVICE || 'node-express-realworld-example-app';
  const rawEnv = (process.env.LOGCORE_ENV || 'dev').toLowerCase();
  const env = rawEnv === 'production' ? 'prod' : rawEnv;
  const url = process.env.LOGCORE_URL || 'https://logcore-dev-352942961463.us-east4.run.app';
  const apiKey = process.env.LOGCORE_KEY || '';
  const enabled = process.env.LOGCORE_ENABLED !== 'false';
  const minSeverity = (process.env.LOGCORE_MIN_SEVERITY || 'ERROR').toUpperCase();

  return {
    service,
    env,
    url,
    apiKey,
    enabled,
    minSeverity,
  };
}
