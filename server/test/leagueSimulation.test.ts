import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createLeagueSimulations } from './fixtures/leagueSimulation.js'

test('five-account league examples replay real scoring and ratings across wins, shared places and qualification', async () => {
  const simulations = createLeagueSimulations()
  assert.deepEqual(createLeagueSimulations(), simulations, 'Controlled scoring examples are reproducible without seeding global randomness')
  for (const simulation of simulations) {
    assert.equal(simulation.stages[0].standings.length, 5)
    assert(simulation.stages[0].standings.every(row => row.played === 0 && row.rank === null && row.provisional))
    assert.equal(simulation.results[0].players.filter(p => p.position === 1).length, 1)
    assert.deepEqual(simulation.results[1].players.filter(p => p.position === 1).map(p => p.name).sort(), ['Alba', 'Eva'])
    const afterThree = simulation.stages[3].standings
    assert.equal(afterThree.find(row => row.name === 'Eva')!.played, 2)
    assert.equal(afterThree.find(row => row.name === 'Eva')!.rank, null)
    assert(afterThree.filter(row => row.name !== 'Eva').every(row => row.played === 3 && row.rank !== null && !row.provisional))
    assert(simulation.stages[4].standings.every(row => !row.provisional && row.rank !== null))
    assert(simulation.stages[5].standings.every(row => row.played === (row.name === 'Eva' ? 4 : 5)))
  }
  const publicEvidence = { scope: 'Fixtures locales deterministas de puntuación y clasificación real; no son cuentas reales ni nuevas partidas Socket.IO',
    accounts: ['Alba', 'Bruno', 'Carla', 'Dani', 'Eva'],
    examples: simulations.map(({ gameType, minGames, results, stages }) => ({ gameType, minGames,
      matches: results.map((result, i) => ({ day: i + 1, scores: result.players.map(({ name, score, position }) => ({ name, score, position })) })), stages })) }
  const output = fileURLToPath(new URL('../../output/nrn-security-review/', import.meta.url))
  await mkdir(output, { recursive: true })
  await writeFile(output + '/league-simulations.json', JSON.stringify(publicEvidence, null, 2) + '\n')
  const report = ['# Ejemplos reproducibles de ligas', '', publicEvidence.scope, '', 'Cinco cuentas ficticias; mínimo de clasificación: 3 partidas. Los empates del resultado y los de clasificación son conceptos distintos.', '']
  for (const example of publicEvidence.examples) {
    report.push(`## ${example.gameType === 'continental' ? 'Conti' : 'Pocha'}`, '')
    for (const completed of [0, 2, 3, 4, 5]) {
      report.push(`### Después de ${completed} jornadas`, '', '| Cuenta | Partidas | Rating real | Puesto | V / E / D | Provisional |', '| --- | ---: | ---: | ---: | --- | --- |')
      for (const row of example.stages[completed].standings) report.push(`| ${row.name} | ${row.played} | ${row.rating.toFixed(2)} | ${row.rank ?? '—'} | ${row.wins} / ${row.draws} / ${row.losses} | ${row.provisional ? 'Sí' : 'No'} |`)
      report.push('')
    }
    report.push('### Resultado con empate (jornada 2)', '', '| Cuenta | Puntos | Puesto en la partida |', '| --- | ---: | ---: |')
    for (const row of example.matches[1].scores) report.push(`| ${row.name} | ${row.score} | ${row.position} |`)
    report.push('')
  }
  report.push('Los puntos de Conti se calculan con Room.endRound sobre manos finales declaradas. En Pocha, repartos controlados de una carta pasan por pujas, jugadas legales, resolución de baza y puntuación reales. No se crean usuarios ni sesiones; no se consultan servicios externos. Las pruebas previas de 3+3 partidas Socket.IO complementan este ejemplo y son otra ejecución.', '')
  await writeFile(output + '/league-simulations.md', report.join('\n'))
})

test('published ES and EN league examples match the real ratings and qualification threshold', async () => {
  const conti = createLeagueSimulations().find(example => example.gameType === 'continental')!
  const standings = conti.stages[3].standings
  for (const lang of ['es', 'en']) {
    const html = await readFile(new URL(`../../client/public/learn/${lang}/standings/index.html`, import.meta.url), 'utf8')
    const table = /<table\b[^>]*data-example="league-standings"[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1]
    assert(table, 'Missing league example table')
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table)?.[1]
    assert(body, 'Missing example rows')
    const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<(?:th|td)\b[^>]*>([^<]+)<\/(?:th|td)>/g)].map(cell => cell[1]))
    assert.deepEqual(rows.map(row => row[0]), ['Bruno', 'Eva'])
    for (const [name, games, rating, place] of rows) {
      const player = standings.find(row => row.name === name)!
      const [played, required] = games.split('/').map(Number)
      assert.equal(played, player.played)
      assert.equal(required, 3)
      assert.equal(Number(rating.replace(',', '.')), player.rating)
      assert.equal(place === 'Provisional' ? null : Number.parseInt(place, 10), player.rank)
    }
  }
})
