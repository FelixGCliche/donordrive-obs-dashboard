import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { Button, Input, Label } from '@components'

const COPIED_RESET_MS = 2000

export type UrlOutputProps = {
  label: string
  /** Full URL, copied to the clipboard */
  value: string
  /** What the field shows instead of `value`, e.g. with the key masked */
  displayValue?: string
  description?: React.ReactNode
  disabled?: boolean
}

/** Read-only URL field with a Copy button. */
export const UrlOutput = ({
  label,
  value,
  displayValue,
  description,
  disabled,
}: UrlOutputProps) => {
  const id = useId()
  const descriptionId = useId()
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timeout = window.setTimeout(() => setCopied(null), COPIED_RESET_MS)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={displayValue ?? value}
          className="font-mono text-xs"
          aria-describedby={description ? descriptionId : undefined}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" variant="outline" onClick={copy} disabled={disabled}>
          {copied === 'ok' ? <CheckIcon /> : <CopyIcon />}
          {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
        </Button>
      </div>
      {description && (
        <p id={descriptionId} className="text-muted-foreground text-sm">
          {description}
        </p>
      )}
    </div>
  )
}
