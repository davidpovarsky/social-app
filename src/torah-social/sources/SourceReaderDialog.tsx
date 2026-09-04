import {useEffect, useMemo, useState} from 'react'
import {ActivityIndicator, Pressable, ScrollView, View} from 'react-native'

import {atoms as a, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Text} from '#/components/Typography'
import {getText, resolveTorahSource} from '../sefaria/api'
import type {SefariaTextResponse, SefariaVersion, TorahSource} from '../sefaria/types'

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
  const [error, setError] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()
    setError(undefined)
    void Promise.all([
      resolveTorahSource(sourceRef, abort.signal),
      getText(sourceRef, abort.signal),
    ])
      .then(([nextSource, nextText]) => {
        setSource(nextSource)
        setText(nextText)
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
      <View style={[a.flex_1, t.atoms.bg]}>
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

        <ScrollView contentContainerStyle={[a.p_lg, a.gap_lg]}>
          {!source && !error ? <ActivityIndicator /> : null}
          {error ? (
            <Text style={[a.text_md, {textAlign: 'right'}]}>{error}</Text>
          ) : null}

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

          {source?.versionTitle ? (
            <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>
              {source.versionTitle}
              {source.license ? ` · ${source.license}` : ''}
              {' · Sefaria'}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Dialog.Outer>
  )
}
