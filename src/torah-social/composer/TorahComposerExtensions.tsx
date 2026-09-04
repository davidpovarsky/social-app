import {useCallback} from 'react'
import {View} from 'react-native'
import {useQueryClient} from '@tanstack/react-query'

import {precacheResolveLinkQuery} from '#/state/queries/resolve-link'
import {atoms as a} from '#/alf'
import {refFromSefariaUri} from '../sources/url'
import {DetectedTorahSources} from './DetectedTorahSources'
import {TorahComposerSourceButton} from './TorahComposerSourceButton'

export function TorahComposerExtensions({
  text,
  onSelectUri,
}: {
  text: string
  onSelectUri: (uri: string) => void
}) {
  const queryClient = useQueryClient()

  const selectSource = useCallback(
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

  return (
    <View style={[a.mt_xs, a.gap_xs]}>
      <View style={[a.flex_row, a.justify_end]}>
        <TorahComposerSourceButton onSelectUri={selectSource} />
      </View>
      <DetectedTorahSources text={text} onSelectUri={selectSource} />
    </View>
  )
}
