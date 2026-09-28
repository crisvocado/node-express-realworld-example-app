import {
  parseStackTrace,
  getRootError,
  formatErrorPayload,
} from '../logcore/stack-parser';
import {
  computeInsertId,
  LogcoreTransport,
} from '../logcore/transport';
import {
  parseTraceparent,
  generateTrace,
} from '../logcore/context';
import { loadLogcoreConfig } from '../logcore/config';

describe('Logcore Integration', () => {
  describe('Config Loader', () => {
    it('should sanitize env values correctly', () => {
      const config = loadLogcoreConfig({ env: 'production' });
      expect(config.env).toBe('prod');

      const configDev = loadLogcoreConfig({ env: 'dev' });
      expect(configDev.env).toBe('dev');

      const configInvalid = loadLogcoreConfig({ env: 'unsupported-env' });
      expect(configInvalid.env).toBe('dev');
    });

    it('should sanitize service name correctly', () => {
      const config = loadLogcoreConfig({ service: 'my-service_1' });
      expect(config.service).toBe('my-service_1');
    });
  });

  describe('Trace Context', () => {
    it('should parse valid traceparent header', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = parseTraceparent(header);
      expect(parsed).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      });
    });

    it('should reject invalid traceparent header', () => {
      expect(parseTraceparent('invalid-header')).toBeNull();
      expect(
        parseTraceparent('00-00000000000000000000000000000000-0000000000000000-01'),
      ).toBeNull();
    });

    it('should generate valid trace', () => {
      const trace = generateTrace();
      expect(trace.traceId).toHaveLength(32);
      expect(trace.spanId).toHaveLength(16);
      expect(trace.sampled).toBe(true);
    });
  });

  describe('Stack Trace Parser', () => {
    it('should parse error stack into frames', () => {
      const error = new Error('Test error');
      const frames = parseStackTrace(error);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0]).toHaveProperty('function');
      expect(frames[0]).toHaveProperty('file');
      expect(frames[0]).toHaveProperty('line');
      expect(frames[0]).toHaveProperty('column');
      expect(frames[0]).toHaveProperty('inApp');
    });

    it('should traverse cause chain to root error', () => {
      const rootError = new Error('Root cause failure');
      const wrappedError = new Error('Outer error');
      (wrappedError as unknown as { cause: Error }).cause = rootError;

      const root = getRootError(wrappedError);
      expect(root.message).toBe('Root cause failure');

      const payload = formatErrorPayload(wrappedError);
      expect(payload).toBeDefined();
      expect(payload?.type).toBe('Error');
      expect(payload?.message).toBe('Outer error');
      expect(payload?.stack.length).toBeGreaterThan(0);
    });
  });

  describe('Insert ID Computation', () => {
    it('should produce deterministic 32-character hex string', () => {
      const id1 = computeInsertId(
        '2026-08-17T18:30:00.000Z',
        'api',
        'ERROR',
        'something failed',
        { a: 1, b: 2 },
      );
      const id2 = computeInsertId(
        '2026-08-17T18:30:00.000Z',
        'api',
        'ERROR',
        'something failed',
        { b: 2, a: 1 },
      );

      expect(id1).toHaveLength(32);
      expect(id1).toMatch(/^[0-9a-f]{32}$/);
      // Key order in context should not affect hash
      expect(id1).toBe(id2);
    });
  });

  describe('Transport', () => {
    it('should filter out logs below minimum severity', () => {
      const transport = new LogcoreTransport({
        enabled: true,
        url: 'https://example.com',
        apiKey: 'test-key',
        service: 'api',
        env: 'dev',
        minSeverity: 'ERROR',
      });

      transport.log({ severity: 'INFO', message: 'Info message' });
      transport.log({ severity: 'DEBUG', message: 'Debug message' });

      // Only ERROR and above are accepted
      transport.log({ severity: 'ERROR', message: 'Error message' });
      expect((transport as unknown as { buffer: unknown[] }).buffer.length).toBe(1);
    });

    it('should notify onEntry listeners synchronously upon logging', () => {
      const transport = new LogcoreTransport({
        enabled: true,
        url: 'https://example.com',
        apiKey: 'test-key',
        service: 'api',
        env: 'dev',
        minSeverity: 'ERROR',
      });

      const entries: unknown[] = [];
      const unsubscribe = transport.onEntry(entry => {
        entries.push(entry);
      });

      transport.log({ severity: 'ERROR', message: 'Listener test' });
      expect(entries.length).toBe(1);
      expect((entries[0] as { message: string }).message).toBe('Listener test');

      unsubscribe();
      transport.log({ severity: 'ERROR', message: 'Second error' });
      expect(entries.length).toBe(1);
    });
  });
});
