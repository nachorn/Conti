import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

// Reuse the public React component so crawlers and visitors without JavaScript
// receive the same guides and explanations as the interactive homepage.
const compiler = await createServer({
  mode: 'production',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
})
try {
  const { renderPublicPage, publicGameUrl } = await compiler.ssrLoadModule('/src/prerender.tsx')
  const file = new URL('../dist/index.html', import.meta.url)
  const template = await readFile(file, 'utf8')
  if (!template.includes('<!--app-html-->')) throw new Error('Public lobby build placeholder is missing')
  await writeFile(file, template.replace('<!--app-html-->', renderPublicPage('/')))
  for (const [path, name, description] of [
    ['/conti', 'Conti', 'Play Continental Rummy online with friends. Create a private room, make sets and runs, and keep track of your results on NRN Play.'],
    ['/pocha', 'La Pocha', 'Play La Pocha online with friends. Create a private room, predict your tricks, and keep track of your results on NRN Play.'],
  ]) {
    const directory = new URL(`../dist${path}/`, import.meta.url)
    await mkdir(directory, { recursive: true })
    const page = template
      .replace('<!--app-html-->', renderPublicPage(path))
      .replace(/<title>.*?<\/title>/, `<title>${name} · NRN Play</title>`)
      .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`)
      .replace('href="https://nrnplay.com/"', `href="${publicGameUrl(path)}"`)
    await writeFile(new URL('index.html', directory), page)
  }
  const sitemapFile = new URL('../dist/sitemap.xml', import.meta.url)
  let sitemap = await readFile(sitemapFile, 'utf8')
  for (const path of ['/conti', '/pocha']) sitemap = sitemap.replace(`https://nrnplay.com${path}</loc>`, `${publicGameUrl(path)}</loc>`)
  await writeFile(sitemapFile, sitemap)
  const ads = await readFile(new URL('../dist/ads.txt', import.meta.url), 'utf8')
  if (ads.trim() !== 'google.com, pub-5976311832971723, DIRECT, f08c47fec0942fa0') {
    throw new Error('AdSense authorization file is missing or contains the wrong publisher')
  }
  console.log('Prerendered NRN Play, Conti and Pocha and verified ads.txt')
} finally {
  await compiler.close()
}
