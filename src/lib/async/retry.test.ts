import {AbortError} from '#/lib/async/cancelable'
import {isRetryableRequestError, networkRetry} from '#/lib/async/retry'

let mockPageSignal: AbortSignal | undefined
jest.mock('#/lib/page-lifecycle-fetch', () => ({
  getPageSignal: () => mockPageSignal,
}))

afterEach(() => {
  mockPageSignal = undefined
  jest.useRealTimers()
})

describe('retry', () => {
  it('identifies retryable request errors', () => {
    expect(isRetryableRequestError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryableRequestError(new Error('Invalid request'))).toBe(false)
  })

  it('does not retry cancellation wrapped by XRPC', async () => {
    const error = new Error('Unable to fulfill XRPC request', {
      cause: new AbortError(),
    })
    const action = jest.fn().mockRejectedValue(error)
    expect(isRetryableRequestError(error)).toBe(false)
    await expect(networkRetry(3, action)).rejects.toBe(error)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('still retries a genuine transient network failure', async () => {
    const action = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('recovered')
    await expect(networkRetry(3, action)).resolves.toBe('recovered')
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('does not begin work on a hidden page', async () => {
    const controller = new AbortController()
    controller.abort(new AbortError())
    mockPageSignal = controller.signal
    const action = jest.fn().mockResolvedValue('unexpected')
    await expect(networkRetry(3, action)).rejects.toBe(controller.signal.reason)
    expect(action).not.toHaveBeenCalled()
    expect(isRetryableRequestError(new TypeError('Failed to fetch'))).toBe(
      false,
    )
  })

  it('does not revive a delayed old retry when a BFCache page returns', async () => {
    jest.useFakeTimers()
    const controller = new AbortController()
    mockPageSignal = controller.signal
    const action = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const pending = networkRetry(3, action, 100)
    const result = expect(pending).rejects.toMatchObject({name: 'AbortError'})
    await jest.advanceTimersByTimeAsync(0)
    expect(action).toHaveBeenCalledTimes(1)
    controller.abort(new AbortError())
    mockPageSignal = new AbortController().signal
    await jest.advanceTimersByTimeAsync(100)
    await result
    expect(action).toHaveBeenCalledTimes(1)
    const fresh = jest.fn().mockResolvedValue('restored')
    await expect(networkRetry(3, fresh)).resolves.toBe('restored')
  })
})
