import {useCallback} from 'react'
import {useQueryClient} from '@tanstack/react-query'

import {precacheResolveLinkQuery} from '#/state/queries/resolve-link'
import {refFromSefariaUri} from '../sources/url'

/**
 * Keeps all Sefaria-specific link metadata outside the upstream composer.
 * The selected source is still stored as a standard app.bsky.embed.external
 * URI; we only pre-cache the metadata so the composer never needs Bluesky's
 * link metadata service for a Torah source preview.
 */
export function useTorahSourceSelection(
  onSelectUri: (uri: string) => void,
) {
  const queryClient = useQueryClient()

  return useCallback(
    (uri: string) => {
      const ref = refFromSefariaUri(uri)
      precacheResolveLinkQuery(queryClient, uri, {
        type: 'external',
        uri,
        title: ref || 'Sefaria',
        description: 'מקור תורני ב־Sefaria',
        thumb: undefined,
      })
      onSelectUri(uri)
    },
    [onSelectUri, queryClient],
  )
}
