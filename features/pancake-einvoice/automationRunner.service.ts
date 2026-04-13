import { runPancakeFlow } from './automation/runPancakeFlow';

let running = false;

export function isAutomationRunning(): boolean {
  return running;
}

export async function triggerAutomationRun(): Promise<void> {
  if (running) {
    throw new Error('Automation already running');
  }
  running = true;
  try {
    await runPancakeFlow();
  } finally {
    running = false;
  }
}
