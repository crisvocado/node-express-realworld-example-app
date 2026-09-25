import { initLogcore, captureError, closeLogcore } from './logcore';

async function main() {
  let capturedEntry: any = null;

  initLogcore({
    sender: async envelope => {
      if (envelope.entries.length > 0) {
        capturedEntry = envelope.entries[0];
      }
    },
  });

  const sampleError = new Error('Probe test error: verifying logcore integration');
  const entry = captureError(sampleError, {
    context: {
      probe: true,
      component: 'logcore-probe',
    },
  });

  await closeLogcore();

  const finalOutput = capturedEntry || entry;
  console.log(JSON.stringify(finalOutput));
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`Probe failed: ${err.message}\n`);
  process.exit(1);
});
