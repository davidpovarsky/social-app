/** Abort reasons observed by the transport, without changing caller errors. */
const abortedRequests = new WeakSet<object>()

export function markRequestAborted(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    abortedRequests.add(error)
  }
}

/** RequestInit overrides the signal inherited from a Request, including null. */
export function getRequestSignal(
  input: RequestInfo | URL,
  init?: RequestInit,
): AbortSignal | null | undefined {
  if (init?.signal !== undefined) return init.signal
  return typeof Request !== 'undefined' && input instanceof Request
    ? input.signal
    : undefined
}

/**
 * Cancellation is not evidence of lost connectivity and must not be retried.
 * XRPC wraps fetch errors, so inspect causes without relying on message text.
 */
export function isRequestAborted(error: unknown): boolean {
  try {
    const seen = new Set<object>()
    let current = error
    while (typeof current === 'object' && current !== null) {
      if (seen.has(current)) return false
      seen.add(current)
      if (
        abortedRequests.has(current) ||
        ('name' in current && current.name === 'AbortError')
      ) {
        return true
      }
      current = 'cause' in current ? current.cause : undefined
    }
    return false
  } catch {
    return false
  }
}
