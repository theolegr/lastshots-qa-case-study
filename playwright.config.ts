import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",

  timeout: 120_000,
  expect: { timeout: 10_000 },

  // Zero the anon sign-in counter before the run, print the total after it. The
  // budget is this suite's binding resource and every figure published for it
  // used to be counted by hand — which is how it came to be wrong by ~38%
  // (BUG-009). See tests/e2e/helpers/signin-budget.ts.
  globalSetup: "./tests/e2e/helpers/global-setup.ts",
  globalTeardown: "./tests/e2e/helpers/global-teardown.ts",

  use: {
    baseURL: "http://localhost:8080",
    // retain-on-failure, not on-first-retry: retries are 0 by design (flakiness is
    // fixed at the source), so on-first-retry would never produce a single trace.
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,

    locale: "en-US",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--disable-features=TranslateUI",
        "--lang=en-US",
      ],
    },
  },

  projects: [
    {
      name: "chromium-mobile",
      use: {
        // iPhone 15 Pro Max device profile forced to Chromium
        // (WebKit doesn't support fake camera flags or permissions API)
        ...devices["iPhone 15 Pro Max"],
        defaultBrowserType: "chromium",
        permissions: ["camera"],
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
