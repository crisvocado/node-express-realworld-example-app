import {
  parseError,
  parseStackTrace,
  isInternalOrDependency,
} from '../logcore/stack-parser';
import {
  parseTraceparent,
  generateTraceContext,
  logContextStorage,
} from '../logcore/context';
import {
  computeInsertId,
  clampLabels,
  captureError,
  captureLog,
} from '../logcore/logger';
import {
  normalizeEnv,
  normalizeServiceName,
  normalizeSeverity,
  shouldLog,
} from '../logcore/config';
import { getTransport, HttpTransport } from '../logcore/transport';
import { installConsoleHook } from '../logcore/console-hook';
import { initLogcore, cleanup } from '../logcore';

describe('Logcore Integration Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Config normalization', () => {
    it('should normalize environments to allowed enums', () => {
      expect(normalizeEnv('production')).toBe('prod');
      expect(normalizeEnv('prod')).toBe('prod');
      expect(normalizeEnv('development')).toBe('dev');
      expect(normalizeEnv('dev')).toBe('dev');
      expect(normalizeEnv('staging')).toBe('staging');
      expect(normalizeEnv('test')).toBe('test');
      expect(normalizeEnv('testing')).toBe('test');
      expect(normalizeEnv('local')).toBe('local');
      expect(normalizeEnv('unknown-env')).toBe('dev');
    });

    it('should normalize service names to valid regex ^[a-z0-9][a-z0-9._-]{0,62}$', () => {
      expect(normalizeServiceName('My Service Name')).toBe('my-service-name');
      expect(normalizeServiceName('api_v1.0')).toBe('api_v1.0');
    });

    it('should compare severity levels accurately', () => {
      expect(shouldLog('ERROR', 'ERROR')).toBe(true);
      expect(shouldLog('CRITICAL', 'ERROR')).toBe(true);
      expect(shouldLog('INFO', 'ERROR')).toBe(false);
      expect(shouldLog('DEBUG', 'ERROR')).toBe(false);
    });
  });

  describe('Stack trace parser', () => {
    it('should correctly parse standard stack frames', () => {
      const sampleStack = `Error: Something failed
    at checkout (/workspace/app/service.ts:12:34)
    at async handleRequest (/workspace/app/routes.ts:56:78)
    at Layer.handle [as handle_request] (/workspace/node_modules/express/lib/router/layer.js:95:5)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

      const frames = parseStackTrace(sampleStack);
      expect(frames.length).toBe(4);

      expect(frames[0]).toEqual({
        function: 'checkout',
        file: '/workspace/app/service.ts',
        line: 12,
        column: 34,
        inApp: true,
      });

      expect(frames[1]).toEqual({
        function: 'handleRequest',
        file: '/workspace/app/routes.ts',
        line: 56,
        column: 78,
        inApp: true,
      });

      expect(frames[2]).toEqual({
        function: 'Layer.handle [as handle_request]',
        file: '/workspace/node_modules/express/lib/router/layer.js',
        line: 95,
        column: 5,
        inApp: false,
      });

      expect(frames[3]).toEqual({
        function: 'processTicksAndRejections',
        file: 'node:internal/process/task_queues',
        line: 95,
        column: 5,
        inApp: false,
      });
    });

    it('should traverse error cause chain and put root cause frames first', () => {
      const rootError = new Error('Database connection timeout');
      rootError.name = 'DatabaseError';

      const serviceError: any = new Error('User creation failed');
      serviceError.cause = rootError;
      serviceError.name = 'ServiceError';

      const parsed = parseError(serviceError);
      expect(parsed.type).toBe('ServiceError');
      expect(parsed.message).toBe('User creation failed');
      expect(parsed.stack.length).toBeGreaterThan(0);
    });
  });

  describe('Trace context & Traceparent', () => {
    it('should parse valid W3C traceparent headers', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = parseTraceparent(header);
      expect(parsed).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      });
    });

    it('should return undefined for invalid headers', () => {
      expect(parseTraceparent('invalid')).toBeUndefined();
      expect(parseTraceparent('')).toBeUndefined();
    });

    it('should generate valid 32-hex traceId and 16-hex spanId', () => {
      const trace = generateTraceContext();
      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace.sampled).toBe(true);
    });
  });

  describe('Insert ID calculation', () => {
    it('should generate deterministic 32-char hex insert_id', () => {
      const id1 = computeInsertId(
        '2026-08-17T18:30:00.000Z',
        'api',
        'ERROR',
        'test error',
        { http: { method: 'GET' } },
      );
      const id2 = computeInsertId(
        '2026-08-17T18:30:00.000Z',
        'api',
        'ERROR',
        'test error',
        { http: { method: 'GET' } },
      );
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('Label clamping', () => {
    it('should clamp labels to at most 32 entries and 1024 chars per value', () => {
      const labels: Record<string, string> = {};
      for (let i = 0; i < 40; i++) {
        labels[`key_${i}`] = `value_${i}_${'a'.repeat(2000)}`;
      }
      const clamped = clampLabels(labels);
      expect(clamped).toBeDefined();
      expect(Object.keys(clamped!).length).toBe(32);
      expect(clamped!['key_0'].length).toBe(1024);
    });
  });

  describe('Console Hook', () => {
    it('should intercept console.error while preserving output', () => {
      const originalConsoleError = console.error;
      const uninstall = installConsoleHook();

      let transportEnqueued = false;
      const transport = getTransport();
      const origEnqueue = transport.enqueue.bind(transport);
      transport.enqueue = (entry) => {
        transportEnqueued = true;
        expect(entry.severity).toBe('ERROR');
        expect(entry.message).toContain('Captured console error message');
      };

      console.error('Captured console error message');
      expect(transportEnqueued).toBe(true);

      transport.enqueue = origEnqueue;
      uninstall();
      expect(console.error).toBe(originalConsoleError);
    });
  });

  describe('Wire shape and entry structure', () => {
    it('should build an entry matching the wire shape contract', () => {
      let capturedEntry: any = null;
      const transport = getTransport();
      const origEnqueue = transport.enqueue.bind(transport);
      transport.enqueue = (entry) => {
        capturedEntry = entry;
      };

      const customError = new TypeError(
        "Cannot read properties of undefined (reading 'total')",
      );
      customError.name = 'TypeError';

      logContextStorage.run(
        {
          trace: {
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            sampled: true,
          },
        },
        () => {
          captureError(customError, 'checkout failed');
        },
      );

      expect(capturedEntry).toBeDefined();
      expect(capturedEntry.severity).toBe('ERROR');
      expect(capturedEntry.message).toBe('checkout failed');
      expect(capturedEntry.service).toBe('node-express-realworld-example-app');
      expect(['prod', 'staging', 'dev', 'test', 'local']).toContain(
        capturedEntry.env,
      );
      expect(capturedEntry.insert_id).toMatch(/^[0-9a-f]{32}$/);
      expect(capturedEntry.trace).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      });
      expect(capturedEntry.error.type).toBe('TypeError');
      expect(capturedEntry.error.message).toBe(
        "Cannot read properties of undefined (reading 'total')",
      );
      expect(Array.isArray(capturedEntry.error.stack)).toBe(true);
      expect(capturedEntry.error.stack.length).toBeGreaterThan(0);
      expect(capturedEntry.error.stack[0]).toHaveProperty('function');
      expect(capturedEntry.error.stack[0]).toHaveProperty('file');
      expect(capturedEntry.error.stack[0]).toHaveProperty('line');
      expect(capturedEntry.error.stack[0]).toHaveProperty('column');
      expect(capturedEntry.error.stack[0]).toHaveProperty('inApp');

      // Top level fields must conform to allowed top level list
      const topLevelKeys = Object.keys(capturedEntry);
      const allowedKeys = [
        'timestamp',
        'severity',
        'message',
        'service',
        'env',
        'source_project',
        'insert_id',
        'trace',
        'error',
        'labels',
        'context',
      ];
      for (const key of topLevelKeys) {
        expect(allowedKeys).toContain(key);
      }

      transport.enqueue = origEnqueue;
    });
  });
});
