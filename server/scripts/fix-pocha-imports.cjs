// Shared Pocha contracts and pure rules are the source of truth for both builds.
const fs = require('fs')
const path = require('path')
for (const file of ['pochaTypes.ts', 'pochaRules.ts']) {
  fs.copyFileSync(path.join(__dirname, '../../shared', file), path.join(__dirname, '../src/game/pocha', file))
}
