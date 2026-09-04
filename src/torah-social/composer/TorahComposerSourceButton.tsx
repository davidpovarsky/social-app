import {atoms as a} from '#/alf'
import {Button, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import {PageText_Stroke2_Corner0_Rounded as SourceIcon} from '#/components/icons/PageText'
import {SourcePickerDialog} from '../sources/SourcePickerDialog'
import {useTorahSourceSelection} from './useTorahSourceSelection'

/**
 * Torah Social's source picker button. It is intentionally self-contained so
 * the upstream composer only needs to render one component in its toolbar.
 */
export function TorahComposerSourceButton({
  disabled,
  onSelectUri,
}: {
  disabled?: boolean
  onSelectUri: (uri: string) => void
}) {
  const picker = Dialog.useDialogControl()
  const selectSource = useTorahSourceSelection(onSelectUri)

  return (
    <>
      <Button
        label="הוסף מקור תורני"
        disabled={disabled}
        onPress={() => picker.open()}
        style={[a.p_sm, a.gap_xs]}
        variant="ghost"
        shape="default"
        color="primary">
        <SourceIcon size="lg" />
        <ButtonText style={a.text_sm}>מקור</ButtonText>
      </Button>
      <SourcePickerDialog control={picker} onSelect={selectSource} />
    </>
  )
}
