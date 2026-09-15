import {type StyleProp, type TextStyle} from 'react-native'

import * as Dialog from '#/components/Dialog'
import {InlineLinkText} from '#/components/Link'
import {SourceReaderDialog} from './SourceReaderDialog'
import {cleanSefariaUri, refFromSefariaUri} from './url'

export function TorahInlineLink({
  uri,
  text,
  style,
  selectable,
}: {
  uri: string
  text: string
  style?: StyleProp<TextStyle>
  selectable?: boolean
}) {
  const control = Dialog.useDialogControl()
  const cleanUri = cleanSefariaUri(uri)
  const displayRef = refFromSefariaUri(uri) || text

  return (
    <>
      <InlineLinkText
        selectable={selectable}
        to={cleanUri}
        style={style}
        emoji
        onPress={e => {
          e.preventDefault?.()
          control.open()
        }}>
        {text}
      </InlineLinkText>
      <SourceReaderDialog control={control} sourceRef={displayRef || uri} />
    </>
  )
}
