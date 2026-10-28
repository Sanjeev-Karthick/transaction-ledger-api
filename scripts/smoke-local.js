const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

// Requires PostgreSQL and a free port 3001. Does not create tables or records.
async function main() {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/server.js'], {
    env: { ...process.env, PORT: '3001' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch('http://127.0.0.1:3001/health', {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Retry until startup deadline. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Local server did not become ready: ${output}`);
    console.log('Local Node readiness: PASS');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 17000);
    const result = await exited;
    clearTimeout(timer);
    assert.equal(result.code, 0, output);
    console.log('Local SIGTERM graceful shutdown: PASS');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
