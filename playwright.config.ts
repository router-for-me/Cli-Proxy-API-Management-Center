import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'bench/baseline/playwright-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    headless: true
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
