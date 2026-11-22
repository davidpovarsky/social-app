import {useEffect, useState} from 'react'
import {AppState, type AppStateStatus} from 'react-native'
import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister'
import {
  type DehydrateOptions,
  focusManager,
  onlineManager,
  QueryClient,
} from '@tanstack/react-query'
import {
  type PersistQueryClientOptions,
  PersistQueryClientProvider,
} from '@tanstack/react-query-persist-client'

import {PUBLIC_BSKY_SERVICE} from '#/lib/constants'
import {checkServiceHealth} from '#/lib/network-health'
import {getPageSignal} from '#/lib/page-lifecycle-fetch'
import {createPersistedQueryStorage} from '#/lib/persisted-query-storage'
import {listenNetworkConfirmed, listenNetworkLost} from '#/state/events'
import {isQueryPersisted} from '#/state/queries/util'
import * as env from '#/env'
import {IS_NATIVE, IS_WEB} from '#/env'
import {
  isFollowingSnapshotQuery,
  loadFollowingSnapshot,
  saveFollowingSnapshot,
} from '#/features/followingV2/home/queries/followingSnapshot'

declare global {
  interface Window {
    __TANSTACK_QUERY_CLIENT__: QueryClient
  }
}

function checkIsOnline(): Promise<boolean> {
  return checkServiceHealth(PUBLIC_BSKY_SERVICE)
}

let receivedNetworkLost = false
let receivedNetworkConfirmed = false
let isNetworkStateUnclear = false

listenNetworkLost(() => {
  receivedNetworkLost = true
  onlineManager.setOnline(false)
})

listenNetworkConfirmed(() => {
  receivedNetworkConfirmed = true
  onlineManager.setOnline(true)
})

let checkPromise: Promise<void> | undefined
let checkPageSignal: AbortSignal | undefined
function checkIsOnlineIfNeeded() {
  const pageSignal = getPageSignal()
  if (pageSignal?.aborted || (checkPromise && checkPageSignal === pageSignal)) {
    return
  }
  checkPageSignal = pageSignal
  receivedNetworkLost = false
  receivedNetworkConfirmed = false
  const currentCheck: Promise<void> = checkIsOnline().then(nextIsOnline => {
    // A BFCache restoration can start a fresh check before this one settles.
    if (checkPromise !== currentCheck) return
    checkPromise = undefined
    if (pageSignal?.aborted) return
    isNetworkStateUnclear =
      (nextIsOnline && receivedNetworkLost) ||
      (!nextIsOnline && receivedNetworkConfirmed)
    if (!isNetworkStateUnclear) {
      onlineManager.setOnline(nextIsOnline)
    }
  })
  checkPromise = currentCheck
}

setInterval(() => {
  if (!getPageSignal()?.aborted && AppState.currentState === 'active') {
    if (!onlineManager.isOnline() || isNetworkStateUnclear) {
      checkIsOnlineIfNeeded()
    }
  }
}, 2000)

focusManager.setEventListener(onFocus => {
  if (IS_NATIVE) {
    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        focusManager.setFocused(status === 'active')
      },
    )

    return () => subscription.remove()
  } else if (typeof window !== 'undefined' && window.addEventListener) {
    // these handlers are a bit redundant but focus catches when the browser window
    // is blurred/focused while visibilitychange seems to only handle when the
    // window minimizes (both of them catch tab changes)
    // there's no harm to redundant fires because refetchOnWindowFocus is only
    // used with queries that employ stale data times
    const handler = () => onFocus()
    window.addEventListener('focus', handler, false)
    window.addEventListener('visibilitychange', handler, false)
    return () => {
      window.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }
})

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // NOTE
        // refetchOnWindowFocus breaks some UIs (like feeds)
        // so we only selectively want to enable this
        // -prf
        refetchOnWindowFocus: false,
        // Structural sharing between responses makes it impossible to rely on
        // "first seen" timestamps on objects to determine if they're fresh.
        // Disable this optimization so that we can rely on "first seen" timestamps.
        structuralSharing: false,
        // We don't want to retry queries by default, because in most cases we
        // want to fail early and show a response to the user. There are
        // exceptions, and those can be made on a per-query basis. For others, we
        // should give users controls to retry.
        retry: false,
      },
    },
  })

const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateMutation: (_: any) => false,
  shouldDehydrateQuery: query => {
    return (
      (isQueryPersisted(query.queryKey) || isFollowingSnapshotQuery(query)) &&
      query.state.status === 'success'
    )
  },
}

export function QueryProvider({
  children,
  currentDid,
}: {
  children: React.ReactNode
  currentDid: string | undefined
}) {
  return (
    <QueryProviderInner
      // Enforce we never reuse cache between users.
      // These two props MUST stay in sync.
      key={currentDid}
      currentDid={currentDid}>
      {children}
    </QueryProviderInner>
  )
}

function QueryProviderInner({
  children,
  currentDid,
}: {
  children: React.ReactNode
  currentDid: string | undefined
}) {
  const [initialDid] = useState(currentDid)
  if (currentDid !== initialDid) {
    throw Error(
      'Something is very wrong. Expected did to be stable due to key above.',
    )
  }
  // We create the query client here so that it's scoped to a specific DID.
  // Do not move the query client creation outside of this component.
  const [queryClient, _setQueryClient] = useState(() => createQueryClient())
  const [persistOptions, _setPersistOptions] = useState(() => {
    const storage = createPersistedQueryStorage(currentDid ?? 'logged-out')
    const asyncPersister = createAsyncStoragePersister({
      storage,
      key: 'queryClient-' + (currentDid ?? 'logged-out'),
      // JSON, as by default, but with Following v2's Home Following snapshot.
      serialize: client => JSON.stringify(saveFollowingSnapshot(client)),
      deserialize: cached => loadFollowingSnapshot(JSON.parse(cached)),
    })
    return {
      persister: asyncPersister,
      dehydrateOptions,
      buster: env.APP_VERSION,
    } satisfies Omit<PersistQueryClientOptions, 'queryClient'>
  })
  useEffect(() => {
    if (IS_WEB) {
      // WARNING, BROKEN
      // something since v5.32.0 causes OOMs. not important
      // so disable for now
      // window.__TANSTACK_QUERY_CLIENT__ = queryClient
    }
  }, [queryClient])
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  )
}
