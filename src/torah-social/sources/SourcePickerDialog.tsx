import {useEffect, useState} from 'react'
import {
  ActivityIndicator,
  Pressable,
  View,
} from 'react-native'

import {atoms as a, useTheme, web} from '#/alf'
import {Button, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import * as TextField from '#/components/forms/TextField'
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
    if (isResolving || !value.trim()) return
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
    <Dialog.Outer
      control={control}
      nativeOptions={{fullHeight: true}}>
      <Dialog.Handle />
      <Dialog.ScrollableInner
        label="הוסף מקור תורני"
        style={web({maxWidth: 600})}>
        <View style={[a.gap_md, a.w_full]}>
          <View style={[a.flex_row, a.align_center, a.justify_between]}>
            <Text style={[a.text_xl, a.font_semi_bold]}>הוסף מקור תורני</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="סגור"
              onPress={() => control.close()}
              style={a.p_xs}>
              <Text style={[a.text_md, a.font_semi_bold]}>סגור</Text>
            </Pressable>
          </View>

          <Text style={[a.text_sm, t.atoms.text_contrast_medium]}>
            חפש פסוק, דף גמרא, הלכה, משנה, פירוש או כל מקור הקיים ב־Sefaria
          </Text>

          <TextField.Root>
            <Dialog.Input
              autoFocus
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => void choose(query)}
              placeholder="לדוגמה: ברכות ב ע״א או Genesis 1:1"
              style={[{textAlign: 'right', writingDirection: 'rtl'}]}
            />
          </TextField.Root>

          <Button
            label="הצמד מקור"
            disabled={!query.trim() || isResolving}
            onPress={() => void choose(query)}
            variant="solid"
            color="primary"
            size="large">
            <ButtonText>
              {isResolving ? 'מאמת מקור…' : 'הצמד מקור'}
            </ButtonText>
          </Button>

          {error ? (
            <Text style={[a.text_sm, {color: t.palette.negative_400, textAlign: 'right'}]}>
              {error}
            </Text>
          ) : null}

          {isSearching && (
            <View style={[a.py_sm, a.align_center]}>
              <ActivityIndicator />
            </View>
          )}

          {suggestions.length > 0 && (
            <View style={[a.gap_xs, a.pt_xs]}>
              <Text style={[a.text_xs, t.atoms.text_contrast_medium, {textAlign: 'right'}]}>
                הצעות התאמה:
              </Text>
              {suggestions.map(item => (
                <Pressable
                  key={`${item.key}-${item.title}`}
                  accessibilityRole="button"
                  onPress={() => void choose(item.key)}
                  style={({pressed}) => [
                    a.p_md,
                    a.rounded_sm,
                    a.border,
                    t.atoms.border_contrast_low,
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
                    <Text
                      style={[
                        a.text_sm,
                        t.atoms.text_contrast_medium,
                        {textAlign: 'right'},
                      ]}>
                      {item.key}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </Dialog.ScrollableInner>
    </Dialog.Outer>
  )
}

