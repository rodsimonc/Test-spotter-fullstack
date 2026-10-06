import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'
import {
  baseURL,
  isLive,
  isRemote,
  ports,
  realUpstream,
  upstreamURL,
  usePreview,
} from './e2e/helpers/env'

// Three local servers back the specs: a fake OSRM/Photon/Nominatim, Django pointed at it, and Vite.
// Set E2E_BASE_URL to skip all of them and test a deployed site. See docs/testing.md.

const ci = Boolean(process.env.CI)
const reuseExistingServer = process.env.E2E_REUSE_SERVERS === '1'
const workers = Number(process.env.E2E_WORKERS) || (ci ? 2 : 3)

function localServers(): PlaywrightTestConfig['webServer'] {
  const viteCommand = usePreview
    ? `npm run build && npm run preview -- --port ${ports.preview}`
    : `npm run dev -- --port ${ports.vite}`
  return [
    // Not needed when Django talks to the real services.
    ...(isLive
      ? []
      : [
          {
            command: 'node e2e/fake-upstream/server.mjs',
            url: `${upstreamURL}/health`,
            reuseExistingServer,
            timeout: 30_000,
          },
        ]),
    {
      command: 'node e2e/scripts/start-django.mjs',
      url: `http://127.0.0.1:${ports.django}/api/health`,
      reuseExistingServer,
      timeout: 180_000,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    },
    {
      command: viteCommand,
      url: baseURL,
      reuseExistingServer,
      timeout: 240_000,
    },
  ]
}

const desktop = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
  // Fixed so the form's default time zone is the same on every machine.
  timezoneId: 'America/Chicago',
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
}

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/artifacts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers,
  globalTimeout: ci ? 25 * 60_000 : undefined,
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: desktop,
      // @fake specs need the scripted upstream. @live specs have their own project.
      grepInvert: realUpstream ? /@fake|@live/ : /@live/,
    },
    {
      // The specs in here skip themselves unless E2E_LIVE=1 or E2E_BASE_URL is set.
      name: 'live',
      use: desktop,
      grep: /@live/,
      timeout: 120_000,
    },
  ],
  webServer: isRemote ? undefined : localServers(),
})
