import { runEinvoiceAutomation } from '../features/pancake-einvoice/automation/runEinvoiceAutomation';

runEinvoiceAutomation().catch((err) => {
  console.error(err);
  process.exit(1);
});
