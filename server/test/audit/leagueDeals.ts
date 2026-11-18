import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import type { MockTracker } from 'node:test'

const MAX_SHUFFLE_BOUND = 165 // Three Continental decks of 52 cards and three jokers each.

/** Repeat card deals in league fixtures while leaving account and seat credentials random. */
export function mockLeagueDeals(tracker: MockTracker, seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  const randomInt = crypto.randomInt
  const shuffle = tracker.method(crypto, 'randomInt', (...args: unknown[]) => {
    const [max] = args
    if (args.length === 1 && typeof max === 'number' && Number.isInteger(max) && max >= 2 && max <= MAX_SHUFFLE_BOUND) {
      return Math.floor(next() * max)
    }
    return Reflect.apply(randomInt, crypto, args)
  })
  const dealer = tracker.method(Math, 'random', next)
  syncBuiltinESMExports()
  return {
    get state() { return state },
    restore() {
      dealer.mock.restore()
      shuffle.mock.restore()
      syncBuiltinESMExports()
    },
  }
}
