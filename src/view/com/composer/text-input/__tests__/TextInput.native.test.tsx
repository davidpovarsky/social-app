import {createRef, type ReactNode} from 'react'
import {RichText} from '@bsky/sdk/richtext'
import {act, render} from '@testing-library/react-native'

import {TextInput} from '../TextInput'
import {type TextInputRef} from '../TextInput.types'
import {textInputWebEmitter} from '../textInputWebEmitter'

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
)

jest.mock('expo-paste-input', () => ({
  TextInputWrapper: ({children}: {children?: ReactNode}) => children,
}))

jest.mock('../mobile/Autocomplete', () => ({
  Autocomplete: () => null,
}))

jest.mock('#/alf', () => ({
  atoms: {
    flex_1: {},
    pl_md: {},
    pr_4xl: {},
    w_full: {},
    h_full: {},
    text_lg: {},
    leading_snug: {},
    text_md: {fontSize: 16},
  },
  flatten: (s: unknown) =>
    Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s || {},
  useAlf: () => ({
    theme: {
      atoms: {
        text: {color: '#000'},
        text_contrast_low: {color: '#888'},
        text_link: {color: '#00f'},
      },
    },
    fonts: {scaleMultiplier: 1, family: 'System'},
  }),
}))

jest.mock('#/alf/typography', () => ({
  normalizeTextStyles: (s: unknown) => s || {},
}))

jest.mock('#/lib/ThemeContext', () => ({
  useTheme: () => ({colorScheme: 'light'}),
}))

jest.mock('@lingui/react', () => ({
  useLingui: () => ({
    t: (s: unknown) => (Array.isArray(s) ? s.join('') : String(s)),
  }),
  I18nProvider: ({children}: {children?: ReactNode}) => children,
}))

jest.mock('@lingui/react/macro', () => ({
  useLingui: () => ({
    t: (s: unknown) => (Array.isArray(s) ? s.join('') : String(s)),
  }),
  t: (s: unknown) => (Array.isArray(s) ? s.join('') : String(s)),
}))

describe('Native Composer TextInput', () => {
  it('renders native TextInput without throwing ReferenceError or TypeError for useEffect', () => {
    const ref = createRef<TextInputRef>()
    const setRichText = jest.fn((_next: RichText) => {})
    const onPhotoPasted = jest.fn()
    const onNewLink = jest.fn()
    const onError = jest.fn()
    const onFocus = jest.fn()
    const onPressPublish = jest.fn()

    const rt = new RichText({text: 'Initial test text'})

    const {unmount} = render(
      <TextInput
        accessibilityLabel="Text input field"
        accessibilityHint="Enter text for the post"
        ref={ref}
        richtext={rt}
        webForceMinHeight={false}
        hasRightPadding={false}
        isActive={true}
        setRichText={setRichText}
        onPhotoPasted={onPhotoPasted}
        onPressPublish={onPressPublish}
        onNewLink={onNewLink}
        onError={onError}
        onFocus={onFocus}
        placeholder="What's up?"
      />,
    )

    // Verify text insertion listener registered in useEffect responds to emitter
    act(() => {
      textInputWebEmitter.emit('insert-text', ' appended source')
    })

    expect(setRichText).toHaveBeenCalled()
    const updated = setRichText.mock.calls[0]?.[0]
    expect(updated?.text).toContain('appended source')

    // Clean unmount
    unmount()
  })
})
