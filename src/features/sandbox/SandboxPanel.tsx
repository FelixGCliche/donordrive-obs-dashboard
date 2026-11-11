import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components'
import type { Incentive } from '@features/donordrive'

import { parseAmountField } from './sandboxData'
import type { SandboxDonationInput } from './sandboxData'

const NO_INCENTIVE = 'none'

export type SandboxPanelProps = {
  /** Incentives a test donation can redeem (usually `withFallbackIncentives(live)`) */
  incentives: Incentive[]
  /** Number of test donations stored; Clear is disabled at 0 */
  donationCount: number
  onAdd: (input: SandboxDonationInput) => void
  onRandom: () => void
  onClear: () => void
  /** Disables every control, e.g. while the dock has no pid */
  disabled?: boolean
}

/** Form for adding test donations to the dock; holds no data of its own beyond the fields. */
export const SandboxPanel = ({
  incentives,
  donationCount,
  onAdd,
  onRandom,
  onClear,
  disabled = false,
}: SandboxPanelProps) => {
  const id = useId()
  const [displayName, setDisplayName] = useState('')
  const [amountText, setAmountText] = useState('10')
  const [message, setMessage] = useState('')
  const [incentiveId, setIncentiveId] = useState(NO_INCENTIVE)

  const amount = parseAmountField(amountText)
  const selectedIncentive = incentives.find((incentive) => incentive.id === incentiveId)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled || !amount.ok) return
    onAdd({
      displayName,
      amount: amount.amount,
      message,
      incentiveId: selectedIncentive?.id,
    })
    setMessage('')
  }

  return (
    <form className="grid min-w-0 gap-3" onSubmit={handleSubmit} aria-label="Sandbox">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={displayName}
            placeholder="Test donor"
            maxLength={64}
            disabled={disabled}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-amount`}>Amount</Label>
          <Input
            id={`${id}-amount`}
            value={amountText}
            inputMode="decimal"
            placeholder="Hidden"
            aria-invalid={!amount.ok}
            disabled={disabled}
            onChange={(event) => setAmountText(event.target.value)}
          />
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-message`}>Message</Label>
        <Input
          id={`${id}-message`}
          value={message}
          placeholder={selectedIncentive ? 'e.g. a hero name' : 'Optional'}
          maxLength={280}
          disabled={disabled}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>

      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-incentive`}>Incentive</Label>
        <Select value={incentiveId} onValueChange={setIncentiveId} disabled={disabled}>
          <SelectTrigger id={`${id}-incentive`} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_INCENTIVE}>None</SelectItem>
            {incentives.map((incentive) => (
              <SelectItem key={incentive.id} value={incentive.id}>
                <span className="truncate">{incentive.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button type="submit" size="sm" className="px-2" disabled={disabled || !amount.ok}>
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="px-2"
          disabled={disabled}
          onClick={onRandom}
        >
          Random
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="px-2"
          title={`${donationCount} test donations`}
          disabled={disabled || donationCount === 0}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </form>
  )
}
