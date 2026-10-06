import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

describe('downloadBlob', () => {
  // jsdom has no object URLs, so the two methods are put on the real URL class and taken off again.
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  const createObjectURL = vi.fn<typeof URL.createObjectURL>()
  const revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>()

  beforeEach(() => {
    vi.useFakeTimers()
    createObjectURL.mockReset().mockReturnValue('blob:eld-test')
    revokeObjectURL.mockReset()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })

  it('clicks a temporary link that points at the blob and carries the file name', () => {
    let attachedAtClick = false
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      attachedAtClick = document.body.querySelector('a[download]') !== null
    })

    const blob = new Blob(['%PDF-1.3'], { type: 'application/pdf' })
    downloadBlob(blob, 'eld-logs.pdf')

    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(attachedAtClick).toBe(true)
    expect(link.getAttribute('href')).toBe('blob:eld-test')
    expect(link.download).toBe('eld-logs.pdf')
  })

  it('removes the link right away and frees the object URL a moment later', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadBlob(new Blob(['x']), 'a.pdf')

    expect(document.body.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:eld-test')
  })
})
