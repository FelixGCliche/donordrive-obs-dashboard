const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const moneyFormats = new Map<string, Intl.NumberFormat>()

const moneyFormat = (currency: string, fractionDigits: number): Intl.NumberFormat => {
  const cacheKey = `${currency}:${fractionDigits}`
  const cached = moneyFormats.get(cacheKey)
  if (cached) return cached

  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  moneyFormats.set(cacheKey, format)
  return format
}

/** Currency amount, without decimals when the amount is whole (`$50`, `$12.50`). */
export const formatMoney = (amount: number, currency = 'USD'): string =>
  moneyFormat(currency, Number.isInteger(amount) ? 0 : 2).format(amount)

const elapsedMs = (iso: string, now: Date | number): number => {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return Math.max(0, nowMs - Date.parse(iso))
}

/** Compact age for list items: `now`, `2m`, `3h`, `5d`. */
export const formatShortAge = (iso: string, now: Date | number): string => {
  const ms = elapsedMs(iso, now)
  if (Number.isNaN(ms) || ms < 45 * SECOND) return 'now'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

/** Age with a unit and "ago": `12s ago`, `3m ago`. */
export const formatAgo = (iso: string, now: Date | number): string => {
  const ms = elapsedMs(iso, now)
  if (Number.isNaN(ms)) return 'just now'
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s ago`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`
  return `${Math.floor(ms / DAY)}d ago`
}

/** Up to two initials for an avatar fallback. */
export const initials = (name: string): string => {
  const letters = name
    .split(/\s+/)
    .map((word) => word.match(/\p{L}|\p{N}/u)?.[0] ?? '')
    .filter(Boolean)
  return (letters.slice(0, 2).join('') || '?').toUpperCase()
}
