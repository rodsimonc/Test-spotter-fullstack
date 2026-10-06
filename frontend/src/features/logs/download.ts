/** How long the object URL stays alive after the click. Safari drops the download if it goes sooner. */
const REVOKE_DELAY_MS = 1000

/** Saves a blob as a file by clicking a temporary link, then frees the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
