import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../public/', import.meta.url))
const publicHtml = (path: string) => join(root, path.replace(/^\//, '') + (path.endsWith('/') ? 'index.html' : ''))
const knownAppPages = new Set(['/', '/account'])

test('both standings guides are public, accessible static documents with working language, rule and section links', async () => {
  for (const lang of ['es', 'en']) {
    const pathname = `/learn/${lang}/standings/`, html = await readFile(publicHtml(pathname), 'utf8')
    assert(html.includes(`<html lang="${lang}">`))
    assert(html.includes(`<link rel="canonical" href="https://nrnplay.com${pathname}">`))
    assert.equal((html.match(/<h1>/g) || []).length, 1)
    assert(html.includes('href="#main-content"')); assert(html.includes('id="main-content"'))
    assert(!/<script\b|\bon\w+\s*=|<iframe\b|nrn-guide-ad-enabled/i.test(html), 'Reading the public rules starts no game, account flow or advertising script')
    assert.equal((html.match(/<table data-example=/g) || []).length, 2)
    assert.equal((html.match(/<caption>/g) || []).length, 2)
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(match[1], `https://nrnplay.com${pathname}`)
      assert.equal(url.origin, 'https://nrnplay.com')
      if (knownAppPages.has(url.pathname)) continue
      const target = publicHtml(url.pathname)
      assert((await stat(target)).isFile(), `${url.pathname} must be a published asset`)
      if (url.hash) {
        const destination = await readFile(target, 'utf8')
        assert(destination.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${url.pathname}${url.hash} must identify a real section`)
      }
    }
  }
})

test('standings guides are discoverable from every existing public guide and sitemap', async () => {
  const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8')
  for (const lang of ['es', 'en']) {
    assert(sitemap.includes(`<loc>https://nrnplay.com/learn/${lang}/standings/</loc>`))
    for (const guide of ['continental', 'pocha', 'help', 'about']) {
      const html = await readFile(publicHtml(`/learn/${lang}/${guide}/`), 'utf8')
      assert(html.includes(`href="/learn/${lang}/standings/"`), `${lang}/${guide} must link to the standings explanation`)
    }
  }
})

test('pretty standings paths rewrite only to their public static files, including trailing slashes', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  for (const lang of ['es', 'en']) for (const slash of ['', '/']) {
    const pathname = `/learn/${lang}/standings${slash}`
    const rewrite = config.rewrites.find((entry: { source: string }) => entry.source === pathname)
    assert.equal(rewrite?.destination, `/learn/${lang}/standings/index.html`)
    assert((await stat(publicHtml(rewrite.destination))).isFile())
  }
})
