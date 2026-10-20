#!/usr/bin/env node
/**
 * 在指定的 dsh 版本上做兼容性校验。
 *
 * 做法：临时目录里安装该版本的官方包，用 TypeScript 编译 test/compat/probe.ts。
 * 探针只调用插件实际依赖的 API，因此编译通过 = 这些接口在该版本仍然存在且签名兼容。
 *
 * 用法：
 *   node scripts/compat-matrix.mjs                 # 校验 compat.json 里的全部版本
 *   node scripts/compat-matrix.mjs --version 0.2.1-rc.2
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const compat = JSON.parse(readFileSync(join(root, 'compat.json'), 'utf8'))

const args = process.argv.slice(2)
const single = args.indexOf('--version')
const versions = single >= 0 ? [args[single + 1]] : compat.verifiedDshVersions

if (versions.some(version => typeof version !== 'string' || version.length === 0)) {
  console.error('compat-matrix: 版本号为空')
  process.exit(2)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) {
    console.error(`compat-matrix: 无法执行 ${command}: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

const results = []

for (const version of versions) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-compat-${version}-`))
  console.log(`\n=== dsh ${version} (${dir})`)

  try {
    const install = run(
      npm,
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', ...compat.packages.map(name => `${name}@${version}`)],
      dir,
    )
    if (install !== 0) {
      console.error(`compat-matrix: ${version} 依赖安装失败`)
      results.push({ version, ok: false, reason: '依赖安装失败' })
      continue
    }

    copyFileSync(join(root, 'test', 'compat', 'probe.ts'), join(dir, 'probe.ts'))
    copyFileSync(join(root, 'test', 'compat', 'tsconfig.json'), join(dir, 'tsconfig.json'))

    const compiled = run(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], dir)
    if (compiled !== 0) {
      console.error(`compat-matrix: ${version} 探针编译失败（接口签名不兼容）`)
      results.push({ version, ok: false, reason: '探针编译失败' })
      continue
    }

    console.log(`compat-matrix: ${version} 通过`)
    results.push({ version, ok: true })
  } finally {
    if (!process.env.COMPAT_KEEP) rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\n=== 兼容性矩阵')
for (const result of results) {
  console.log(`${result.ok ? '✓' : '✗'} dsh ${result.version}${result.ok ? '' : ` — ${result.reason}`}`)
}

if (results.some(result => !result.ok)) {
  console.error('\ncompat-matrix: 存在不兼容的 dsh 版本')
  process.exit(1)
}
