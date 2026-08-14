import { defineConfig, devices } from '@playwright/test';

const targetBaseUrl = process.env.QALI_TARGET_BASE_URL?.trim();
if (!targetBaseUrl) throw new Error('QALI_TARGET_BASE_URL is required');
const webServerCommand = process.env.QALI_WEB_SERVER_COMMAND?.trim();
const webServerUrl = process.env.QALI_WEB_SERVER_URL?.trim();
if (Boolean(webServerCommand) !== Boolean(webServerUrl)) {
  throw new Error('QALI_WEB_SERVER_COMMAND and QALI_WEB_SERVER_URL must be configured together');
}

export default defineConfig({
  testDir: './projects',
  testMatch: '**/tests/**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [
    [
      'json',
      { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'test-results/results.json' }
    ],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: targetBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(process.platform === 'darwin'
      ? {
          launchOptions: {
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          }
        }
      : {})
  },
  snapshotPathTemplate:
    '{testDir}/{testFileDir}/__snapshots__/{testFileName}/{projectName}/{arg}{ext}',
  ...(webServerCommand && webServerUrl
    ? {
        webServer: {
          command: webServerCommand,
          url: webServerUrl,
          reuseExistingServer: false,
          timeout: 30_000
        }
      }
    : {}),
  projects: [
    {
      name: 'functional-chromium',
      grepInvert: /@visual/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'visual-chromium',
      grep: /@visual/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' }
    }
  ]
});
