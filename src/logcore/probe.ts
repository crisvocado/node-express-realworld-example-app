import { initLogcore, captureError, getTransport, LogEntry } from './index';
import { logContextStorage, generateTraceContext } from './context';

async function main() {
  initLogcore();

  let capturedEntry: LogEntry | null = null;
  const transport = getTransport();
  transport.enqueue = (entry: LogEntry) => {
    capturedEntry = entry;
  };

  const trace = generateTraceContext();
  logContextStorage.run({ trace }, () => {
    const probeError = new Error('Logcore integration probe error');
    probeError.name = 'ProbeError';
    captureError(probeError, 'Logcore probe error emission test', { probe: 'true' });
  });

  if (capturedEntry) {
    process.stdout.write(JSON.stringify(capturedEntry) + '\n');
  } else {
    process.stderr.write('Failed to capture log entry in probe\n');
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Logcore probe failed: ${err}\n`);
  process.exit(1);
});
