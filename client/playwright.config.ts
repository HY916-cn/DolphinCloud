import { defineConfig } from '@playwright/test';

// End-to-end tests against a running production image: docker/e2e-test.sh starts one, seeds it and sets E2E_BASE.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE ?? 'https://localhost:18445',
    ignoreHTTPSErrors: true,
    // The test container uses Caddy's own CA; Chromium registers a service worker only for a trusted certificate.
    launchOptions: { args: ['--ignore-certificate-errors'] },
    viewport: { width: 1180, height: 820 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
});
