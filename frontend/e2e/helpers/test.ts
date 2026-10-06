import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test'
import { randomInt } from 'node:crypto'
import { deflateSync, crc32 } from 'node:zlib'

// Every spec imports `test` and `expect` from here instead of '@playwright/test'.
// What the extra fixtures do:
//  - Each test gets its own client IP (X-Forwarded-For), so the per-IP throttles in the API
//    count per test. Django runs with TRUST_PROXY_HEADERS=1 in local runs.
//  - OSM tile requests get a flat grey tile. The suite never loads the public tile servers.
//  - Uncaught page errors and Content-Security-Policy violations fail the test.

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

/** A solid-colour RGB PNG, built by hand so there is no image file to carry around. */
function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit, truecolour, default compression, filter, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())])
  const pixels = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const TILE = solidPng(256, [226, 234, 234])

export async function stubTiles(context: BrowserContext): Promise<void> {
  await context.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TILE,
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' },
    }),
  )
}

/** A private-range address, different on every call. */
export function randomClientIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`
}

/** Collects problems a user would never see in a screenshot. */
export function watchForProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => {
    if (/ResizeObserver loop/i.test(error.message)) return
    problems.push(`uncaught error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
      problems.push(`CSP violation: ${message.text()}`)
    }
  })
  return problems
}

export interface Session {
  context: BrowserContext
  page: Page
  /** Filled while the test runs. Checked when it ends. */
  problems: string[]
}

type Fixtures = {
  /** A second, separate browser (own cookies and storage) set up like the default one. */
  openSession: (options?: BrowserContextOptions) => Promise<Session>
}

export const test = base.extend<Fixtures>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ ...extraHTTPHeaders, 'X-Forwarded-For': randomClientIp() })
  },

  context: async ({ context }, provide) => {
    await stubTiles(context)
    await provide(context)
  },

  page: async ({ page }, provide) => {
    const problems = watchForProblems(page)
    await provide(page)
    expect.soft(problems, 'uncaught errors or CSP violations during the test').toEqual([])
  },

  openSession: async ({ browser, baseURL, locale, timezoneId, viewport, permissions }, provide) => {
    const sessions: Session[] = []
    await provide(async (options = {}) => {
      const context = await browser.newContext({
        baseURL,
        locale,
        timezoneId,
        viewport,
        permissions,
        acceptDownloads: true,
        extraHTTPHeaders: { 'X-Forwarded-For': randomClientIp() },
        ...options,
      })
      await stubTiles(context)
      const page = await context.newPage()
      const session: Session = { context, page, problems: watchForProblems(page) }
      sessions.push(session)
      return session
    })
    for (const session of sessions) {
      expect.soft(session.problems, 'problems in a second session').toEqual([])
      await session.context.close()
    }
  },
})

export { expect }
