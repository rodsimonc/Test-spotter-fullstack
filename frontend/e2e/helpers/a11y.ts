import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** Selectors axe should skip. Empty on purpose: add an entry only with a written reason. */
const EXCLUDED: string[] = []

/**
 * Runs axe against WCAG 2.0 and 2.1 A and AA rules and fails on serious or critical findings.
 * Moderate and minor ones are left out of the failure but printed to the test output.
 */
export async function expectNoSeriousA11yViolations(page: Page, name: string): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  for (const selector of EXCLUDED) builder.exclude(selector)
  const { violations } = await builder.analyze()

  const describe = (v: (typeof violations)[number]) =>
    `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join('\n    ')}`

  const minor = violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')
  if (minor.length)
    console.log(`axe, ${name}, minor findings:\n  ${minor.map(describe).join('\n  ')}`)

  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map(describe), `serious or critical axe violations on: ${name}`).toEqual([])
}
