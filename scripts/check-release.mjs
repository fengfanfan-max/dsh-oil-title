#!/usr/bin/env node
/**
 * 发版守卫：确保诊断日志在发布前自动处于关闭状态。
 *
 * 本地排错时可以把 lib/diag.js 里的 DEFAULT_DEBUG 改成 true，
 * 但 npm publish 会先跑本脚本；只要它还是 true 就拒绝发版。
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/diag.js', import.meta.url), 'utf8')
const matched = source.match(/export const DEFAULT_DEBUG = (true|false)/)

if (!matched) {
  console.error('check-release: 找不到 DEFAULT_DEBUG 声明')
  process.exit(1)
}
if (matched[1] !== 'false') {
  console.error('check-release: DEFAULT_DEBUG 仍为 true，拒绝发版（请先改回 false）')
  process.exit(1)
}
console.log('check-release: DEFAULT_DEBUG=false ✓')
