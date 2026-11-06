describe('SwipeToReply gesture direction logic', () => {
  function getSwipeDirectionConfig({
    isFromSelf,
    isRTL,
  }: {
    isFromSelf: boolean
    isRTL: boolean
  }) {
    // In RTL, self messages are visually on the left, others on the right.
    // In LTR, self messages are visually on the right, others on the left.
    const isVisuallyOnRight = isRTL ? !isFromSelf : isFromSelf

    return {
      isVisuallyOnRight,
      restingEdge: isVisuallyOnRight ? 'right' : 'left',
      allowedDragDirection: isVisuallyOnRight ? 'left' : 'right',
      expectedTranslationSign: isVisuallyOnRight ? -1 : 1,
    }
  }

  it('correctly maps LTR self messages to right-edge resting and leftward drag', () => {
    const config = getSwipeDirectionConfig({isFromSelf: true, isRTL: false})
    expect(config.isVisuallyOnRight).toBe(true)
    expect(config.restingEdge).toBe('right')
    expect(config.allowedDragDirection).toBe('left')
    expect(config.expectedTranslationSign).toBe(-1)
  })

  it('correctly maps LTR others messages to left-edge resting and rightward drag', () => {
    const config = getSwipeDirectionConfig({isFromSelf: false, isRTL: false})
    expect(config.isVisuallyOnRight).toBe(false)
    expect(config.restingEdge).toBe('left')
    expect(config.allowedDragDirection).toBe('right')
    expect(config.expectedTranslationSign).toBe(1)
  })

  it('correctly maps RTL self messages to left-edge resting and rightward inward drag', () => {
    const config = getSwipeDirectionConfig({isFromSelf: true, isRTL: true})
    expect(config.isVisuallyOnRight).toBe(false)
    expect(config.restingEdge).toBe('left')
    expect(config.allowedDragDirection).toBe('right')
    expect(config.expectedTranslationSign).toBe(1)
  })

  it('correctly maps RTL others messages to right-edge resting and leftward inward drag', () => {
    const config = getSwipeDirectionConfig({isFromSelf: false, isRTL: true})
    expect(config.isVisuallyOnRight).toBe(true)
    expect(config.restingEdge).toBe('right')
    expect(config.allowedDragDirection).toBe('left')
    expect(config.expectedTranslationSign).toBe(-1)
  })
})
