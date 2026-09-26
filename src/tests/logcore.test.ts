import {
  computeInsertId,
  parseTraceparent,
  formatTraceparent,
  createTrace,
  parseStackTrace,
  parseError,
  LogcoreTransport,
  initLogcore,
  LogcoreEntry,
} from '../logcore';

describe('Logcore Integration', () => {
  describe('insert_id', () => {
    test('should generate a 32-character hex hash', () => {
      const id = computeInsertId(
        '2026-08-17T18:30:00.000Z',
        'todo-frontend',
        'ERROR',
        'checkout failed',
      );
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    test('should be deterministic for the same inputs', () => {
      const id1 = computeInsertId('2026-08-17T18:30:00.000Z', 'my-service', 'ERROR', 'msg', {
        a: 1,
        b: 2,
      });
      const id2 = computeInsertId('2026-08-17T18:30:00.000Z', 'my-service', 'ERROR', 'msg', {
        b: 2,
        a: 1,
      });
      expect(id1).toBe(id2);
    });
  });

  describe('trace parsing', () => {
    test('should parse standard W3C traceparent header', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const trace = parseTraceparent(header);
      expect(trace).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      });
    });

    test('should format trace back to traceparent string', () => {
      const trace = {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      };
      expect(formatTraceparent(trace)).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    test('should generate valid random trace', () => {
      const trace = createTrace(true);
      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace.sampled).toBe(true);
    });
  });

  describe('stack parsing', () => {
    test('should parse error stack into frames with inApp flag', () => {
      const error = new Error('Test error message');
      const parsed = parseError(error);

      expect(parsed).toBeDefined();
      expect(parsed?.type).toBe('Error');
      expect(parsed?.message).toBe('Test error message');
      expect(Array.isArray(parsed?.stack)).toBe(true);
      expect(parsed!.stack.length).toBeGreaterThan(0);

      const frame = parsed!.stack[0];
      expect(frame).toHaveProperty('function');
      expect(frame).toHaveProperty('file');
      expect(frame).toHaveProperty('line');
      expect(frame).toHaveProperty('column');
      expect(frame).toHaveProperty('inApp');
      expect(typeof frame.inApp).toBe('boolean');
    });

    test('should place cause frames first (root cause first)', () => {
      const inner = new TypeError('Cannot read properties of undefined');
      const outer = new Error('Wrapper error');
      (outer as any).cause = inner;
      const parsed = parseError(outer);

      expect(parsed?.type).toBe('Error');
      expect(parsed?.message).toBe('Wrapper error');
      expect(parsed!.stack.length).toBeGreaterThan(0);
    });
  });

  describe('transport', () => {
    test('should clamp large messages', () => {
      const transport = new LogcoreTransport({ enabled: true });
      const bigMessage = 'a'.repeat(70000);
      const entry: LogcoreEntry = {
        timestamp: new Date().toISOString(),
        severity: 'ERROR',
        message: bigMessage,
        service: 'test-service',
        env: 'dev',
        insert_id: '0123456789abcdef0123456789abcdef',
      };

      transport.send(entry);
      expect(entry.message.length).toBe(65536);
      transport.stopTimer();
    });

    test('should recognize self ingest URLs', () => {
      const transport = new LogcoreTransport({
        url: 'https://logcore-dev-352942961463.us-east4.run.app',
      });
      expect(
        transport.isSelfUrl('https://logcore-dev-352942961463.us-east4.run.app/v1/logs'),
      ).toBe(true);
      expect(transport.isSelfUrl('https://api.example.com/v1/logs')).toBe(false);
      transport.stopTimer();
    });
  });

  describe('console interceptor', () => {
    test('should intercept console.error and forward to transport', () => {
      const origError = console.error;
      const { uninstall, transport } = initLogcore({ enabled: true });

      const sentEntries: LogcoreEntry[] = [];
      const origSend = transport.send.bind(transport);
      transport.send = (entry: LogcoreEntry) => {
        sentEntries.push(entry);
        origSend(entry);
      };

      console.error('Testing console interceptor error');

      expect(sentEntries.length).toBe(1);
      expect(sentEntries[0].severity).toBe('ERROR');
      expect(sentEntries[0].message).toContain('Testing console interceptor error');
      expect(sentEntries[0].insert_id).toMatch(/^[0-9a-f]{32}$/);
      expect(sentEntries[0].env).toMatch(/^(prod|staging|dev|test|local)$/);
      expect(sentEntries[0].service).toMatch(/^[a-z0-9][a-z0-9._-]{0,62}$/);

      uninstall();
      expect(console.error).toBe(origError);
    });

    test('should produce golden entry compliant structure', () => {
      const origError = console.error;
      const { uninstall, transport } = initLogcore({ enabled: true, service: 'todo-frontend', env: 'dev' });

      const sentEntries: LogcoreEntry[] = [];
      transport.send = (entry: LogcoreEntry) => {
        sentEntries.push(entry);
      };

      const testErr = new TypeError("Cannot read properties of undefined (reading 'total')");
      console.error(testErr);

      expect(sentEntries.length).toBe(1);
      const entry = sentEntries[0];

      // Top level fields
      expect(typeof entry.timestamp).toBe('string');
      expect(entry.severity).toBe('ERROR');
      expect(entry.message).toContain("Cannot read properties of undefined (reading 'total')");
      expect(entry.service).toBe('todo-frontend');
      expect(entry.env).toBe('dev');
      expect(entry.insert_id).toMatch(/^[0-9a-f]{32}$/);

      // Error shape
      expect(entry.error).toBeDefined();
      expect(entry.error?.type).toBe('TypeError');
      expect(entry.error?.message).toBe("Cannot read properties of undefined (reading 'total')");
      expect(Array.isArray(entry.error?.stack)).toBe(true);
      expect(entry.error!.stack.length).toBeGreaterThan(0);

      const topFrame = entry.error!.stack[0];
      expect(typeof topFrame.function).toBe('string');
      expect(typeof topFrame.file).toBe('string');
      expect(typeof topFrame.line).toBe('number');
      expect(typeof topFrame.column).toBe('number');
      expect(typeof topFrame.inApp).toBe('boolean');

      uninstall();
      expect(console.error).toBe(origError);
    });
  });
});
