import { useId } from 'react'

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components'
import {
  PID_PATTERN,
  dockDensities,
  dockHosts,
  dockIntervals,
  dockThemes,
  type DockDensity,
  type DockHost,
  type DockInterval,
  type DockTheme,
} from '@features/dock'

export type SetupFormValues = {
  /** Raw input; only used once it matches the dock pid pattern */
  pid: string
  host: DockHost
  interval: DockInterval
  theme: DockTheme
  density: DockDensity
}

export const defaultSetupFormValues: SetupFormValues = {
  pid: '',
  host: 'extralife',
  interval: 30,
  theme: 'dark',
  density: 'comfortable',
}

export const isValidPid = (pid: string): boolean => PID_PATTERN.test(pid)

const hostLabels: Record<DockHost, string> = {
  extralife: 'Extra Life',
  try: 'DonorDrive test instance',
}

const themeLabels: Record<DockTheme, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'Match system',
}

const densityLabels: Record<DockDensity, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
}

type FieldSelectProps<T extends string | number> = {
  label: string
  value: T
  options: readonly T[]
  getLabel: (option: T) => string
  onChange: (value: T) => void
}

const FieldSelect = <T extends string | number>({
  label,
  value,
  options,
  getLabel,
  onChange,
}: FieldSelectProps<T>) => {
  const id = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={String(value)}
        onValueChange={(next) => {
          const option = options.find((candidate) => String(candidate) === next)
          if (option !== undefined) onChange(option)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {getLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export type SetupFormProps = {
  values: SetupFormValues
  onChange: (values: SetupFormValues) => void
}

/** Dock settings: participant, site, poll interval, theme and density. */
export const SetupForm = ({ values, onChange }: SetupFormProps) => {
  const pidId = useId()
  const pidHintId = useId()
  const update = <K extends keyof SetupFormValues>(name: K, value: SetupFormValues[K]) =>
    onChange({ ...values, [name]: value })

  const pidInvalid = values.pid !== '' && !isValidPid(values.pid)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor={pidId}>Participant ID</Label>
        <Input
          id={pidId}
          value={values.pid}
          onChange={(event) => update('pid', event.target.value.trim())}
          placeholder="e.g. 123456"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={pidInvalid}
          aria-describedby={pidHintId}
        />
        <p
          id={pidHintId}
          className={pidInvalid ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}
        >
          {pidInvalid
            ? 'Use only letters, numbers and dashes (up to 64 characters).'
            : 'The ID in your participant page URL, e.g. /participants/123456.'}
        </p>
      </div>
      <FieldSelect
        label="Site"
        value={values.host}
        options={dockHosts}
        getLabel={(host) => hostLabels[host]}
        onChange={(host) => update('host', host)}
      />
      <FieldSelect
        label="Refresh every"
        value={values.interval}
        options={dockIntervals}
        getLabel={(interval) => `${interval} seconds`}
        onChange={(interval) => update('interval', interval)}
      />
      <FieldSelect
        label="Theme"
        value={values.theme}
        options={dockThemes}
        getLabel={(theme) => themeLabels[theme]}
        onChange={(theme) => update('theme', theme)}
      />
      <FieldSelect
        label="Density"
        value={values.density}
        options={dockDensities}
        getLabel={(density) => densityLabels[density]}
        onChange={(density) => update('density', density)}
      />
    </div>
  )
}
