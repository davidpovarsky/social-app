import {useEffect, useMemo, useState} from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  View,
} from 'react-native'
import {setStringAsync} from 'expo-clipboard'
import {Image} from 'expo-image'

import {shareUrl} from '#/lib/sharing'
import {atoms as a, useTheme, web} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {ArrowShareRight_Stroke2_Corner2_Rounded as ShareIcon} from '#/components/icons/ArrowShareRight'
import {Clipboard_Stroke2_Corner2_Rounded as CopyIcon} from '#/components/icons/Clipboard'
import {DotGrid3x1_Stroke2_Corner0_Rounded as MoreIcon} from '#/components/icons/DotGrid'
import {SquareArrowTopRight_Stroke2_Corner0_Rounded as ExternalLinkIcon} from '#/components/icons/SquareArrowTopRight'
import * as Menu from '#/components/Menu'
import * as Toast from '#/components/Toast'
import {Text} from '#/components/Typography'
import {getManuscripts, getText, resolveTorahSource} from '../sefaria/api'
import {
  type SefariaManuscript,
  type SefariaTextResponse,
  type SefariaVersion,
  type TorahSource,
} from '../sefaria/types'

function flattenText(value: unknown): string[] {
  if (typeof value === 'string') {
    const line = value.trim()
    return line ? [line] : []
  }
  if (Array.isArray(value)) return value.flatMap(flattenText)
  return []
}

function languageOf(version: SefariaVersion) {
  return version.language?.toLowerCase()
}

function pickVersion(
  data: SefariaTextResponse | undefined,
  language: 'he' | 'en',
) {
  const versions = data?.versions ?? []
  if (language === 'he') {
    return (
      versions.find(v => languageOf(v) === 'he') ??
      versions.find(v => languageOf(v) === 'hebrew')
    )
  }
  return (
    versions.find(v => languageOf(v) === 'en') ??
    versions.find(v => languageOf(v) === 'english')
  )
}

export function SourceReaderDialog({
  control,
  sourceRef,
}: {
  control: ReturnType<typeof Dialog.useDialogControl>
  sourceRef: string
}) {
  const t = useTheme()
  const [source, setSource] = useState<TorahSource>()
  const [text, setText] = useState<SefariaTextResponse>()
  const [manuscripts, setManuscripts] = useState<SefariaManuscript[]>([])
  const [viewLanguage, setViewLanguage] = useState<'he' | 'en'>('he')
  const [viewMode, setViewMode] = useState<'text' | 'image' | 'manuscripts'>(
    'text',
  )
  const [error, setError] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()

    void Promise.all([
      resolveTorahSource(sourceRef, abort.signal),
      getText(sourceRef, abort.signal),
      getManuscripts(sourceRef, abort.signal),
    ])
      .then(([nextSource, nextText, nextManuscripts]) => {
        if (abort.signal.aborted) return
        setError(undefined)
        setViewMode('text')
        setSource(nextSource)
        setText(nextText)
        setManuscripts(nextManuscripts)
      })
      .catch(err => {
        if (abort.signal.aborted) return
        setError(err instanceof Error ? err.message : 'לא ניתן לטעון את המקור')
      })
    return () => abort.abort()
  }, [sourceRef])

  const hebrewVersion = useMemo(() => pickVersion(text, 'he'), [text])
  const englishVersion = useMemo(() => pickVersion(text, 'en'), [text])
  const hasEnglish = Boolean(englishVersion)

  const hebrewLines = useMemo(
    () => flattenText(hebrewVersion?.text),
    [hebrewVersion],
  )
  const englishLines = useMemo(
    () => flattenText(englishVersion?.text),
    [englishVersion],
  )

  const currentLines = viewLanguage === 'he' ? hebrewLines : englishLines
  const title = source?.heRef || sourceRef

  const handleCopy = async () => {
    const linesToCopy = hebrewLines.length ? hebrewLines : englishLines
    const fullText =
      `${title}\n\n${linesToCopy.join('\n')}\n\n${source?.uri || ''}`.trim()
    await setStringAsync(fullText)
    Toast.show('המקור הועתק ללוח', {type: 'success'})
  }

  const handleShare = () => {
    if (source?.uri) {
      void shareUrl(source.uri)
    }
  }

  return (
    <Dialog.Outer control={control} nativeOptions={{fullHeight: true}}>
      <Dialog.Handle />
      <Dialog.ScrollableInner label={title} style={web({maxWidth: 680})}>
        <View style={[a.w_full, t.atoms.bg]}>
          {/* Minimal, focused header */}
          <View
            style={[
              a.flex_row,
              a.align_center,
              a.justify_between,
              a.px_lg,
              a.py_md,
              a.border_b,
              t.atoms.border_contrast_low,
            ]}>
            <View style={[a.flex_row, a.align_center, a.gap_sm]}>
              {/* Overflow Menu with Secondary Actions */}
              <Menu.Root>
                <Menu.Trigger label="אפשרויות נוספות">
                  {({props}) => (
                    <Pressable
                      {...props}
                      accessibilityRole="button"
                      accessibilityLabel="אפשרויות נוספות"
                      accessibilityHint="פותח תפריט פעולות נוספות"
                      style={({pressed}) => [
                        a.p_xs,
                        a.rounded_sm,
                        a.border,
                        t.atoms.border_contrast_low,
                        {opacity: pressed ? 0.65 : 1},
                      ]}>
                      <MoreIcon size="sm" style={t.atoms.text_contrast_high} />
                    </Pressable>
                  )}
                </Menu.Trigger>
                <Menu.Outer>
                  {source?.uri ? (
                    <Menu.Item
                      label="פתח בספריא"
                      onPress={() => void Linking.openURL(source.uri)}>
                      <Menu.ItemText>פתח בספריא</Menu.ItemText>
                      <Menu.ItemIcon icon={ExternalLinkIcon} position="right" />
                    </Menu.Item>
                  ) : null}

                  <Menu.Item
                    label="העתק מקור"
                    onPress={() => void handleCopy()}>
                    <Menu.ItemText>העתק מקור</Menu.ItemText>
                    <Menu.ItemIcon icon={CopyIcon} position="right" />
                  </Menu.Item>

                  {source?.uri ? (
                    <Menu.Item label="שתף" onPress={handleShare}>
                      <Menu.ItemText>שתף מקור</Menu.ItemText>
                      <Menu.ItemIcon icon={ShareIcon} position="right" />
                    </Menu.Item>
                  ) : null}

                  {source?.imageUrl ? (
                    <Menu.Item
                      label={
                        viewMode === 'image'
                          ? 'חזרה לטקסט'
                          : 'הצג תמונת מקור מעוצבת'
                      }
                      onPress={() =>
                        setViewMode(viewMode === 'image' ? 'text' : 'image')
                      }>
                      <Menu.ItemText>
                        {viewMode === 'image'
                          ? 'חזרה לטקסט'
                          : 'תמונת מקור מעוצבת'}
                      </Menu.ItemText>
                    </Menu.Item>
                  ) : null}

                  {manuscripts.length > 0 ? (
                    <Menu.Item
                      label={
                        viewMode === 'manuscripts'
                          ? 'חזרה לטקסט'
                          : `הצג כתבי יד (${manuscripts.length})`
                      }
                      onPress={() =>
                        setViewMode(
                          viewMode === 'manuscripts' ? 'text' : 'manuscripts',
                        )
                      }>
                      <Menu.ItemText>
                        {viewMode === 'manuscripts'
                          ? 'חזרה לטקסט'
                          : `כתבי יד (${manuscripts.length})`}
                      </Menu.ItemText>
                    </Menu.Item>
                  ) : null}
                </Menu.Outer>
              </Menu.Root>

              {/* Language toggle: עברית / English */}
              {hasEnglish && viewMode === 'text' ? (
                <View
                  style={[
                    a.flex_row,
                    a.align_center,
                    a.rounded_full,
                    a.border,
                    t.atoms.border_contrast_low,
                    a.p_2xs,
                  ]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="הצג בעברית"
                    accessibilityHint="מציג את הטקסט בעברית"
                    onPress={() => setViewLanguage('he')}
                    style={[
                      a.px_sm,
                      a.py_2xs,
                      a.rounded_full,
                      viewLanguage === 'he' && {
                        backgroundColor:
                          t.name === 'dark'
                            ? t.palette.contrast_100
                            : t.palette.contrast_50,
                      },
                    ]}>
                    <Text
                      style={[
                        a.text_xs,
                        viewLanguage === 'he'
                          ? [a.font_semi_bold, t.atoms.text_contrast_high]
                          : t.atoms.text_contrast_medium,
                      ]}>
                      עברית
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="הצג באנגלית"
                    accessibilityHint="מציג את הטקסט באנגלית"
                    onPress={() => setViewLanguage('en')}
                    style={[
                      a.px_sm,
                      a.py_2xs,
                      a.rounded_full,
                      viewLanguage === 'en' && {
                        backgroundColor:
                          t.name === 'dark'
                            ? t.palette.contrast_100
                            : t.palette.contrast_50,
                      },
                    ]}>
                    <Text
                      style={[
                        a.text_xs,
                        viewLanguage === 'en'
                          ? [a.font_semi_bold, t.atoms.text_contrast_high]
                          : t.atoms.text_contrast_medium,
                      ]}>
                      English
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={[a.flex_1, {alignItems: 'flex-end'}]}>
              <Text
                style={[
                  a.text_lg,
                  a.font_semi_bold,
                  {textAlign: 'right', writingDirection: 'rtl'},
                ]}
                numberOfLines={1}>
                {title}
              </Text>
              {source?.category ? (
                <Text
                  style={[
                    a.text_xs,
                    t.atoms.text_contrast_medium,
                    {textAlign: 'right'},
                  ]}
                  numberOfLines={1}>
                  {source.category}
                </Text>
              ) : null}
            </View>
          </View>

          {/* If viewing image or manuscripts, show quick return button */}
          {viewMode !== 'text' ? (
            <View
              style={[
                a.flex_row,
                a.align_center,
                a.justify_between,
                a.px_lg,
                a.py_xs,
                a.border_b,
                t.atoms.border_contrast_low,
                {
                  backgroundColor: t.name === 'dark' ? '#1c1b18' : '#faf8f5',
                },
              ]}>
              <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>
                {viewMode === 'image' ? 'תמונת מקור' : 'כתבי יד'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setViewMode('text')}
                style={({pressed}) => [
                  a.px_sm,
                  a.py_2xs,
                  a.rounded_xs,
                  a.border,
                  t.atoms.border_contrast_low,
                  {opacity: pressed ? 0.7 : 1},
                ]}>
                <Text style={[a.text_xs, a.font_semi_bold]}>
                  ← חזרה לקריאת הטקסט
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Reader Body */}
          <ScrollView
            contentContainerStyle={[a.p_lg, a.gap_md, {paddingBottom: 40}]}>
            {!source && !error ? (
              <View style={[a.py_xl, a.align_center]}>
                <ActivityIndicator />
              </View>
            ) : null}

            {error ? (
              <Text
                style={[
                  a.text_md,
                  {color: t.palette.negative_400, textAlign: 'right'},
                ]}>
                {error}
              </Text>
            ) : null}

            {/* Primary Text View */}
            {viewMode === 'text' && (
              <View style={[a.gap_md]}>
                {currentLines.length ? (
                  currentLines.map((line, index) => (
                    <Text
                      key={`line-${index}`}
                      style={[
                        viewLanguage === 'he'
                          ? [
                              a.text_lg,
                              a.leading_relaxed,
                              {
                                textAlign: 'right',
                                writingDirection: 'rtl',
                              },
                            ]
                          : [a.text_md, a.leading_normal, {textAlign: 'left'}],
                      ]}>
                      {line}
                    </Text>
                  ))
                ) : source && !error ? (
                  <Text
                    style={[
                      a.text_sm,
                      t.atoms.text_contrast_medium,
                      {textAlign: 'right'},
                    ]}>
                    טקסט המקור אינו זמין בתצוגה מהירה.
                  </Text>
                ) : null}
              </View>
            )}

            {/* Source Image View */}
            {viewMode === 'image' && source?.imageUrl ? (
              <View style={[a.gap_md, a.align_center]}>
                <View
                  style={[
                    a.w_full,
                    a.rounded_sm,
                    a.overflow_hidden,
                    a.border,
                    t.atoms.border_contrast_low,
                    {aspectRatio: 16 / 9, maxHeight: 420},
                  ]}>
                  <Image
                    source={{uri: source.imageUrl}}
                    style={[a.w_full, a.h_full]}
                    contentFit="contain"
                    accessibilityLabel={`תמונת מקור: ${title}`}
                    accessibilityHint="מציג תמונת מקור מלאה"
                  />
                </View>
                <Text
                  style={[
                    a.text_xs,
                    t.atoms.text_contrast_medium,
                    a.text_center,
                  ]}>
                  תמונת ציטוט רשמית מבית Sefaria
                </Text>
              </View>
            ) : null}

            {/* Manuscripts View */}
            {viewMode === 'manuscripts' ? (
              <View style={a.gap_lg}>
                {manuscripts.map((ms, index) => (
                  <View
                    key={`${ms.manuscript_slug}-${ms.page_id}-${index}`}
                    style={[
                      a.gap_xs,
                      a.p_md,
                      a.rounded_sm,
                      a.border,
                      t.atoms.border_contrast_low,
                    ]}>
                    <Text
                      style={[
                        a.text_sm,
                        a.font_semi_bold,
                        {textAlign: 'right'},
                      ]}>
                      {ms.manuscript?.he_title ||
                        ms.manuscript?.title ||
                        ms.manuscript_slug}
                    </Text>
                    {ms.page_id ? (
                      <Text
                        style={[
                          a.text_xs,
                          t.atoms.text_contrast_medium,
                          {textAlign: 'right'},
                        ]}>
                        עמוד / דף: {ms.page_id}
                      </Text>
                    ) : null}
                    <View
                      style={[
                        a.w_full,
                        a.rounded_xs,
                        a.overflow_hidden,
                        a.mt_xs,
                        {
                          aspectRatio: 3 / 4,
                          maxHeight: 460,
                          backgroundColor: t.palette.contrast_50,
                        },
                      ]}>
                      <Image
                        source={{uri: ms.image_url || ms.thumbnail_url}}
                        style={[a.w_full, a.h_full]}
                        contentFit="contain"
                        accessibilityLabel={`כתב יד: ${
                          ms.manuscript?.title || ms.page_id
                        }`}
                        accessibilityHint="מציג צילום כתב יד"
                      />
                    </View>
                    {ms.manuscript?.description ? (
                      <Text
                        style={[
                          a.text_xs,
                          t.atoms.text_contrast_medium,
                          {textAlign: 'right'},
                        ]}>
                        {ms.manuscript.description}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {/* Quiet metadata footer */}
            {source?.versionTitle ? (
              <View style={[a.pt_md, a.border_t, t.atoms.border_contrast_low]}>
                <Text
                  style={[
                    a.text_2xs,
                    t.atoms.text_contrast_medium,
                    {textAlign: 'right'},
                  ]}>
                  {source.versionTitle}
                  {source.license ? ` · ${source.license}` : ''}
                  {' · Sefaria'}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Dialog.ScrollableInner>
    </Dialog.Outer>
  )
}
