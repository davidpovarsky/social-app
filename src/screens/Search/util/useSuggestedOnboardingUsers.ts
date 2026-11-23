import {useMemo} from 'react'
import {useQuery} from '@tanstack/react-query'

import {useInterestsDisplayNames} from '#/lib/interests'
import {useActorSearch} from '#/state/queries/actor-search'
import {useGetSuggestedOnboardingUsersQuery} from '#/state/queries/trending/useGetSuggestedOnboardingUsersQuery'
import {useAppviewClient} from '#/state/session'
import {app} from '#/lexicons'

/**
 * Conditional hook, used in case a user is a non-english speaker, in which
 * case we fall back to searching for users instead of our more curated set.
 */
export function useSuggestedOnboardingUsers({
  category = null,
  search = false,
  overrideInterests,
}: {
  category?: string | null
  /**
   * If true, we'll search for users using the translated value of `category`,
   * based on the user's app language setting
   */
  search?: boolean
  /**
   * In onboarding, interests haven't been saved to prefs yet, so we need to
   * pass them down through here
   */
  overrideInterests: string[]
}) {
  const interestsDisplayNames = useInterestsDisplayNames()
  const client = useAppviewClient()
  const isTorahNetwork =
    process.env.EXPO_PUBLIC_TORAH_ISOLATED_NETWORK === 'true'
  // Our AppView implements getSuggestions. The Bluesky-specific
  // getSuggestedOnboardingUsers endpoint returns HTTP 501 in this network.
  const local = useQuery({
    queryKey: ['torah-social', 'onboarding', 'local-suggestions'],
    enabled: isTorahNetwork,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const data = await client.call(app.bsky.actor.getSuggestions, {
        limit: 50,
      })
      return {
        actors: data.actors.filter(actor => !/^e2e-/i.test(actor.handle)),
        recId: undefined,
      }
    },
  })
  const curated = useGetSuggestedOnboardingUsersQuery({
    enabled: !isTorahNetwork && !search,
    category,
    overrideInterests,
  })
  const searched = useActorSearch({
    enabled: !isTorahNetwork && !!search,
    // use user's app language translation for this value
    query: category ? interestsDisplayNames[category] : '',
    limit: 10,
  })

  return useMemo(() => {
    if (isTorahNetwork) {
      return {
        data: local.data,
        isLoading: local.isLoading,
        error: local.error,
        isRefetching: local.isRefetching,
        refetch: local.refetch,
      }
    }
    if (search) {
      return {
        // we're not paginating right now
        data: searched?.data
          ? {
              actors: searched.data.pages.flatMap(p => p.actors) ?? [],
              recId: undefined,
            }
          : undefined,
        isLoading: searched.isLoading,
        error: searched.error,
        isRefetching: searched.isRefetching,
        refetch: searched.refetch,
      }
    } else {
      return {
        data: curated.data,
        isLoading: curated.isLoading,
        error: curated.error,
        isRefetching: curated.isRefetching,
        refetch: curated.refetch,
      }
    }
  }, [curated, searched, search, isTorahNetwork, local])
}
