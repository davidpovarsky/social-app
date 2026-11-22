import {StyleSheet, type TextStyle} from 'react-native'
import {beforeEach, describe, expect, it, jest} from '@jest/globals'
import {render} from '@testing-library/react-native'

import {getRichTextDirectionStyle} from '#/lib/strings/text-direction.native'
import * as TextField from '#/components/forms/TextField'
import {Text} from '#/components/Typography'

let mockAppDirection: 'ltr' | 'rtl' = 'rtl'

function mockFlatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(mockFlatten))
  }
  return style && typeof style === 'object'
    ? (style as Record<string, unknown>)
    : {}
}

jest.mock('react-native', () => ({
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Modal: 'Modal',
  StyleSheet: {flatten: mockFlatten, create: (style: unknown) => style},
  Platform: {OS: 'ios'},
}))

jest.mock('@bsky.app/react-native-uitextview', () => ({UITextView: 'Text'}))
jest.mock('#/env', () => ({IS_NATIVE: true, IS_WEB: false}))
jest.mock('#/logger', () => ({logger: {warn: jest.fn()}}))
jest.mock('#/lib/constants', () => ({HITSLOP_20: {}}))
jest.mock('#/lib/merge-refs', () => ({mergeRefs: () => () => {}}))
jest.mock('#/locale/layoutDirection', () => ({
  useAppLayoutDirection: () => mockAppDirection,
}))
jest.mock('#/lib/strings/text-direction', () =>
  jest.requireActual('#/lib/strings/text-direction.native'),
)
jest.mock('#/components/hooks/useInteractionState', () => ({
  useInteractionState: () => ({
    state: false,
    onIn: jest.fn(),
    onOut: jest.fn(),
  }),
}))
jest.mock('#/alf', () => ({
  atoms: {text_sm: {fontSize: 14}, text_md: {fontSize: 16}},
  flatten: mockFlatten,
  applyFonts: () => {},
  useAlf: () => ({fonts: {family: 'system', scaleMultiplier: 1}, flags: {}}),
  useTheme: () => ({name: 'light', atoms: {text: {}}, palette: {}}),
  web: () => undefined,
  platform: ({native}: {native?: unknown}) => native,
}))
jest.mock('#/alf/typography', () => ({
  childHasEmoji: () => false,
  normalizeTextStyles: mockFlatten,
  renderChildrenWithEmoji: (children: unknown) => children,
}))

beforeEach(() => {
  mockAppDirection = 'rtl'
})

function Form({style}: {style?: TextStyle}) {
  return (
    <>
      <Text testID="heading" style={style}>
        Sign in
      </Text>
      <TextField.LabelText>Username or email</TextField.LabelText>
      <TextField.Root>
        <TextField.Input
          testID="input"
          label="Username or email"
          style={style}
        />
      </TextField.Root>
    </>
  )
}

describe('native interface text during language changes', () => {
  it('updates the existing heading, label, and input through Hebrew, English, and Hebrew', () => {
    const view = render(<Form />)

    for (const direction of ['rtl', 'ltr', 'rtl'] as const) {
      mockAppDirection = direction
      view.rerender(<Form />)

      const expected = {
        direction: 'ltr',
        writingDirection: direction,
        textAlign: direction === 'rtl' ? 'right' : 'left',
      }
      for (const element of [
        view.getByTestId('heading'),
        view.getByText('Username or email'),
        view.getByTestId('input'),
      ]) {
        expect(StyleSheet.flatten(element.props.style)).toMatchObject(expected)
      }
    }
  })

  it.each<TextStyle>([
    {textAlign: 'center'},
    {textAlign: 'right'},
    {textAlign: 'left'},
    {textAlign: 'auto'},
    {direction: 'ltr', writingDirection: 'ltr'},
    {writingDirection: 'auto'},
  ])(
    'preserves explicit heading and input styles %p while the app language changes',
    style => {
      const view = render(<Form style={style} />)
      for (const direction of ['rtl', 'ltr'] as const) {
        mockAppDirection = direction
        view.rerender(<Form style={style} />)
        for (const id of ['heading', 'input']) {
          const actual = StyleSheet.flatten<TextStyle>(
            view.getByTestId(id).props.style,
          )
          expect(actual).toMatchObject(style)
          expect(actual.direction).toBe(style.direction)
          expect(actual.writingDirection).toBe(style.writingDirection)
          expect(actual.textAlign).toBe(style.textAlign)
        }
      }
    },
  )

  it.each(['English עברית', 'עברית English'])(
    'keeps %p paragraphs and nested spans independent of app language',
    text => {
      const paragraphStyle = getRichTextDirectionStyle(text)
      const content = (
        <Text testID="paragraph" style={paragraphStyle}>
          {text}
          <Text testID="nested" style={{fontWeight: 'bold'}}>
            mixed suffix
          </Text>
        </Text>
      )
      const view = render(content)
      for (const direction of ['rtl', 'ltr'] as const) {
        mockAppDirection = direction
        view.rerender(
          <Text testID="paragraph" style={paragraphStyle}>
            {text}
            <Text testID="nested" style={{fontWeight: 'bold'}}>
              mixed suffix
            </Text>
          </Text>,
        )
        expect(
          StyleSheet.flatten(view.getByTestId('paragraph').props.style),
        ).toMatchObject(paragraphStyle)
        const nested = StyleSheet.flatten<TextStyle>(
          view.getByTestId('nested').props.style,
        )
        expect(nested.direction).toBeUndefined()
        expect(nested.writingDirection).toBeUndefined()
        expect(nested.textAlign).toBeUndefined()
        expect(nested.fontWeight).toBe('bold')
      }
    },
  )

  it('preserves an explicit nested span alignment', () => {
    const view = render(
      <Text style={getRichTextDirectionStyle('עברית')}>
        <Text testID="nested" style={{textAlign: 'center'}}>
          centered suffix
        </Text>
      </Text>,
    )
    expect(
      StyleSheet.flatten(view.getByTestId('nested').props.style),
    ).toMatchObject({
      textAlign: 'center',
    })
  })
})
