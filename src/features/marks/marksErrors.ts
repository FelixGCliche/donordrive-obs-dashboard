/** Message of a marks request rejected because the credential is unknown, wrong or rotated. */
export const MARKS_UNAUTHORIZED_MESSAGE =
  'Owner key invalid or rotated — copy the dock URL again from setup'

/** Message of a marks write sent with a read-only credential. */
export const MARKS_FORBIDDEN_MESSAGE = "This credential can't change marks"

/** Message of a marks request refused by the rate limit. */
export const MARKS_RATE_LIMITED_MESSAGE = 'Too many requests, try again shortly'

/** User-facing message for a failed marks request with HTTP `status`. */
export const marksErrorMessage = (status: number): string => {
  switch (status) {
    case 401:
      return MARKS_UNAUTHORIZED_MESSAGE
    case 403:
      return MARKS_FORBIDDEN_MESSAGE
    case 429:
      return MARKS_RATE_LIMITED_MESSAGE
    default:
      return `Marks request failed (${status})`
  }
}

/** Whether a marks request failed because the credential no longer works. */
export const isMarksUnauthorizedError = (error: unknown): boolean =>
  error instanceof Error && error.message === MARKS_UNAUTHORIZED_MESSAGE
