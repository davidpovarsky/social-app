import {View} from 'react-native'

import {atoms as a} from '#/alf'
import {DetectedTorahSources} from './DetectedTorahSources'
import {TorahComposerSourceButton} from './TorahComposerSourceButton'

export function TorahComposerExtensions({
  text,
  onSelectUri,
}: {
  text: string
  onSelectUri: (uri: string) => void
}) {
  return (
    <View style={[a.mt_xs, a.gap_xs]}>
      <View style={[a.flex_row, a.justify_end]}>
        <TorahComposerSourceButton onSelectUri={onSelectUri} />
      </View>
      <DetectedTorahSources text={text} onSelectUri={onSelectUri} />
    </View>
  )
}
