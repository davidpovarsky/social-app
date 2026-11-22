import {getPageSignal, pageLifecycleFetch} from './index'

it('keeps native fetch unchanged and has no document cancellation signal', () => {
  const capturedFetch = globalThis.fetch
  expect(pageLifecycleFetch).toBe(capturedFetch)
  expect(getPageSignal()).toBeUndefined()
  const laterPatch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('unrelated patch'))
  expect(pageLifecycleFetch).toBe(capturedFetch)
  expect(pageLifecycleFetch).not.toBe(laterPatch)
  laterPatch.mockRestore()
})
