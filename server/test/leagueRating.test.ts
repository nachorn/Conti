import assert from 'node:assert/strict'
import test from 'node:test'
import { initialLeagueRating, leagueRatingPoints, updateLeagueRatings, type LeagueRating, type LeagueRatingEntry } from '../src/leagueRating.js'

const close = (actual: number, expected: number, tolerance = 0.000_01) => assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
const fresh = (id: string, position: number): LeagueRatingEntry => ({ id, position, ...initialLeagueRating() })

test('initial rating and conservative leaderboard score use classic TrueSkill defaults', () => {
  const first = initialLeagueRating()
  assert.deepEqual(first, { mu: 25, sigma: 25 / 3 })
  assert.equal(leagueRatingPoints(first), 0)
  first.mu = 99
  assert.equal(initialLeagueRating().mu, 25, 'new players do not share mutable rating objects')
  assert.equal(leagueRatingPoints({ mu: 30, sigma: 2 }), 24)
  assert.equal(leagueRatingPoints({ mu: 20, sigma: 7 }), -1, 'negative estimates are preserved rather than creating artificial ties')
})

test('two-player win matches the reference Python TrueSkill result and reduces uncertainty', () => {
  // Default reference example: https://trueskill.org/#basic-usage
  const result = updateLeagueRatings([fresh('winner', 1), fresh('loser', 2)])
  close(result.get('winner')!.mu, 29.39583201999916)
  close(result.get('loser')!.mu, 20.604167980000835)
  close(result.get('winner')!.sigma, 7.171475587326195)
  close(result.get('loser')!.sigma, 7.171475587326195)
  assert(leagueRatingPoints(result.get('winner')!) > leagueRatingPoints(result.get('loser')!))
})

test('eight-player free-for-all reproduces Microsoft Research published standings', () => {
  // Official worked example: https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/
  const reference = [
    [36.771, 5.749], [32.242, 5.133], [29.074, 4.943], [26.322, 4.874],
    [23.678, 4.874], [20.926, 4.943], [17.758, 5.133], [13.229, 5.749],
  ]
  const result = updateLeagueRatings(reference.map((_, index) => fresh(`player-${index}`, index + 1)))
  reference.forEach(([mu, sigma], index) => {
    close(result.get(`player-${index}`)!.mu, mu, 0.001)
    close(result.get(`player-${index}`)!.sigma, sigma, 0.001)
  })
})

test('draws use the draw model and final places include tied first and lower places', () => {
  const draw = updateLeagueRatings([fresh('a', 1), fresh('b', 1)])
  close(draw.get('a')!.mu, 25)
  close(draw.get('b')!.mu, 25)
  close(draw.get('a')!.sigma, 6.457519662317322)
  close(draw.get('a')!.sigma, draw.get('b')!.sigma)
  const firstTie = updateLeagueRatings([fresh('a', 1), fresh('b', 1), fresh('c', 3)])
  assert(firstTie.get('a')!.mu > 25 && firstTie.get('b')!.mu > 25 && firstTie.get('c')!.mu < 25)
  const lastTie = updateLeagueRatings([fresh('a', 1), fresh('b', 2), fresh('c', 2)])
  assert(lastTie.get('a')!.mu > 25 && lastTie.get('b')!.mu < 25 && lastTie.get('c')!.mu < 25)
  const denseRanks = updateLeagueRatings([fresh('a', 1), fresh('b', 1), fresh('c', 2)])
  assert.deepEqual(firstTie, denseRanks, 'rank gaps do not change a result')
})

test('seat ordering cannot change ratings, including asymmetric priors and draws', () => {
  const entries = [
    { id: 'a', mu: 28, sigma: 5, position: 2 },
    { id: 'b', mu: 20, sigma: 3, position: 1 },
    { id: 'c', mu: 27, sigma: 4, position: 2 },
    { id: 'd', mu: 22, sigma: 6, position: 4 },
  ]
  const original = structuredClone(entries)
  const expected = updateLeagueRatings(entries)
  for (let offset = 0; offset < entries.length; offset++) {
    const shifted = [...entries.slice(offset), ...entries.slice(0, offset)]
    assert.deepEqual(updateLeagueRatings(shifted), expected)
    assert.deepEqual(updateLeagueRatings(shifted.reverse()), expected)
  }
  assert.deepEqual(entries, original, 'rating calculation never mutates durable result inputs')
})

test('unexpected victories change the rating more than expected victories', () => {
  const strong = { id: 'a', mu: 35, sigma: 3 }, weak = { id: 'b', mu: 15, sigma: 3 }
  const expected = updateLeagueRatings([{ ...strong, position: 1 }, { ...weak, position: 2 }])
  const upset = updateLeagueRatings([{ ...strong, position: 2 }, { ...weak, position: 1 }])
  assert(upset.get('b')!.mu - weak.mu > expected.get('a')!.mu - strong.mu)
  assert(upset.get('a')!.mu < strong.mu)
})

test('all places affect multiplayer ratings and all supported table sizes remain finite', () => {
  for (let size = 2; size <= 10; size++) {
    const ranked = updateLeagueRatings(Array.from({ length: size }, (_, index) => fresh(`p${index}`, index + 1)))
    const reversedMiddle = size > 2 ? updateLeagueRatings(Array.from({ length: size }, (_, index) => fresh(`p${index}`, index === 0 ? 1 : size - index + 1))) : null
    let previous = Infinity
    for (let index = 0; index < size; index++) {
      const current = ranked.get(`p${index}`)!
      assert(Number.isFinite(current.mu) && current.sigma > 0 && current.sigma < 25 / 3)
      assert(current.mu < previous)
      previous = current.mu
      if (index === 1 && reversedMiddle) assert(current.mu > reversedMiddle.get(`p${index}`)!.mu)
    }
    const tied = updateLeagueRatings(Array.from({ length: size }, (_, index) => fresh(`p${index}`, 1)))
    for (const rating of tied.values()) assert(Number.isFinite(rating.mu) && Number.isFinite(rating.sigma) && rating.sigma > 0)
  }
})

test('repeated results across changing opponents converge without losing absent-player history', () => {
  const ratings = new Map<string, LeagueRating>(Array.from({ length: 10 }, (_, index) => [`p${index}`, initialLeagueRating()]))
  for (let game = 0; game < 250; game++) {
    const size = 2 + game % 9
    const participants = Array.from({ length: size }, (_, index) => `p${(index + game) % 10}`)
    participants.sort((a, b) => a < b ? -1 : 1)
    const updates = updateLeagueRatings(participants.map((id, index) => ({ id, ...ratings.get(id)!, position: index + 1 })))
    for (const [id, rating] of updates) ratings.set(id, rating)
  }
  for (const rating of ratings.values()) assert(Number.isFinite(leagueRatingPoints(rating)) && rating.sigma > 0)
  assert(ratings.get('p0')!.mu > ratings.get('p9')!.mu)
})

test('malformed or ambiguous rating inputs fail before changing a league', () => {
  for (const entries of [
    [], [fresh('a', 1)], Array.from({ length: 11 }, (_, index) => fresh(`p${index}`, index + 1)),
    [fresh('same', 1), fresh('same', 2)], [fresh('', 1), fresh('b', 2)],
    [fresh('a', 0), fresh('b', 2)], [fresh('a', 1), fresh('b', 3)],
    [fresh('a', 2), fresh('b', 2)], [fresh('a', 1.5), fresh('b', 2)],
    [{ ...fresh('a', 1), mu: NaN }, fresh('b', 2)],
    [{ ...fresh('a', 1), sigma: 0 }, fresh('b', 2)],
    [{ ...fresh('a', 1), sigma: Infinity }, fresh('b', 2)],
  ]) assert.throws(() => updateLeagueRatings(entries), /Invalid league rating entries/)
  assert.throws(() => leagueRatingPoints({ mu: Infinity, sigma: 1 }), /Invalid league rating/)
})
