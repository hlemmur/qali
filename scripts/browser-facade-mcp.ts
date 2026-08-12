import { readFileSync } from 'node:fs';
import { ProjectExecutionProfileSchema } from '@qali/contracts';
import { RestrictedBrowserFacade } from '@qali/browser-facade';
import { createBrowserMcpServer } from '@qali/browser-facade/mcp';
import { PlaywrightBrowserDriver } from '@qali/browser-facade/playwright-driver';
import { resolveBrowserServiceConfig } from '@qali/browser-facade/service-config';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const profile = ProjectExecutionProfileSchema.parse(
    JSON.parse(readFileSync(requiredEnvironment('QALI_EXECUTION_PROFILE_PATH'), 'utf8'))
  );
  const config = resolveBrowserServiceConfig(profile, process.env);
  const driver = await PlaywrightBrowserDriver.launch({
    allowedOrigins: config.allowedOrigins,
    browserName: config.browserName,
    ...(config.executablePath ? { executablePath: config.executablePath } : {})
  });
  const facade = new RestrictedBrowserFacade(driver, {
    baseUrl: config.baseUrl,
    allowedOrigins: config.allowedOrigins,
    credentials: config.credentials,
    testData: config.testData,
    evidenceDirectory: config.evidenceDirectory,
    allowedSubmissions: config.allowedSubmissions,
    redactionPatterns: config.redactionPatterns
  });
  const handle = serveStdio(() => createBrowserMcpServer(facade), {
    onerror: () => process.stderr.write('Qali browser MCP transport error\n')
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await handle.close();
    await driver.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  process.stdin.once('end', () => void close());
}

void main().catch(() => {
  process.stderr.write('Qali browser MCP failed to start\n');
  process.exitCode = 1;
});
