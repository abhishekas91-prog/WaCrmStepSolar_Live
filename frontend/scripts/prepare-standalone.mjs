// After `next build` with `output: "standalone"`, Next.js emits a
// self-contained server at .next/standalone/server.js, but it does NOT
// copy the `public/` folder or the `.next/static` assets into that
// output directory — Next expects you to do that yourself (they're
// often served from a CDN instead). Without this step the standalone
// server runs but returns 404 for every static asset and public file.
//
// This runs as part of `npm run build` so `npm start` (which now runs
// `node .next/standalone/server.js`, not `next start` — see the
// "next start" does not work with "output: standalone" warning) always
// has a complete, servable standalone build.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const standaloneDir = join(root, '.next', 'standalone')

if (!existsSync(standaloneDir)) {
  console.error(
    '[prepare-standalone] .next/standalone not found — did `next build` run with output: "standalone" in next.config.ts?'
  )
  process.exit(1)
}

const copies = [
  { from: join(root, 'public'), to: join(standaloneDir, 'public') },
  { from: join(root, '.next', 'static'), to: join(standaloneDir, '.next', 'static') },
]

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.warn(`[prepare-standalone] skipping missing source: ${from}`)
    continue
  }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log(`[prepare-standalone] copied ${from} -> ${to}`)
}

console.log('[prepare-standalone] done.')
