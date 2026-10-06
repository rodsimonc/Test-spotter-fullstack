import type { Download } from '@playwright/test'

export async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/**
 * Counts pages without a PDF library: one `/Type /Page` dictionary per page. Falls back to the
 * `/Count` of the page tree for files that pack their objects into compressed streams.
 */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  const pageObjects = text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0
  if (pageObjects > 0) return pageObjects
  const counts = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  )
  return counts.length ? Math.max(...counts) : 0
}

export const startsLikePdf = (pdf: Buffer): boolean =>
  pdf.subarray(0, 5).toString('latin1') === '%PDF-'
