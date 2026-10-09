import { initLogcore, setCustomSender, flushLogs, LogcoreEnvelope } from './logcore';

async function main(): Promise<void> {
  let capturedEnvelope: LogcoreEnvelope | null = null;

  // Intercept at the final network boundary without sending over the network
  setCustomSender((envelope) => {
    capturedEnvelope = envelope;
  });

  // Initialize application logging setup
  initLogcore();

  // Trigger an ERROR with existing logger
  console.error(new Error('probe test error'));

  // Flush queued delivery
  await flushLogs();

  if (!capturedEnvelope) {
    process.stderr.write('Probe failed: no envelope captured\n');
    process.exit(1);
  }

  // Output the full captured HTTP request envelope unchanged
  process.stdout.write(JSON.stringify(capturedEnvelope) + '\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Probe error: ${err}\n`);
  process.exit(1);
});
