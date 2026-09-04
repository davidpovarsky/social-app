import {Pressable} from 'react-native'

import {atoms as a, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Text} from '#/components/Typography'
import {SourcePickerDialog} from '../sources/SourcePickerDialog'

export function TorahComposerSourceButton({
  disabled,
  onSelectUri,
}: {
  disabled?: boolean
  onSelectUri: (uri: string) => void
}) {
  const t = useTheme()
  const picker = Dialog.useDialogControl()

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="הוסף מקור תורני"
        disabled={disabled}
        onPress={() => picker.open()}
        style={({pressed}) => [
          a.p_sm,
          a.rounded_sm,
          {
            opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
          },
        ]}>
        <Text style={[a.text_sm, a.font_semi_bold, t.atoms.text]}>＋ מקור</Text>
      </Pressable>
      <SourcePickerDialog control={picker} onSelect={onSelectUri} />
    </>
  )
}
