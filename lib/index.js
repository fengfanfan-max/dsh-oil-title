import { randomUUID } from 'node:crypto'

import {
  SYSTEM_PROMPT,
  cleanText,
  createTextAssembler,
  looksLikeOilTitle,
  normalizeTitle,
  parseModelResult,
  validateTitle,
} from './core.js'

const name = 'dsh-oil-title'
const inject = ['sessionTitle', 'llm', 'sessions']

const DEFAULTS = {
  enabled: true,
  debounceMs: 600,
  timeoutMs: 60_000,
  routeRetryMs: 1_500,
  maxMessages: 5,
  maxChars: 600,
  maxConflicts: 16,
  respectManualTitles: true,
}

function resolveConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const opts = { ...DEFAULTS }
  if (typeof source.enabled === 'boolean') opts.enabled = source.enabled
  if (typeof source.respectManualTitles === 'boolean') opts.respectManualTitles = source.respectManualTitles
  for (const key of ['debounceMs', 'timeoutMs', 'routeRetryMs', 'maxMessages', 'maxChars', 'maxConflicts']) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) opts[key] = Math.floor(value)
  }
  return opts
}

function routeFromSession(session) {
  try {
    const header = session.requestHeader?.()
    const config = header?.config
    if (config?.provider && config?.model) return { provider: config.provider, model: config.model }
  } catch {}
  return undefined
}

function projectHint(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const parts = cwd.split('/').filter(Boolean)
  const leaf = parts.at(-1) || ''
  const ignored = new Set(['desktop', 'documents', 'downloads', 'tmp', 'temp', 'project', 'projects', 'users', 'home', 'workspace'])
  if (!leaf || ignored.has(leaf.toLowerCase())) return ''
  return leaf.slice(0, 64)
}

function conflictingTitles(ctx, session, limit) {
  const titles = new Set()
  try {
    for (const other of ctx.sessions.list()) {
      if (other.id === session.id) continue
      try {
        const snapshot = ctx.sessionTitle.get(other)
        if (typeof snapshot?.title === 'string' && snapshot.title.trim()) titles.add(snapshot.title)
      } catch {}
      if (titles.size >= limit) break
    }
  } catch {}
  return [...titles].slice(0, limit)
}

function recentUserMessages(session, maxMessages, maxChars) {
  const messages = []
  try {
    for (const event of session.snapshotEvents()) {
      if (event.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      const text = (Array.isArray(event.data.content) ? event.data.content : [])
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      const cleaned = cleanText(text)
      if (cleaned) messages.push({ seq: event.seq, text: cleaned.slice(0, maxChars) })
    }
  } catch {}
  return messages.slice(-maxMessages)
}

async function generateTitle(ctx, route, input, sessionId, signal) {
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: JSON.stringify(input) }],
    source: { kind: name },
  }
  const stream = ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [message],
    system: SYSTEM_PROMPT,
    maxTokens: 256,
    purpose: 'session-title',
    sessionId,
    signal,
  })
  const assembler = createTextAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  const result = assembler.finish()
  if (result.finish.kind !== 'stop') throw new Error(`title stream finished with ${result.finish.kind}`)
  if (!result.text) throw new Error('title stream returned no text')
  return result.text
}

function apply(ctx, config) {
  const opts = resolveConfig(config)
  if (!opts.enabled) return
  if (!ctx?.sessionTitle || !ctx?.llm || !ctx?.sessions) return

  const timers = new Map()
  const controllers = new Map()
  const inFlight = new Set()
  const written = new Set()
  const handledSeq = new Map()
  let stopped = false

  function debug(phase) {
    try {
      ctx.logger?.debug?.(`${name}: ${phase} skipped`)
    } catch {}
  }

  function clearTimer(sessionId) {
    const timer = timers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
  }

  function isPinnedByUser(session, snapshot) {
    if (!opts.respectManualTitles) return false
    if (snapshot?.source?.kind !== 'user') return false
    const title = typeof snapshot.title === 'string' ? snapshot.title : ''
    if (!title) return false
    if (written.has(title)) return false
    return !looksLikeOilTitle(title)
  }

  async function update(session, attempt = 0) {
    if (stopped || !session || inFlight.has(session.id)) return
    if (ctx.sessions.get(session.id) !== session) return

    const messages = recentUserMessages(session, opts.maxMessages, opts.maxChars)
    if (messages.length === 0) {
      debug('no user text')
      return
    }
    const newestSeq = messages.at(-1).seq
    if (handledSeq.get(session.id) === newestSeq) {
      debug('duplicate seq')
      return
    }

    const route = routeFromSession(session)
    if (!route) {
      if (attempt === 0) {
        debug('no route yet, retrying')
        schedule(session, opts.routeRetryMs, attempt + 1)
      } else {
        debug('no route')
      }
      return
    }

    let snapshot
    try {
      snapshot = ctx.sessionTitle.get(session)
    } catch {}

    if (isPinnedByUser(session, snapshot)) {
      handledSeq.set(session.id, newestSeq)
      debug('manual title pinned')
      return
    }

    inFlight.add(session.id)
    const controller = new AbortController()
    controllers.set(session.id, controller)
    const timeout = setTimeout(() => controller.abort(new Error(`${name} timeout`)), opts.timeoutMs)
    const currentTitle = typeof snapshot?.title === 'string' ? snapshot.title : ''

    try {
      const input = {
        current_title: currentTitle,
        project_hint: projectHint(session.header?.cwd),
        conflicting_titles: conflictingTitles(ctx, session, opts.maxConflicts),
        user_messages: messages,
      }

      let raw
      try {
        raw = await generateTitle(ctx, route, input, session.id, controller.signal)
      } catch {
        debug('model generation')
        return
      }
      if (stopped || controller.signal.aborted) return

      const parsed = parseModelResult(raw)
      let action = 'keep'
      let candidate = ''
      if (parsed && typeof parsed === 'object') {
        if (parsed.action === 'rename' || parsed.action === 'keep') action = parsed.action
        if (typeof parsed.title === 'string') candidate = parsed.title
      } else if (validateTitle(raw)) {
        action = 'rename'
        candidate = raw
      }
      if (action !== 'rename') {
        handledSeq.set(session.id, newestSeq)
        return
      }

      const title = normalizeTitle(candidate)
      if (!validateTitle(title) || title === currentTitle) {
        handledSeq.set(session.id, newestSeq)
        return
      }
      if (conflictingTitles(ctx, session, opts.maxConflicts).includes(title)) {
        handledSeq.set(session.id, newestSeq)
        return
      }
      if (ctx.sessions.get(session.id) !== session) return

      try {
        ctx.sessionTitle.rename(session, title)
        written.add(title)
        handledSeq.set(session.id, newestSeq)
      } catch {
        debug('rename')
      }
    } finally {
      clearTimeout(timeout)
      controllers.delete(session.id)
      inFlight.delete(session.id)
    }
  }

  function schedule(session, delay, attempt = 0) {
    if (stopped || !session) return
    clearTimer(session.id)
    const wait = delay === undefined ? opts.debounceMs : delay
    const timer = setTimeout(() => {
      timers.delete(session.id)
      update(session, attempt).catch(() => debug('scheduled update'))
    }, wait)
    if (typeof timer?.unref === 'function') timer.unref()
    timers.set(session.id, timer)
  }

  ctx.effect(() => () => {
    stopped = true
    for (const sessionId of [...timers.keys()]) clearTimer(sessionId)
    for (const controller of controllers.values()) controller.abort(new Error(`${name} stopped`))
    controllers.clear()
    inFlight.clear()
    written.clear()
    handledSeq.clear()
  }, `${name} teardown`)

  ctx.on('session/event', (session, event) => {
    if (stopped || !session || !event) return
    if (event.type !== 'user/message') return
    if (event.data?.source?.kind !== 'user') return
    schedule(session)
  })
}

export { apply, inject, name }
