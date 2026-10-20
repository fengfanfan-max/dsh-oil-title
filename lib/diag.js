/**
 * 诊断日志：默认关闭（DEFAULT_DEBUG = false），只有显式开启时才写盘。
 * 开启方式：配置 debug: true，或环境变量 DSH_OIL_TITLE_DIAG=1。
 * 发版前 scripts/check-release.mjs 会校验 DEFAULT_DEBUG 仍为 false。
 */
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_DEBUG = false
export const DIAG_PATH = join(homedir(), '.dsh', 'dsh-oil-title.log')
const MAX_BYTES = 2_000_000

let enabled = DEFAULT_DEBUG

export function configureDebug(value) {
  enabled = value === true || process.env.DSH_OIL_TITLE_DIAG === '1'
}

function rotate() {
  try {
    if (existsSync(DIAG_PATH) && statSync(DIAG_PATH).size > MAX_BYTES) {
      renameSync(DIAG_PATH, DIAG_PATH + '.old')
    }
  } catch {}
}

export function diag(event, data = {}) {
  if (!enabled) return
  try {
    rotate()
    appendFileSync(DIAG_PATH, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ev: event, ...data }) + '\n')
  } catch {}
}

export function short(id) {
  return typeof id === 'string' ? id.slice(-8) : String(id)
}
