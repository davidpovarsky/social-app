/** Native and server runtimes have no browser document lifecycle. */
export const pageLifecycleFetch: typeof fetch = globalThis.fetch

export function getPageSignal(): AbortSignal | undefined {
  return undefined
}
