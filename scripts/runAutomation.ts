import { runPancakeFlow } from '../pancakeAutomation';

runPancakeFlow().catch((err) => {
  console.error(err);
  process.exit(1);
});
