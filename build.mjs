import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const source = import.meta.dirname
const output = process.argv[2] ? resolve(process.argv[2]) : source

await mkdir(output, { recursive: true })
await build({
  absWorkingDir: source,
  entryPoints: ['worker/main.ts'],
  outfile: resolve(output, 'worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'eof'
})

if (output !== source) {
  const packageFiles = ['orca-plugin.json', 'panel', 'LICENSE', 'THIRD_PARTY_NOTICES.md']
  await Promise.all(
    packageFiles.map((file) =>
      cp(resolve(source, file), resolve(output, file), { recursive: true })
    )
  )
}

console.log(output)
