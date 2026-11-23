import {type AppLayoutDirection} from '#/locale/layoutDirection'
import {getShellLayout} from '#/components/Layout/direction'

/**
 * Resolve logical-start positioning to physical rectangles. These assertions
 * catch the original bug: RTL swapped the anchor without changing translateX.
 */
function rectFromStart({
  direction,
  viewport,
  width,
  offset,
  percent = 0,
}: {
  direction: AppLayoutDirection
  viewport: number
  width: number
  offset: number
  percent?: number
}) {
  const anchor = viewport / 2
  const left =
    (direction === 'rtl' ? anchor - width : anchor) +
    offset +
    (percent / 100) * width
  return {left, right: left + width}
}

describe.each(['ltr', 'rtl'] as const)('shell geometry in %s', direction => {
  test.each([800, 834, 1024, 1100, 1194, 1300, 1366, 1440])(
    'keeps borders, feed and navigation aligned at %ipx',
    viewport => {
      const offset = viewport >= 1100 && viewport <= 1300
      const layout = getShellLayout(direction, offset)
      const feed = {
        left: viewport / 2 - 300 + layout.columnOffset,
        right: viewport / 2 + 300 + layout.columnOffset,
      }
      const border = rectFromStart({
        direction,
        viewport,
        width: 602,
        offset: layout.columnOffset,
        percent: parseFloat(layout.centerTranslate),
      })
      expect(border.left).toBe(feed.left - 1)
      expect(border.right).toBe(feed.right + 1)
      expect(feed.left).toBeGreaterThanOrEqual(0)
      expect(feed.right).toBeLessThanOrEqual(viewport)

      const navWidth = viewport <= 1300 ? 80 : 240
      const startNav = rectFromStart({
        direction,
        viewport,
        width: navWidth,
        offset: layout.startNavOffset,
        percent: parseFloat(layout.startNavTranslate),
      })
      expect(startNav.left).toBeGreaterThanOrEqual(0)
      expect(startNav.right).toBeLessThanOrEqual(viewport)
      expect(direction === 'rtl' ? startNav.left : startNav.right).toBe(
        direction === 'rtl' ? feed.right : feed.left,
      )

      if (viewport >= 1100) {
        const endNav = rectFromStart({
          direction,
          viewport,
          width: offset ? 250 : 300,
          offset: layout.endNavOffset,
        })
        expect(endNav.left).toBeGreaterThanOrEqual(0)
        expect(endNav.right).toBeLessThanOrEqual(viewport)
        expect(direction === 'rtl' ? endNav.right : endNav.left).toBe(
          direction === 'rtl' ? feed.left : feed.right,
        )
      }
    },
  )

  test('keeps native iPad columns centered without a web-only rail offset', () => {
    const layout = getShellLayout(direction, false)
    expect(layout.columnOffset).toBe(0)
    const nav = rectFromStart({
      direction,
      viewport: 834,
      width: 80,
      offset: layout.startNavOffset,
      percent: parseFloat(layout.startNavTranslate),
    })
    expect(nav.left).toBeGreaterThanOrEqual(0)
    expect(nav.right).toBeLessThanOrEqual(834)
  })
})
