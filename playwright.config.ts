import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './projects',
  testMatch: '**/tests/**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:4173',
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
  webServer: {
    command: 'node projects/_demo/app/server.mjs',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
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
