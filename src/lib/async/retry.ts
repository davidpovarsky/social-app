import {timeout} from '#/lib/async/timeout'
import {getPageSignal} from '#/lib/page-lifecycle-fetch'
import {isRequestAborted} from '#/lib/request-cancellation'
import {isNetworkError, shouldRetryError} from '#/lib/strings/errors'

export function isRetryableRequestError(error: unknown) {
  return (
    !isRequestAborted(error) &&
    !getPageSignal()?.aborted &&
    (isNetworkError(error) || shouldRetryError(error))
  )
}

export async function retry<P>(
  retries: number,
  shouldRetry: (err: any) => boolean,
  action: () => Promise<P>,
  delay?: number,
): Promise<P> {
  let lastErr
  while (retries > 0) {
    try {
      return await action()
    } catch (e: any) {
      lastErr = e
      if (shouldRetry(e)) {
        if (delay) {
          await timeout(delay)
        }
        retries--
        continue
      }
      throw e
    }
  }
  throw lastErr
}

export async function networkRetry<P>(
  retries: number,
  fn: () => Promise<P>,
  delay?: number,
): Promise<P> {
  const pageSignal = getPageSignal()
  return retry(
    retries,
    error =>
      !pageSignal?.aborted && !isRequestAborted(error) && isNetworkError(error),
    () => {
      // A retry delayed before pagehide still belongs to the old lifecycle.
      // This document controller only aborts with our AbortError.
      if (pageSignal?.aborted) return Promise.reject(pageSignal.reason as Error)
      return fn()
    },
    delay,
  )
}
