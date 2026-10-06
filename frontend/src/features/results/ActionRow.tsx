import { useState } from 'react'
import { BookmarkCheck, Download, Printer, Save, Share2 } from 'lucide-react'
import type { PlanResponse } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { downloadBlob, exportLogsToPdf } from '@/features/logs'
import { buildShareUrl } from '@/lib/share'

interface ActionRowProps {
  plan: PlanResponse
  saving: boolean
  saved: boolean
  onSave: () => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and non-secure pages have no clipboard API. Fall back to a hidden textarea.
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.append(box)
    box.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      box.remove()
    }
  }
}

function pdfFilename(plan: PlanResponse): string {
  return `eld-logs-${plan.request.departure.slice(0, 10)}.pdf`
}

export function ActionRow({ plan, saving, saved, onSave }: ActionRowProps) {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  async function share() {
    const url = buildShareUrl(plan.request, window.location)
    if (await copyText(url)) {
      toast.show('Link copied. Anyone with it can plan this trip.')
      return
    }
    window.history.replaceState(null, '', url)
    toast.show("Couldn't copy automatically. The link is now in your address bar.", 'info')
  }

  async function downloadPdf() {
    setExporting(true)
    try {
      const filename = pdfFilename(plan)
      downloadBlob(await exportLogsToPdf(plan.logs, filename), filename)
      toast.show(
        `Downloaded ${plan.logs.length} log ${plan.logs.length === 1 ? 'sheet' : 'sheets'} as a PDF.`,
      )
    } catch {
      toast.show("Couldn't build the PDF. Try again, or use Print.", 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Button
        size="sm"
        data-testid="btn-share"
        icon={<Share2 aria-hidden="true" className="size-4 text-teal-700" />}
        onClick={() => void share()}
      >
        Share link
      </Button>
      <Button
        size="sm"
        data-testid="btn-pdf"
        loading={exporting}
        icon={<Download aria-hidden="true" className="size-4 text-teal-700" />}
        onClick={() => void downloadPdf()}
      >
        Download PDF
      </Button>
      <Button
        size="sm"
        data-testid="btn-print"
        icon={<Printer aria-hidden="true" className="size-4 text-teal-700" />}
        onClick={() => window.print()}
      >
        Print
      </Button>
      <Button
        size="sm"
        variant="dark"
        data-testid="btn-save"
        loading={saving}
        disabled={saved}
        icon={
          saved ? (
            <BookmarkCheck aria-hidden="true" className="size-4" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )
        }
        onClick={onSave}
      >
        {saved ? 'Saved' : 'Save trip'}
      </Button>
    </div>
  )
}
