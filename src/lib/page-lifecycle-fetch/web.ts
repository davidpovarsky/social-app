import {AbortError} from '#/lib/async/cancelable'
import {getRequestSignal, markRequestAborted} from '#/lib/request-cancellation'

/** Keep a controller alive for exactly as long as its signal is reachable. */
const controllers = new WeakMap<AbortSignal, AbortController>()
const signalCleanup = new FinalizationRegistry<SignalLinks>(links => {
  links.dispose()
})

/**
 * Parent listeners hold weak references. A completed response can release its
 * signal without being retained until the next pagehide. Finalization only
 * removes unused listeners; cancellation never depends on when GC runs.
 */
class SignalLinks implements EventListenerObject {
  private controller: WeakRef<AbortController>
  private parents: AbortSignal[]

  constructor(controller: AbortController, parents: AbortSignal[]) {
    this.controller = new WeakRef(controller)
    this.parents = parents
  }

  handleEvent(event: Event) {
    const signal = event.target as AbortSignal
    markRequestAborted(signal.reason)
    this.controller.deref()?.abort(signal.reason)
  }

  dispose() {
    for (const signal of this.parents) {
      signal.removeEventListener('abort', this)
    }
    signalCleanup.unregister(this)
  }
}

/** Safari 15.4 supports these primitives but does not have AbortSignal.any. */
function combineSignals(page: AbortSignal, caller: AbortSignal): AbortSignal {
  if (caller.aborted) return caller
  if (page.aborted || page === caller) return page
  const controller = new AbortController()
  const links = new SignalLinks(controller, [page, caller])
  controllers.set(controller.signal, controller)
  controller.signal.addEventListener('abort', links.dispose.bind(links), {
    once: true,
  })
  page.addEventListener('abort', links, {once: true})
  caller.addEventListener('abort', links, {once: true})
  signalCleanup.register(controller.signal, links, links)
  return controller.signal
}

/**
 * Cancel document-owned work on navigation, not on tab backgrounding. Keep the
 * signal connected after response headers so streamed/body reads also abort.
 */
export function createPageLifecycleFetch(
  page: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  fetchImpl: typeof fetch,
) {
  let controller = new AbortController()
  const hide = () => controller.abort(new AbortError())
  const show = () => {
    if (controller.signal.aborted) controller = new AbortController()
  }
  page.addEventListener('pagehide', hide)
  page.addEventListener('pageshow', show)

  const lifecycleFetch: typeof fetch = (input, init) => {
    const request =
      typeof Request !== 'undefined' && input instanceof Request
        ? input
        : undefined
    const keepalive = init?.keepalive ?? request?.keepalive
    if (keepalive) return fetchImpl(input, init)

    const signal = controller.signal
    // This document controller only aborts with our AbortError.
    if (signal.aborted) return Promise.reject(signal.reason as Error)
    const caller = getRequestSignal(input, init)
    return fetchImpl(input, {
      ...init,
      signal: caller ? combineSignals(signal, caller) : signal,
    })
  }

  return {
    fetch: lifecycleFetch,
    getSignal: () => controller.signal,
    dispose() {
      page.removeEventListener('pagehide', hide)
      page.removeEventListener('pageshow', show)
      hide()
    },
  }
}
