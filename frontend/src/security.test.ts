// Guards against the ways API text could turn into markup. React escapes text on its own, so the
// risk is in the escape hatches. These checks read the app source and fail if one shows up.
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(
  [
    '/src/**/*.{ts,tsx}',
    '!/src/**/*.test.{ts,tsx}',
    '!/src/test/**',
    '!/src/features/logs/**',
    '!/src/api/types.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const files = Object.entries(sources)

function offenders(pattern: RegExp): string[] {
  return files.filter(([, text]) => pattern.test(text)).map(([path]) => path)
}

describe('app source', () => {
  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('never uses dangerouslySetInnerHTML', () => {
    expect(offenders(/dangerouslySetInnerHTML/)).toEqual([])
  })

  it('never assigns to innerHTML or outerHTML', () => {
    expect(offenders(/\.(inner|outer)HTML\s*=/)).toEqual([])
  })

  it('never writes HTML through other DOM calls', () => {
    expect(
      offenders(/insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/),
    ).toEqual([])
  })

  it('never evaluates strings as code', () => {
    expect(
      offenders(/\beval\s*\(|new Function\s*\(|setTimeout\(\s*['"`]|setInterval\(\s*['"`]/),
    ).toEqual([])
  })

  it('opens every new-tab link with rel noreferrer', () => {
    const bad = files
      .filter(([, text]) =>
        (text.match(/<a\b[^>]*?target="_blank"[^>]*?>/gs) ?? []).some(
          (tag) => !/rel="[^"]*noreferrer/.test(tag),
        ),
      )
      .map(([path]) => path)
    expect(bad).toEqual([])
  })

  it('never fetches or links over plain http', () => {
    const bad = files
      .filter(([, text]) => /['"`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(text))
      .map(([path]) => path)
    expect(bad).toEqual([])
  })

  it('gives Leaflet marker icons an element, never an HTML string', () => {
    const mapSources = files.filter(([path]) => path.includes('/features/map/'))
    const htmlOptions = mapSources.flatMap(([, text]) => text.match(/\bhtml\s*:\s*[^,\n]+/g) ?? [])
    // Every marker face is a detached element. A string here would go through innerHTML.
    expect(htmlOptions.length).toBeGreaterThan(0)
    expect(htmlOptions.filter((option) => option !== 'html: element')).toEqual([])
  })

  it('keeps every network call in the one client that sets credentials and the CSRF header', () => {
    expect(offenders(/\bfetch\(/)).toEqual(['/src/api/client.ts'])
    expect(offenders(/XMLHttpRequest|navigator\.sendBeacon|new WebSocket|new EventSource/)).toEqual(
      [],
    )
  })
})
