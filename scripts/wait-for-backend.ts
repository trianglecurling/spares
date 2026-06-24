import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getBackendPort(): number {
  const envPath = resolve(import.meta.dir, '../backend/.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf8').match(/^PORT=(\d+)/m);
    if (match) return Number.parseInt(match[1], 10);
  }
  return 3001;
}

const port = getBackendPort();
const url = `http://127.0.0.1:${port}/api/health`;
const maxAttempts = 60;
const delayMs = 250;

process.stdout.write(`Waiting for backend at ${url}`);

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      console.log(' — ready');
      process.exit(0);
    }
  } catch {
    // Backend not listening yet.
  }

  await Bun.sleep(delayMs);
  if (attempt % 4 === 0) {
    process.stdout.write('.');
  }
}

console.error(
  `\nBackend not reachable at ${url} after ${(maxAttempts * delayMs) / 1000}s. Start it with \`bun run dev:backend\` or \`bun run dev\`.`,
);
process.exit(1);
