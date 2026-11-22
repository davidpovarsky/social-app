

import {getTabBarItemScrollOffset} from '#/view/com/pager/layout'
describe.each([false, true])('tab scrolling (RTL=%s)', rtl => {
  const widths = [130, 84, 180, 92, 150]
  const contentWidth = widths.reduce((sum, width) => sum + width, 0)
  const containerWidth = 320
  const availableWidth = containerWidth - 12

  test.each(widths.map((_, index) => index))(
    'reveals the whole selected tab %i with variable Hebrew/English label widths',
    index => {
      const preceding = widths.slice(0, index).reduce((sum, w) => sum + w, 0)
      const layout = {
        x: rtl ? contentWidth - preceding - widths[index] : preceding,
        width: widths[index],
      }
      const offset = getTabBarItemScrollOffset({
        index,
        itemCount: widths.length,
        layout,
        contentWidth,
        containerWidth,
        contentPadding: 6,
        rtl,
      })
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(contentWidth - availableWidth)
      expect(layout.x).toBeGreaterThanOrEqual(offset)
      expect(layout.x + layout.width).toBeLessThanOrEqual(
        offset + availableWidth,
      )
    },
  )

  test('does not scroll when every tab fits in the available column', () => {
    expect(
      getTabBarItemScrollOffset({
        index: 0,
        itemCount: 2,
        layout: {x: rtl ? 80 : 0, width: 80},
        contentWidth: 160,
        containerWidth,
        contentPadding: 6,
        rtl,
      }),
    ).toBe(0)
  })

  test('uses the visible start edge before the first layout measurement', () => {
    expect(
      getTabBarItemScrollOffset({
        index: 0,
        itemCount: 5,
        contentWidth,
        containerWidth,
        contentPadding: 6,
        rtl,
      }),
    ).toBe(rtl ? contentWidth - availableWidth : 0)
  })
})
