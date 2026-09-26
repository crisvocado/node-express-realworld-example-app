import { initLogcore, createTrace, runWithTrace } from './index';
import { LogcoreEntry } from './types';

async function main(): Promise<void> {
  const { flush, transport } = initLogcore();

  let captured: LogcoreEntry | null = null;
  const originalSend = transport.send.bind(transport);
  transport.send = (entry: LogcoreEntry) => {
    captured = entry;
    originalSend(entry);
  };

  const trace = createTrace(true);
  runWithTrace(trace, () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'total')");
    console.error('checkout failed', error);
  });

  if (captured) {
    process.stdout.write(JSON.stringify(captured) + '\n');
  }

  await flush().catch(() => {});
}

main().catch(err => {
  process.stderr.write(`Probe failed: ${err}\n`);
  process.exit(1);
});
