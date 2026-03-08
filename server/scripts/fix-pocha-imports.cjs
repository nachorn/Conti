/**
 * Rewrite shared/pochaTypes.js imports to ./pochaTypes.js in pocha sources.
 * If local pochaTypes.ts is missing (cached deploy), copy from repo shared/.
 * Ensures the server build works even when deploy uses cached repo with old paths.
 */
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '../src/game/pocha')
const repoRoot = path.join(__dirname, '../..')
const sharedPocha = path.join(repoRoot, 'shared/pochaTypes.ts')
const localPocha = path.join(dir, 'pochaTypes.ts')

if (!fs.existsSync(localPocha) && fs.existsSync(sharedPocha)) {
  fs.copyFileSync(sharedPocha, localPocha)
  console.log('Copied shared/pochaTypes.ts to server/src/game/pocha/')
}

const files = ['spanishDeck.ts', 'pochaEngine.ts']
const bad = /\.\.\/\.\.\/\.\.\/\.\.\/shared\/pochaTypes\.js/g
const good = './pochaTypes.js'

for (const f of files) {
  const p = path.join(dir, f)
  if (!fs.existsSync(p)) continue
  let s = fs.readFileSync(p, 'utf8')
  if (s.includes('shared/pochaTypes')) {
    s = s.replace(bad, good)
    fs.writeFileSync(p, s)
    console.log('Fixed imports in', f)
  }
}
