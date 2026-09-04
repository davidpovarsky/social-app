import {View} from 'react-native'

import {atoms as a} from '#/alf'
import {DetectedTorahSources} from './DetectedTorahSources'
import {useTorahSourceSelection} from './useTorahSourceSelection'

/**
 * Inline Sefaria-reference suggestions shown above the composer toolbar.
 * The actual manual source-picker control lives in the toolbar itself.
 */
export function TorahComposerExtensions({
  text,
  disabled,
  onSelectUri,
}: {
  text: string
  disabled?: boolean
  onSelectUri: (uri: string) => void
}) {
  const selectSource = useTorahSourceSelection(onSelectUri)

  return (
    <View style={[a.px_sm]}>
      <DetectedTorahSources
        text={text}
        disabled={disabled}
        onSelectUri={selectSource}
      />
    </View>
  )
}
