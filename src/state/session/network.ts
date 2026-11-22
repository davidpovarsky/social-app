import {getPageSignal, pageLifecycleFetch} from '#/lib/page-lifecycle-fetch'
import {
  getRequestSignal,
  isRequestAborted,
  markRequestAborted,
} from '#/lib/request-cancellation'
import {emitNetworkConfirmed, emitNetworkLost} from '#/state/events'

/**
 * Fetch wrapper that reports network reachability to the app-wide event bus.
 * Resolved HTTP responses confirm connectivity; deliberate cancellation and
 * requests from a discarded document do not change its reachability state.
 */
export const networkAwareFetch: typeof fetch = async (...args) => {
  const pageSignal = getPageSignal()
  const callerSignal = getRequestSignal(...args)
  try {
    const res = await pageLifecycleFetch(...args)
    if (!pageSignal?.aborted) emitNetworkConfirmed()
    return res
  } catch (e) {
    if (pageSignal?.aborted || callerSignal?.aborted || isRequestAborted(e)) {
      markRequestAborted(e)
    } else {
      emitNetworkLost()
    }
    throw e
  }
}
