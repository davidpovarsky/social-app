import {device, useStorage} from '#/storage'

export function useThreadgateNudged() {
  const isIsolated =
    process.env.EXPO_PUBLIC_TORAH_ISOLATED_NETWORK === 'true'
  const [threadgateNudged = isIsolated, setThreadgateNudged] = useStorage(
    device,
    ['threadgateNudged'],
  )

  return [isIsolated || threadgateNudged, setThreadgateNudged] as const
}
