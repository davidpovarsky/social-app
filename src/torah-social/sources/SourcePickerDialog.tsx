import {useEffect, useState} from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native'

import {atoms as a, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Text} from '#/components/Typography'
import {autocompleteRefs, resolveTorahSource} from '../sefaria/api'
import type {SefariaCompletion} from '../sefaria/types'

export function SourcePickerDialog({
  control,
  onSelect,
}: {
  control: ReturnType<typeof Dialog.useDialogControl>
  onSelect: (uri: string) => void
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SefariaCompletion[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const value = query.trim()
    if (value.length < 2) {
      setSuggestions([])
      setIsSearching(false)
      return
    }

    const abort = new AbortController()
    const timer = setTimeout(() => {
      setIsSearching(true)
      void autocompleteRefs(value, abort.signal)
        .then(items => {
          setSuggestions(items)
          setError(undefined)
        })
        .catch(err => {
          if (abort.signal.aborted) return
          setSuggestions([])
          setError(err instanceof Error ? err.message : 'החיפוש נכשל')
        })
        .finally(() => {
          if (!abort.signal.aborted) setIsSearching(false)
        })
    }, 250)

    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [query])

  const choose = async (value: string) => {
    if (isResolving) return
    setIsResolving(true)
    setError(undefined)
    try {
      const source = await resolveTorahSource(value)
      onSelect(source.uri)
      control.close(() => {
        setQuery('')
        setSuggestions([])
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'המקור לא זוהה')
    } finally {
      setIsResolving(false)
    }
  }

  return (
    <Dialog.Outer control={control} nativeOptions={{fullHeight: true}}>
      <View style={[a.flex_1, t.atoms.bg]}>
        <View
          style={[
            a.p_lg,
            a.gap_md,
            a.border_b,
            t.atoms.border_contrast_low,
          ]}>
          <View style={[a.flex_row, a.align_center, a.justify_between]}>
            <Text style={[a.text_xl, a.font_semi_bold]}>הוסף מקור</Text>
            <Pressable onPress={() => control.close()} style={a.p_sm}>
              <Text style={[a.text_md, a.font_semi_bold]}>סגור</Text>
            </Pressable>
          </View>
          <Text style={[a.text_sm, t.atoms.text_contrast_medium]}>
            חפש פסוק, דף, הלכה, משנה, פירוש או כל Ref שקיים ב־Sefaria
          </Text>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void choose(query)}
            placeholder="לדוגמה: ברכות ב ע״א"
            placeholderTextColor={t.atoms.text_contrast_low.color}
            style={[
              a.text_lg,
              a.p_md,
              a.rounded_md,
              a.border,
              t.atoms.border_contrast_low,
              t.atoms.text,
              {textAlign: 'right', writingDirection: 'rtl'},
            ]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!query.trim() || isResolving}
            onPress={() => void choose(query)}
            style={({pressed}) => [
              a.p_md,
              a.rounded_md,
              a.border,
              t.atoms.border_contrast_low,
              {opacity: !query.trim() || isResolving ? 0.45 : pressed ? 0.7 : 1},
            ]}>
            <Text style={[a.text_md, a.font_semi_bold, a.text_center]}>
              {isResolving ? 'מאמת מקור…' : 'הצמד מקור'}
            </Text>
          </Pressable>
          {error ? (
            <Text style={[a.text_sm, {textAlign: 'right'}]}>{error}</Text>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={[a.p_lg, a.gap_xs]}>
          {isSearching ? <ActivityIndicator /> : null}
          {suggestions.map(item => (
            <Pressable
              key={`${item.key}-${item.title}`}
              onPress={() => void choose(item.key)}
              style={({pressed}) => [
                a.p_md,
                a.rounded_sm,
                {opacity: pressed ? 0.65 : 1},
              ]}>
              <Text
                style={[
                  a.text_md,
                  a.font_semi_bold,
                  {textAlign: 'right', writingDirection: 'rtl'},
                ]}>
                {item.title}
              </Text>
              {item.key !== item.title ? (
                <Text style={[a.text_sm, t.atoms.text_contrast_medium]}>
                  {item.key}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Dialog.Outer>
  )
}
