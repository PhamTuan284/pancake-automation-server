import { runPancakeFlow } from '../features/pancake-einvoice/automation/runPancakeFlow';

runPancakeFlow().catch((err) => {
  console.error(err);
  process.exit(1);
});
