import {type TextStyle} from 'react-native'
import {describe, expect, it} from '@jest/globals'

import {flatten} from '#/alf/util/flatten'

import {
  getPhysicalTextAlignStyle,
  getRichTextDirectionStyle,
  isRTLText,
} from '../text-direction.native'
import {
  getPhysicalTextAlignStyle as getWebPhysicalTextAlignStyle,
  getRichTextDirectionStyle as getWebRichTextDirectionStyle,
} from '../text-direction.web'

describe('isRTLText', () => {
  it('recognizes right-to-left text', () => {
    expect(isRTLText('עברית')).toBe(true)
    expect(isRTLText('العربية')).toBe(true)
  })

  it('recognizes left-to-right text', () => {
    expect(isRTLText('English')).toBe(false)
  })

  it('uses the first strong directional character', () => {
    expect(isRTLText('  123 🦋 עברית English')).toBe(true)
    expect(isRTLText('  123 🦋 English עברית')).toBe(false)
  })

  it('defaults to left-to-right when there are no strong characters', () => {
    expect(isRTLText('123 🦋 ...')).toBe(false)
    expect(isRTLText('')).toBe(false)
  })
})

type Direction = 'ltr' | 'rtl'
type Renderer = 'react-native' | 'selectable-ios'

// RN resolves left/right with Yoga direction; the selectable iOS renderer
// builds TextAttributes without layoutDirection and keeps physical alignment.
function physicalAlignment(
  style: TextStyle,
  inheritedDirection: Direction,
  renderer: Renderer,
) {
  const direction =
    style.direction === 'ltr' || style.direction === 'rtl'
      ? style.direction
      : inheritedDirection
  const align = style.textAlign ?? 'auto'
  if (align === 'center' || align === 'justify') return align
  const rtl = renderer === 'react-native' && direction === 'rtl'
  if (align === 'right' || align === 'end') return rtl ? 'left' : 'right'
  return rtl ? 'right' : 'left'
}

describe.each<Direction>(['ltr', 'rtl'])(
  'native text inside a %s interface',
  inheritedDirection => {
    it.each<[Renderer, 'left' | 'right']>([
      ['react-native', 'left'],
      ['react-native', 'right'],
      ['selectable-ios', 'left'],
      ['selectable-ios', 'right'],
    ])(
      'keeps %s text at the requested physical %s edge',
      (renderer, alignment) => {
        expect(
          physicalAlignment(
            getPhysicalTextAlignStyle(alignment),
            inheritedDirection,
            renderer,
          ),
        ).toBe(alignment)
      },
    )

    it.each([
      ['עברית English', 'right', 'rtl'],
      ['العربية English', 'right', 'rtl'],
      ['English עברית', 'left', 'ltr'],
      ['  123 🦋 עברית', 'right', 'rtl'],
      ['  123 🦋 English', 'left', 'ltr'],
      ['123 🦋 ...', 'left', 'ltr'],
    ])(
      'aligns the paragraph %p by its first strong character',
      (text, edge, flow) => {
        const style = getRichTextDirectionStyle(text)
        expect(style.writingDirection).toBe(flow)
        for (const renderer of ['react-native', 'selectable-ios'] as const) {
          expect(physicalAlignment(style, inheritedDirection, renderer)).toBe(
            edge,
          )
        }
      },
    )
  },
)

it('normalizes nested caller direction while retaining explicit LTR alignment', () => {
  const style = flatten<TextStyle>([
    [{direction: 'rtl', textAlign: 'center'}],
    getRichTextDirectionStyle('123 🦋'),
  ])
  expect(style.direction).toBe('ltr')
  expect(style.textAlign).toBe('center')
})

it('keeps web physical styles and browser paragraph auto-direction unchanged', () => {
  expect(getWebPhysicalTextAlignStyle('right')).toEqual({textAlign: 'right'})
  expect(getWebPhysicalTextAlignStyle('left')).toEqual({textAlign: 'left'})
  expect(getWebRichTextDirectionStyle('עברית')).toBeUndefined()
  expect(getWebRichTextDirectionStyle('English')).toBeUndefined()
})
