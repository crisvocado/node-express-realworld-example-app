import { createLogcoreAdapter } from './adapter';

const captured: string[] = [];
process.env.LOGCORE_ENABLED = 'true';
process.env.LOGCORE_URL = 'https://logcore.invalid';
process.env.LOGCORE_KEY = 'probe-key';

const adapter = createLogcoreAdapter((body) => captured.push(body));
adapter(new Error('logcore validation error'));
if (!captured.length) throw new Error('logcore probe captured no entry; enable LOGCORE_ENABLED and configure credentials');
process.stdout.write(`${captured[0]}\n`);
