import { spawn as nodeSpawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import process from 'node:process';

export interface WebServerChild extends EventEmitter {
  kill(signal?: NodeJS.Signals): boolean | void;
}

interface WebServerDependencies {
  spawn(command: string): WebServerChild;
  fetch(url: string): Promise<Response>;
  wait(ms: number): Promise<void>;
  timeoutMs: number;
}

const defaults: WebServerDependencies = {
  spawn: (command) =>
    nodeSpawn(command, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: 'ignore'
    }) as WebServerChild,
  fetch: (url) => fetch(url),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: 30_000
};

export async function withProjectWebServer<T>(
  config: { command: string; url: string },
  task: () => Promise<T>,
  dependencies: Partial<WebServerDependencies> = {}
): Promise<T> {
  const runtime = { ...defaults, ...dependencies };
  const child = runtime.spawn(config.command);
  let exited: Error | undefined;
  child.once('error', (error) => (exited = error));
  child.once('exit', (code) => {
    if (code !== null && code !== 0) exited = new Error(`project web server exited ${code}`);
  });
  const deadline = Date.now() + runtime.timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (exited) throw exited;
      try {
        const response = await runtime.fetch(config.url);
        if (response.ok) return await task();
      } catch {
        // The server may refuse connections until its listener is ready.
      }
      await runtime.wait(100);
    }
    throw new Error(`project web server did not become ready: ${config.url}`);
  } finally {
    child.kill('SIGTERM');
  }
}
