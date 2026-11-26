import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const source = import.meta.dirname
const output = process.argv[2] ? resolve(process.argv[2]) : source
const agentPackage = process.argv.includes('--agent')
if (agentPackage && (process.platform !== 'darwin' || output === source)) {
  throw new Error('The TAPD Agent package requires macOS and a separate output directory')
}
const socket = agentPackage ? join(await mkdtemp('/tmp/tapd-orca-agent-'), 'mcp.sock') : ''

await mkdir(output, { recursive: true })
const bundle = await build({
  absWorkingDir: source,
  entryPoints: [agentPackage ? 'worker/agent-main.ts' : 'worker/main.ts'],
  outfile: resolve(output, 'worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  define: { TAPD_MCP_SOCKET: JSON.stringify(socket) },
  metafile: agentPackage,
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

if (agentPackage) {
  const path = join(output, 'orca-plugin.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.engines.orca = '>=1.4.276'
  manifest.contributes.statusBarItems = [{
    id: 'tapd-agent',
    text: 'TAPD Agent',
    tooltip: 'TAPD Agent tools from the installed TAPD plugin'
  }]
  const launcher = [
    `const s=require('node:net').createConnection(${JSON.stringify(socket)});`,
    "s.on('error',e=>{console.error(e.message);process.exitCode=1;process.stdin.destroy()});",
    "s.on('close',()=>process.stdin.destroy());",
    'process.stdin.pipe(s);s.pipe(process.stdout);'
  ].join('')
  manifest.contributes.mcpServers = [{ name: 'tapd', command: 'node', args: ['-e', launcher] }]
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

  const packages = new Set()
  for (const input of Object.keys(bundle.metafile.inputs)) {
    const dependency = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1]
    if (dependency && dependency !== 'zod' && dependency !== 'marked') {
      packages.add(dependency)
    }
  }
  for (const dependency of [...packages].sort()) {
    const directory = join(source, 'node_modules', dependency)
    const license = (await readdir(directory)).find((file) => /^licen[cs]e(?:\.\w+)?$/i.test(file))
    if (!license) {
      throw new Error(`Missing bundled license for ${dependency}`)
    }
    const notice = await readFile(join(directory, license), 'utf8')
    await appendFile(join(output, 'THIRD_PARTY_NOTICES.md'), `\n\n## ${dependency}\n\n${notice.trim()}\n`)
  }
}

console.log(output)
