import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function parse(version) {
  const [core, pre] = version.split('-')
  const nums = core.split('.').map(Number)
  return { nums, pre: pre ? pre.split('.') : [] }
}

function compare(a, b) {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] < right.nums[i] ? -1 : 1
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  const size = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < size; i += 1) {
    const l = left.pre[i]
    const r = right.pre[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = Number(l)
    const rn = Number(r)
    const lIsNum = !Number.isNaN(ln)
    const rIsNum = !Number.isNaN(rn)
    if (lIsNum && rIsNum && ln !== rn) return ln < rn ? -1 : 1
    if (lIsNum !== rIsNum) return lIsNum ? -1 : 1
    if (!lIsNum && l !== r) return l < r ? -1 : 1
  }
  return 0
}

function satisfies(version, range) {
  return range.split(' ').filter(Boolean).every(part => {
    const op = part.match(/^(>=|<=|>|<|=)?(.*)$/)
    const target = op[2]
    const verdict = compare(version, target)
    switch (op[1] || '=') {
      case '>=': return verdict >= 0
      case '<=': return verdict <= 0
      case '>': return verdict > 0
      case '<': return verdict < 0
      default: return verdict === 0
    }
  })
}

test('peer 范围覆盖 DSH 0.2.1-rc.2 与 0.1.2-rc.1（版本门禁不再拒绝安装）', () => {
  const required = ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-title']
  for (const dep of required) {
    const range = pkg.peerDependencies[dep]
    assert.ok(range, `缺少 ${dep} 的 peer 声明`)
    assert.equal(satisfies('0.2.1-rc.2', range), true, `${dep} ${range} 不包含 0.2.1-rc.2`)
    assert.equal(satisfies('0.1.2-rc.1', range), true, `${dep} ${range} 不包含 0.1.2-rc.1`)
  }
})

test('没有锁死的精确 peer 版本，且全部标记为可选（插件不导入这些包）', () => {
  for (const [dep, range] of Object.entries(pkg.peerDependencies)) {
    assert.match(range, /[<>=^~]/, `${dep} 使用了精确版本 ${range}`)
    assert.equal(pkg.peerDependenciesMeta?.[dep]?.optional, true, `${dep} 未标记为可选`)
  }
})

test('bundle patch 与入口文件完整，且不依赖构建期脚本（无需 allowBuilds）', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.scripts?.prepare, undefined)
  assert.ok(pkg.files.includes('lib') && pkg.files.includes('cordis.patch.yml'))
})
