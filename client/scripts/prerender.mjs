import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

// Reuse the public React component so crawlers and visitors without JavaScript
// receive the same guides and explanations as the interactive homepage.
const compiler = await createServer({
  mode: 'production',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
})
try {
  const { renderPublicLobby } = await compiler.ssrLoadModule('/src/prerender.tsx')
  const file = new URL('../dist/index.html', import.meta.url)
  const template = await readFile(file, 'utf8')
  if (!template.includes('<!--app-html-->')) throw new Error('Public lobby build placeholder is missing')
  await writeFile(file, template.replace('<!--app-html-->', renderPublicLobby()))
  const ads = await readFile(new URL('../dist/ads.txt', import.meta.url), 'utf8')
  if (ads.trim() !== 'google.com, pub-5976311832971723, DIRECT, f08c47fec0942fa0') {
    throw new Error('AdSense authorization file is missing or contains the wrong publisher')
  }
  console.log('Prerendered the public lobby and verified ads.txt')
} finally {
  await compiler.close()
}
