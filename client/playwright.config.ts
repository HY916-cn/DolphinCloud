import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against a running production image: docker/e2e-test.sh starts one, seeds it and sets E2E_BASE.
// The counter runs on iPads (1180×820), students use phones: Chromium runs everything, WebKit the counter and the
// student pages, and a phone the student pages.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE ?? 'https://localhost:18445',
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1180, height: 820 },
        // The test container uses Caddy's own CA; Chromium registers a service worker only for a trusted certificate.
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    {
      name: 'webkit',
      testMatch: ['counter.spec.ts', 'student.spec.ts', 'book.spec.ts'],
      use: { ...devices['Desktop Safari'], viewport: { width: 1180, height: 820 } },
    },
    {
      name: 'phone',
      testMatch: ['student.spec.ts', 'book.spec.ts'], // the back office and the counter are laid out for computers and iPads
      use: { ...devices['iPhone 13'] },
    },
  ],
});
