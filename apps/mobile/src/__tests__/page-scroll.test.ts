import { getNextPageOffset } from '../sync/page-scroll'

describe('getNextPageOffset', () => {
  it('moves down by 85% of the current viewport', () => {
    expect(
      getNextPageOffset({
        direction: 'down',
        currentOffset: 200,
        viewportHeight: 600,
        contentHeight: 2_000
      })
    ).toBe(710)
  })

  it('moves up by 85% of the current viewport', () => {
    expect(
      getNextPageOffset({
        direction: 'up',
        currentOffset: 900,
        viewportHeight: 600,
        contentHeight: 2_000
      })
    ).toBe(390)
  })

  it('scales the page distance with the viewport height', () => {
    const phoneTarget = getNextPageOffset({
      direction: 'down',
      currentOffset: 0,
      viewportHeight: 600,
      contentHeight: 3_000
    })
    const tabletTarget = getNextPageOffset({
      direction: 'down',
      currentOffset: 0,
      viewportHeight: 1_000,
      contentHeight: 3_000
    })

    expect(phoneTarget).toBe(510)
    expect(tabletTarget).toBe(850)
  })

  it('clamps the target at both content boundaries', () => {
    expect(
      getNextPageOffset({
        direction: 'up',
        currentOffset: 100,
        viewportHeight: 600,
        contentHeight: 2_000
      })
    ).toBe(0)
    expect(
      getNextPageOffset({
        direction: 'down',
        currentOffset: 1_200,
        viewportHeight: 600,
        contentHeight: 2_000
      })
    ).toBe(1_400)
  })

  it('stays at the top when content does not fill the viewport', () => {
    expect(
      getNextPageOffset({
        direction: 'down',
        currentOffset: 0,
        viewportHeight: 600,
        contentHeight: 480
      })
    ).toBe(0)
  })
})
