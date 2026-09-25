import {
  canonicalJson,
  parseStackTrace,
  extractRootError,
  parseError,
  parseTraceparent,
  generateTrace,
  formatTraceparent,
  createLogEntry,
  LogcoreTransport,
  initLogcore,
  captureError,
  captureLog,
  closeLogcore,
} from '../logcore';

describe('Logcore Integration', () => {
  afterEach(async () => {
    await closeLogcore();
  });

  describe('canonicalJson', () => {
    test('sorts keys recursively', () => {
      const obj = { z: 1, a: { y: 2, b: 3 }, m: [3, 2, 1] };
      const serialized = canonicalJson(obj);
      expect(serialized).toBe('{"a":{"b":3,"y":2},"m":[3,2,1],"z":1}');
    });

    test('handles primitives and null', () => {
      expect(canonicalJson(null)).toBe('null');
      expect(canonicalJson(undefined)).toBe('null');
      expect(canonicalJson('hello')).toBe('"hello"');
      expect(canonicalJson(42)).toBe('42');
    });
  });

  describe('stack parser', () => {
    test('parses standard V8 stack frames', () => {
      const sampleStack = `Error: Something broke
    at checkout (https://app.example.com/assets/index-a1b2c3.js:1:48213)
    at <anon> (https://cdn.example.com/vendor.js:1:9042)
    at Module._compile (node:internal/modules/cjs/loader:1328:27)
    at /workspace/src/main.ts:15:20`;

      const frames = parseStackTrace(sampleStack);
      expect(frames.length).toBe(4);

      expect(frames[0]).toEqual({
        function: 'checkout',
        file: 'https://app.example.com/assets/index-a1b2c3.js',
        line: 1,
        column: 48213,
        inApp: true,
      });

      expect(frames[1]).toEqual({
        function: '<anon>',
        file: 'https://cdn.example.com/vendor.js',
        line: 1,
        column: 9042,
        inApp: true,
      });

      expect(frames[2]).toEqual({
        function: 'Module._compile',
        file: 'node:internal/modules/cjs/loader',
        line: 1328,
        column: 27,
        inApp: false,
      });

      expect(frames[3]).toEqual({
        function: '<anon>',
        file: '/workspace/src/main.ts',
        line: 15,
        column: 20,
        inApp: true,
      });
    });

    test('extracts root cause in chained errors', () => {
      const root = new TypeError('Root database error');
      const middle = new Error('Service failed');
      (middle as any).cause = root;
      const top = new Error('Controller failed');
      (top as any).cause = middle;

      const extracted = extractRootError(top);
      expect(extracted).toBe(root);

      const parsed = parseError(top);
      expect(parsed.type).toBe('TypeError');
      expect(parsed.message).toBe('Root database error');
    });
  });

  describe('trace handling', () => {
    test('parses valid W3C traceparent', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = parseTraceparent(header);
      expect(parsed).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      });
    });

    test('generates and formats traceparent', () => {
      const trace = generateTrace(true);
      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace.sampled).toBe(true);

      const formatted = formatTraceparent(trace);
      expect(formatted).toBe(`00-${trace.traceId}-${trace.spanId}-01`);
    });
  });

  describe('transport and entry creation', () => {
    test('creates entry matching wire shape and golden entry', () => {
      const entry = createLogEntry('checkout failed', 'ERROR', {
        config: {
          service: 'todo-frontend',
          env: 'dev',
        },
        error: new TypeError("Cannot read properties of undefined (reading 'total')"),
      });

      expect(entry.severity).toBe('ERROR');
      expect(entry.service).toBe('todo-frontend');
      expect(entry.env).toBe('dev');
      expect(entry.message).toBe('checkout failed');
      expect(entry.insert_id).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.error?.type).toBe('TypeError');
      expect(entry.error?.message).toBe("Cannot read properties of undefined (reading 'total')");
      expect(Array.isArray(entry.error?.stack)).toBe(true);
    });

    test('deterministic insert_id for same inputs', () => {
      const entry1 = createLogEntry('same error', 'ERROR', {
        config: { service: 'api', env: 'dev' },
        context: { a: 1, b: 2 },
      });
      const entry2 = createLogEntry('same error', 'ERROR', {
        config: { service: 'api', env: 'dev' },
        context: { b: 2, a: 1 },
      });

      // Override timestamp to match
      entry1.timestamp = '2026-08-17T18:30:00.000Z';
      entry2.timestamp = '2026-08-17T18:30:00.000Z';

      const id1 = createLogEntry('same error', 'ERROR', {
        config: { service: 'api', env: 'dev' },
        context: { a: 1, b: 2 },
      });
      id1.timestamp = '2026-08-17T18:30:00.000Z';
    });

    test('batches and sends entries via custom sender', async () => {
      const sentEnvelopes: any[] = [];
      const transport = new LogcoreTransport({
        service: 'test-svc',
        env: 'test',
        sender: async envelope => {
          sentEnvelopes.push(envelope);
        },
      });

      const entry = createLogEntry('test message', 'ERROR', {
        config: { service: 'test-svc', env: 'test' },
      });

      transport.enqueue(entry);
      await transport.flush();

      expect(sentEnvelopes.length).toBe(1);
      expect(sentEnvelopes[0].schema_version).toBe(1);
      expect(sentEnvelopes[0].entries.length).toBe(1);
      expect(sentEnvelopes[0].entries[0].message).toBe('test message');

      await transport.close();
    });

    test('respects severity floor', async () => {
      const sentEnvelopes: any[] = [];
      const transport = new LogcoreTransport({
        minSeverity: 'ERROR',
        sender: async envelope => {
          sentEnvelopes.push(envelope);
        },
      });

      const debugEntry = createLogEntry('debug msg', 'DEBUG');
      const errorEntry = createLogEntry('error msg', 'ERROR');

      transport.enqueue(debugEntry);
      transport.enqueue(errorEntry);
      await transport.flush();

      expect(sentEnvelopes.length).toBe(1);
      expect(sentEnvelopes[0].entries.length).toBe(1);
      expect(sentEnvelopes[0].entries[0].severity).toBe('ERROR');

      await transport.close();
    });
  });
});
