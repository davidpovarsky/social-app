import {useEffect, useMemo, useState} from 'react'
import {ActivityIndicator, Pressable, ScrollView, View} from 'react-native'
import {Image} from 'expo-image'

import {atoms as a, useTheme, web} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Text} from '#/components/Typography'
import {getManuscripts, getText, resolveTorahSource} from '../sefaria/api'
import type {
  SefariaManuscript,
  SefariaTextResponse,
  SefariaVersion,
  TorahSource,
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

function pickVersion(data: SefariaTextResponse | undefined, language: 'he' | 'en') {
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
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'manuscripts'>('text')
  const [error, setError] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()
    setError(undefined)
    void Promise.all([
      resolveTorahSource(sourceRef, abort.signal),
      getText(sourceRef, abort.signal),
      getManuscripts(sourceRef, abort.signal),
    ])
      .then(([nextSource, nextText, nextManuscripts]) => {
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
  const hebrewLines = useMemo(
    () => flattenText(hebrewVersion?.text),
    [hebrewVersion],
  )
  const englishLines = useMemo(
    () => flattenText(englishVersion?.text),
    [englishVersion],
  )

  return (
    <Dialog.Outer control={control} nativeOptions={{fullHeight: true}}>
      <Dialog.Handle />
      <Dialog.ScrollableInner
        label={source?.heRef || sourceRef}
        style={web({maxWidth: 700})}>
        <View style={[a.w_full, t.atoms.bg]}>
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
          <View style={a.flex_1}>
            <Text
              style={[a.text_lg, a.font_semi_bold, {textAlign: 'right'}]}
              numberOfLines={1}>
              {source?.heRef || sourceRef}
            </Text>
            {source?.heRef !== source?.ref && source?.ref ? (
              <Text style={[a.text_sm, t.atoms.text_contrast_medium]}>
                {source.ref}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="סגור"
            onPress={() => control.close()}
            style={[a.p_sm]}>
            <Text style={[a.text_md, a.font_semi_bold]}>סגור</Text>
          </Pressable>
        </View>

        {/* Tab Navigation */}
        <View
          style={[
            a.flex_row,
            a.align_center,
            a.gap_sm,
            a.px_lg,
            a.py_sm,
            a.border_b,
            t.atoms.border_contrast_low,
            {justifyContent: 'flex-end'},
          ]}>
          {manuscripts.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveTab('manuscripts')}
              style={[
                a.px_md,
                a.py_xs,
                a.rounded_full,
                a.border,
                activeTab === 'manuscripts'
                  ? [t.atoms.border_contrast_high, {backgroundColor: t.palette.contrast_50}]
                  : t.atoms.border_contrast_low,
              ]}>
              <Text
                style={[
                  a.text_sm,
                  activeTab === 'manuscripts' ? a.font_semi_bold : t.atoms.text_contrast_medium,
                ]}>
                כתבי יד ({manuscripts.length})
              </Text>
            </Pressable>
          ) : null}

          {source?.imageUrl ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveTab('image')}
              style={[
                a.px_md,
                a.py_xs,
                a.rounded_full,
                a.border,
                activeTab === 'image'
                  ? [t.atoms.border_contrast_high, {backgroundColor: t.palette.contrast_50}]
                  : t.atoms.border_contrast_low,
              ]}>
              <Text
                style={[
                  a.text_sm,
                  activeTab === 'image' ? a.font_semi_bold : t.atoms.text_contrast_medium,
                ]}>
                תמונת מקור
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('text')}
            style={[
              a.px_md,
              a.py_xs,
              a.rounded_full,
              a.border,
              activeTab === 'text'
                ? [t.atoms.border_contrast_high, {backgroundColor: t.palette.contrast_50}]
                : t.atoms.border_contrast_low,
            ]}>
            <Text
              style={[
                a.text_sm,
                activeTab === 'text' ? a.font_semi_bold : t.atoms.text_contrast_medium,
              ]}>
              טקסט
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[a.p_lg, a.gap_lg]}>
          {!source && !error ? <ActivityIndicator /> : null}
          {error ? (
            <Text style={[a.text_md, {textAlign: 'right'}]}>{error}</Text>
          ) : null}

          {/* Text Tab */}
          {activeTab === 'text' ? (
            <>
              {hebrewLines.length ? (
                <View style={a.gap_md}>
                  {hebrewLines.map((line, index) => (
                    <Text
                      key={`he-${index}`}
                      style={[
                        a.text_xl,
                        a.leading_normal,
                        {textAlign: 'right', writingDirection: 'rtl'},
                      ]}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}

              {englishLines.length ? (
                <View
                  style={[
                    a.gap_md,
                    a.pt_lg,
                    a.border_t,
                    t.atoms.border_contrast_low,
                  ]}>
                  {englishLines.map((line, index) => (
                    <Text key={`en-${index}`} style={[a.text_md, a.leading_normal]}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {/* Image Tab */}
          {activeTab === 'image' && source?.imageUrl ? (
            <View style={[a.gap_md, a.align_center]}>
              <View
                style={[
                  a.w_full,
                  a.rounded_md,
                  a.overflow_hidden,
                  a.border,
                  t.atoms.border_contrast_low,
                  {aspectRatio: 16 / 9, maxHeight: 400},
                ]}>
                <Image
                  source={{uri: source.imageUrl}}
                  style={[a.w_full, a.h_full]}
                  contentFit="contain"
                  accessibilityLabel={`תמונת מקור: ${source.heRef || sourceRef}`}
                />
              </View>
              <Text style={[a.text_xs, t.atoms.text_contrast_medium, a.text_center]}>
                תמונת ציטוט רשמית שנוצרה על ידי Sefaria
              </Text>
            </View>
          ) : null}

          {/* Manuscripts Tab */}
          {activeTab === 'manuscripts' ? (
            <View style={a.gap_xl}>
              {manuscripts.map((ms, index) => (
                <View
                  key={`${ms.manuscript_slug}-${ms.page_id}-${index}`}
                  style={[
                    a.gap_sm,
                    a.p_md,
                    a.rounded_md,
                    a.border,
                    t.atoms.border_contrast_low,
                  ]}>
                  <Text style={[a.text_md, a.font_semi_bold, {textAlign: 'right'}]}>
                    {ms.manuscript?.he_title || ms.manuscript?.title || ms.manuscript_slug}
                  </Text>
                  {ms.page_id ? (
                    <Text style={[a.text_xs, t.atoms.text_contrast_medium, {textAlign: 'right'}]}>
                      עמוד / דף: {ms.page_id}
                    </Text>
                  ) : null}
                  <View
                    style={[
                      a.w_full,
                      a.rounded_sm,
                      a.overflow_hidden,
                      a.mt_xs,
                      {aspectRatio: 3 / 4, maxHeight: 450, backgroundColor: t.palette.contrast_50},
                    ]}>
                    <Image
                      source={{uri: ms.image_url || ms.thumbnail_url}}
                      style={[a.w_full, a.h_full]}
                      contentFit="contain"
                      accessibilityLabel={`כתב יד: ${ms.manuscript?.title || ms.page_id}`}
                    />
                  </View>
                  {ms.manuscript?.description ? (
                    <Text style={[a.text_xs, t.atoms.text_contrast_medium, {textAlign: 'right'}]}>
                      {ms.manuscript.description}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {source?.versionTitle ? (
            <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>
              {source.versionTitle}
              {source.license ? ` · ${source.license}` : ''}
              {' · Sefaria'}
            </Text>
          ) : null}
        </ScrollView>
        </View>
      </Dialog.ScrollableInner>
    </Dialog.Outer>
  )
}
