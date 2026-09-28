import { initLogcore, getLogcoreTransport } from './index';

async function main() {
  process.env.LOGCORE_SILENT_CONSOLE = 'true';
  process.env.LOGCORE_PROBE = 'true';

  const { transport } = initLogcore();
  let captured: unknown = null;

  transport.onEntry(entry => {
    captured = entry;
  });

  console.error(new Error('Logcore error event'));

  if (captured) {
    process.stdout.write(JSON.stringify(captured) + '\n');
  }
}

main().catch(err => {
  process.stderr.write(`Probe failed: ${err}\n`);
  process.exit(1);
});
