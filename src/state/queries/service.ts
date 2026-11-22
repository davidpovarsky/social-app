import {useQuery} from '@tanstack/react-query'

import {createServiceClient} from '#/lib/lexClient'
import {com} from '#/lexicons'

const RQKEY_ROOT = 'service'
export const RQKEY = (serviceUrl: string) => [RQKEY_ROOT, serviceUrl]

const SERVICE_REQUEST_TIMEOUT_MS = 15_000

async function fetchServiceDescription(
  serviceUrl: string,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    throw signal.reason
  }

  const controller = new AbortController()
  let rejectStopped!: (reason: unknown) => void
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject
  })
  const stop = (reason: unknown) => {
    rejectStopped(reason)
    controller.abort(reason)
  }
  const onAbort = () => stop(signal.reason)
  signal.addEventListener('abort', onAbort, {once: true})
  const timeout = setTimeout(() => {
    const error = new Error('Service discovery timed out')
    error.name = 'TimeoutError'
    stop(error)
  }, SERVICE_REQUEST_TIMEOUT_MS)

  try {
    /*
     * This is the chosen PDS, not the AppView whose health controls the
     * query client's shared online state.
     */
    const client = createServiceClient(serviceUrl)
    const data = await Promise.race([
      client.call(
        com.atproto.server.describeServer,
        {},
        {
          signal: controller.signal,
        },
      ),
      stopped,
    ])
    if (signal.aborted) throw signal.reason
    if (controller.signal.aborted) throw controller.signal.reason
    return data
  } catch (error) {
    // The lex client may wrap fetch errors, including cancellation.
    if (signal.aborted) throw signal.reason
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}

export function useServiceQuery(serviceUrl: string) {
  return useQuery({
    queryKey: RQKEY(serviceUrl),
    queryFn: ({signal}) => fetchServiceDescription(serviceUrl, signal),
    enabled: isValidUrl(serviceUrl),
    networkMode: 'always',
    refetchOnReconnect: true,
  })
}

function isValidUrl(url: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const urlp = new URL(url)
    return true
  } catch {
    return false
  }
}
