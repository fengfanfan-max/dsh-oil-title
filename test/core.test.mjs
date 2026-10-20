import test from 'node:test'
import assert from 'node:assert/strict'

import { createTextAssembler, looksLikeOilTitle, normalizeTitle, parseModelResult, validateTitle } from '../lib/core.js'

test('接受 oil 标题结构并拒绝不安全输出', () => {
  assert.equal(validateTitle('🧩 DSH插件｜验证自动改名'), true)
  assert.equal(validateTitle('🧩 DSH插件｜验证｜重复分隔符'), false)
  assert.equal(validateTitle('🧩 DSH插件｜https://example.com'), false)
  assert.equal(validateTitle('DSH插件｜缺少类别'), false)
  assert.equal(validateTitle('🧩 DSH插件 ｜ 带空格分隔符'), false)
})

test('规范化空白并守住 UTF-8 字节上限', () => {
  assert.equal(normalizeTitle('🧩   DSH插件\n｜\t验证自动改名'), '🧩 DSH插件｜验证自动改名')
  assert.ok(new TextEncoder().encode(normalizeTitle('🧩 ' + '中文'.repeat(100))).length <= 80)
})

test('识别「本插件会写出的标题形状」用于手动固定判别', () => {
  assert.equal(looksLikeOilTitle('🧩 DSH插件｜验证自动改名'), true)
  assert.equal(looksLikeOilTitle('我的私人标题'), false)
  assert.equal(looksLikeOilTitle('🧩 只有对象没有分隔符'), false)
})

test('解析带围栏与夹在文本中的 JSON 输出', () => {
  const result = parseModelResult('```json\n{"action":"rename","title":"🧩 DSH插件｜验证自动改名"}\n```')
  assert.deepEqual(result, { action: 'rename', title: '🧩 DSH插件｜验证自动改名' })
  assert.deepEqual(parseModelResult('前缀 {"action":"keep","title":"旧标题"} 后缀'), { action: 'keep', title: '旧标题' })
})

test('同时兼容 text-delta 与 block-end 两种流式形态且不重复', () => {
  const deltaAssembler = createTextAssembler()
  deltaAssembler.push({ type: 'text-delta', index: 0, text: '{"action":"rename"}' })
  deltaAssembler.push({ type: 'block-end', index: 0, block: { type: 'text', text: '{"action":"rename"}' } })
  deltaAssembler.push({ type: 'finish', reason: { kind: 'stop' } })
  assert.equal(deltaAssembler.finish().text, '{"action":"rename"}')

  const blockAssembler = createTextAssembler()
  blockAssembler.push({ type: 'block-end', index: 0, block: { type: 'text', text: '{"action":"keep"}' } })
  blockAssembler.push({ type: 'finish', reason: { kind: 'stop' } })
  assert.equal(blockAssembler.finish().text, '{"action":"keep"}')
})
