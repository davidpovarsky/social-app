import {AbortError} from '#/lib/async/cancelable'
import {isRequestAborted, markRequestAborted} from '#/lib/request-cancellation'

describe('request cancellation', () => {
  it('recognizes an actual aborted signal through nested XRPC causes', () => {
    const controller = new AbortController()
    controller.abort()
    const error = new Error('Unable to fulfill XRPC request', {
      cause: new Error('Fetch failed', {cause: controller.signal.reason}),
    })
    expect(isRequestAborted(error)).toBe(true)
    expect(isRequestAborted(new AbortError())).toBe(true)
  })

  it('does not classify ordinary transport errors or timeouts as cancellation', () => {
    expect(isRequestAborted(new TypeError('Failed to fetch'))).toBe(false)
    expect(isRequestAborted(new Error('Network request timed out'))).toBe(false)
    expect(isRequestAborted({name: 'TimeoutError'})).toBe(false)
    expect(isRequestAborted(new Error('Multipart upload aborted'))).toBe(false)
  })

  it('retains the identity of a caller-provided abort reason through wrappers', () => {
    const reason = new TypeError('Failed to fetch')
    expect(isRequestAborted(reason)).toBe(false)
    markRequestAborted(reason)
    expect(isRequestAborted(new Error('wrapper', {cause: reason}))).toBe(true)
  })

  it('handles cyclic causes and throwing properties without hiding unrelated errors', () => {
    const cycle: {cause?: unknown} = {}
    cycle.cause = cycle
    expect(isRequestAborted(cycle)).toBe(false)
    expect(
      isRequestAborted({
        get name() {
          throw new Error('bad getter')
        },
      }),
    ).toBe(false)
  })
})
