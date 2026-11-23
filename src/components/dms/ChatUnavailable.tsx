import {View} from 'react-native'
import {Trans, useLingui} from '@lingui/react/macro'

import {atoms as a, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Message_Stroke2_Corner0_Rounded as MessageIcon} from '#/components/icons/Message'
import * as Layout from '#/components/Layout'
import {Text} from '#/components/Typography'

function ChatUnavailableContent() {
  const t = useTheme()
  return (
    <View testID="chatUnavailable" style={[a.align_center, a.gap_lg, a.py_2xl]}>
      <MessageIcon size="3xl" fill={t.atoms.text_contrast_medium.color} />
      <Text style={[a.text_xl, a.font_bold, a.text_center]}>
        <Trans>Chats are not available on this network</Trans>
      </Text>
      <Text style={[a.text_md, a.leading_snug, a.text_center]}>
        <Trans>You can still read posts, reply, and share links.</Trans>
      </Text>
    </View>
  )
}

export function ChatUnavailableScreen() {
  return (
    <Layout.Screen>
      <Layout.Header.Outer>
        <Layout.Header.BackButton />
        <Layout.Header.Content align="left">
          <Layout.Header.TitleText>
            <Trans>Chats</Trans>
          </Layout.Header.TitleText>
        </Layout.Header.Content>
        <Layout.Header.Slot />
      </Layout.Header.Outer>
      <Layout.Content>
        <View style={[a.p_lg]}>
          <ChatUnavailableContent />
        </View>
      </Layout.Content>
    </Layout.Screen>
  )
}

export function ChatUnavailableDialogContent() {
  const {t: l} = useLingui()
  return (
    <Dialog.Inner label={l`Chats are not available on this network`}>
      <ChatUnavailableContent />
      <Dialog.Close />
    </Dialog.Inner>
  )
}
