import { randomUUID } from 'node:crypto'

import { configureDebug, diag, short } from './diag.js'
import {
  SYSTEM_PROMPT,
  cleanText,
  createTextAssembler,
  looksLikeOilTitle,
  normalizeTitle,
  parseModelResult,
  salvageTitle,
  validateTitle,
} from './core.js'

diag('module-import', { version: '0.1.5' })

const name = 'dsh-oil-title'
const inject = ['sessionTitle', 'llm', 'sessions']

const DEFAULTS = {
  enabled: true,
  debug: false,
  reasoning: 'min',
  debounceMs: 600,
  timeoutMs: 60000,
  routeRetryMs: 1500,
  maxMessages: 5,
  maxChars: 600,
  maxConflicts: 16,
  respectManualTitles: true,
}

function resolveConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const opts = { ...DEFAULTS }
  if (typeof source.enabled === 'boolean') opts.enabled = source.enabled
  if (typeof source.debug === 'boolean') opts.debug = source.debug
  if (typeof source.respectManualTitles === 'boolean') opts.respectManualTitles = source.respectManualTitles
  if (typeof source.reasoning === 'string' && source.reasoning.trim()) opts.reasoning = source.reasoning.trim()
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
  } catch (error) {
    diag('route-error', { message: String(error && error.message) })
  }
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
  } catch (error) {
    diag('conflicts-error', { message: String(error && error.message) })
  }
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
  } catch (error) {
    diag('messages-error', { message: String(error && error.message) })
  }
  return messages.slice(-maxMessages)
}

const effortCache = new Map()

async function resolveEffort(ctx, opts, route) {
  if (opts.reasoning === 'default') return undefined
  if (opts.reasoning !== 'min') return opts.reasoning
  const key = route.provider + '/' + route.model
  if (effortCache.has(key)) return effortCache.get(key)
  let effort
  try {
    const info = await ctx.llm.resolveModelInfo(route.provider, route.model)
    const efforts = info && info.reasoning && info.reasoning.efforts
    effort = Array.isArray(efforts) && efforts.length > 0 ? efforts[0].id : undefined
  } catch (error) {
    diag('effort-error', { message: String(error && error.message) })
  }
  effortCache.set(key, effort)
  diag('effort-resolved', { route: key, effort: effort || null })
  return effort
}

async function streamTitle(ctx, route, input, sessionId, signal, effort) {
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: JSON.stringify(input) }],
    source: { kind: name },
  }
  const options = {
    provider: route.provider,
    model: route.model,
    messages: [message],
    system: SYSTEM_PROMPT,
    maxTokens: 2048,
    purpose: 'session-title',
    sessionId,
    signal,
  }
  if (effort) options.reasoningEffort = effort
  diag('llm-call', { session: short(sessionId), reasoningEffort: effort || null })
  const stream = ctx.llm.stream(options)
  const assembler = createTextAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  const result = assembler.finish()
  const finish = result.finish && result.finish.kind
  diag('llm-done', { session: short(sessionId), finish: finish, len: (result.text || '').length, text: (result.text || '').slice(0, 300) })
  if (!result.text) throw new Error('title stream returned no text')
  if (finish !== 'stop') diag('llm-truncated', { session: short(sessionId), finish: finish })
  return result.text
}

async function generateTitle(ctx, route, input, sessionId, signal, effort) {
  diag('llm-start', { session: short(sessionId), provider: route.provider, model: route.model, messages: input.user_messages.length, current: input.current_title })
  try {
    return await streamTitle(ctx, route, input, sessionId, signal, effort)
  } catch (error) {
    const message = String(error && error.message)
    if (effort && /reasoning/i.test(message)) {
      diag('effort-unsupported', { session: short(sessionId), effort: effort, message: message })
      return streamTitle(ctx, route, input, sessionId, signal, undefined)
    }
    throw error
  }
}

function apply(ctx, config) {
  const opts = resolveConfig(config)
  configureDebug(opts.debug)
  diag('apply', {
    enabled: opts.enabled,
    config: opts,
    services: { sessionTitle: Boolean(ctx && ctx.sessionTitle), llm: Boolean(ctx && ctx.llm), sessions: Boolean(ctx && ctx.sessions) },
  })
  if (!opts.enabled) return
  if (!ctx?.sessionTitle || !ctx?.llm || !ctx?.sessions) {
    diag('apply-skip', { reason: 'missing-service' })
    return
  }

  const timers = new Map()
  const controllers = new Map()
  const inFlight = new Set()
  const written = new Set()
  const handledSeq = new Map()
  let stopped = false

  function note(sessionId, phase) {
    diag('skip', { session: short(sessionId), reason: phase })
    try {
      ctx.logger?.debug?.('oil-dsh-title: ' + phase + ' skipped')
    } catch {}
  }

  function clearTimer(sessionId) {
    const timer = timers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
  }

  function isPinnedByUser(snapshot) {
    if (!opts.respectManualTitles) return false
    if (snapshot?.source?.kind !== 'user') return false
    const title = typeof snapshot.title === 'string' ? snapshot.title : ''
    if (!title) return false
    if (written.has(title)) return false
    return !looksLikeOilTitle(title)
  }

  async function update(session, attempt) {
    const tries = attempt || 0
    if (stopped || !session || inFlight.has(session.id)) {
      note(session && session.id, 'in-flight')
      return
    }
    if (ctx.sessions.get(session.id) !== session) {
      note(session.id, 'not-live')
      return
    }

    const messages = recentUserMessages(session, opts.maxMessages, opts.maxChars)
    diag('update', { session: short(session.id), attempt: tries, messages: messages.length })
    if (messages.length === 0) {
      note(session.id, 'no-user-text')
      return
    }
    const newestSeq = messages.at(-1).seq
    if (handledSeq.get(session.id) === newestSeq) {
      note(session.id, 'duplicate-seq')
      return
    }

    const route = routeFromSession(session)
    if (!route) {
      diag('skip', { session: short(session.id), reason: 'no-route', attempt: tries })
      if (tries === 0) schedule(session, opts.routeRetryMs, tries + 1)
      return
    }
    diag('route-ok', { session: short(session.id), provider: route.provider, model: route.model })

    let snapshot
    try {
      snapshot = ctx.sessionTitle.get(session)
    } catch (error) {
      diag('title-read-error', { message: String(error && error.message) })
    }
    diag('title-current', { session: short(session.id), title: snapshot && snapshot.title, source: snapshot && snapshot.source && snapshot.source.kind })

    if (isPinnedByUser(snapshot)) {
      handledSeq.set(session.id, newestSeq)
      note(session.id, 'manual-title-pinned')
      return
    }

    inFlight.add(session.id)
    const controller = new AbortController()
    controllers.set(session.id, controller)
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs)
    const currentTitle = typeof snapshot?.title === 'string' ? snapshot.title : ''

    try {
      const input = {
        current_title: currentTitle,
        project_hint: projectHint(session.header?.cwd),
        conflicting_titles: conflictingTitles(ctx, session, opts.maxConflicts),
        user_messages: messages,
      }

      const effort = await resolveEffort(ctx, opts, route)
      let raw
      try {
        raw = await generateTitle(ctx, route, input, session.id, controller.signal, effort)
      } catch (error) {
        diag('llm-error', { session: short(session.id), message: String(error && error.message), stack: String(error && error.stack).slice(0, 600) })
        return
      }
      if (stopped || controller.signal.aborted) {
        note(session.id, 'aborted')
        return
      }

      let parsed = parseModelResult(raw)
      if (!parsed) {
        const salvaged = salvageTitle(raw)
        if (salvaged) {
          diag('salvage', { session: short(session.id), title: salvaged })
          parsed = { action: 'rename', title: salvaged, reason: 'salvaged-from-truncated-output' }
        }
      }
      let action = 'keep'
      let candidate = ''
      if (parsed && typeof parsed === 'object') {
        if (parsed.action === 'rename' || parsed.action === 'keep') action = parsed.action
        if (typeof parsed.title === 'string') candidate = parsed.title
      } else if (validateTitle(raw)) {
        action = 'rename'
        candidate = raw
      }
      diag('decision', { session: short(session.id), action: action, reason: parsed && parsed.reason })
      if (action !== 'rename') {
        handledSeq.set(session.id, newestSeq)
        return
      }

      const title = normalizeTitle(candidate)
      const valid = validateTitle(title)
      const conflict = conflictingTitles(ctx, session, opts.maxConflicts).includes(title)
      diag('candidate', { session: short(session.id), title: title, valid: valid, sameAsCurrent: title === currentTitle, conflict: conflict })
      if (!valid || title === currentTitle) {
        handledSeq.set(session.id, newestSeq)
        return
      }
      if (conflict) {
        handledSeq.set(session.id, newestSeq)
        return
      }
      if (ctx.sessions.get(session.id) !== session) {
        note(session.id, 'not-live-before-rename')
        return
      }

      try {
        ctx.sessionTitle.rename(session, title)
        written.add(title)
        handledSeq.set(session.id, newestSeq)
        diag('rename-ok', { session: short(session.id), title: title })
      } catch (error) {
        diag('rename-error', { session: short(session.id), message: String(error && error.message) })
      }
    } finally {
      clearTimeout(timeout)
      controllers.delete(session.id)
      inFlight.delete(session.id)
    }
  }

  function schedule(session, delay, attempt) {
    if (stopped || !session) return
    clearTimer(session.id)
    const wait = delay === undefined ? opts.debounceMs : delay
    diag('schedule', { session: short(session.id), wait: wait, attempt: attempt || 0 })
    const timer = setTimeout(() => {
      timers.delete(session.id)
      update(session, attempt).catch(error => {
        diag('update-threw', { session: short(session.id), message: String(error && error.message), stack: String(error && error.stack).slice(0, 600) })
      })
    }, wait)
    if (typeof timer?.unref === 'function') timer.unref()
    timers.set(session.id, timer)
  }

  ctx.effect(() => () => {
    stopped = true
    for (const sessionId of [...timers.keys()]) clearTimer(sessionId)
    for (const controller of controllers.values()) controller.abort(new Error('stopped'))
    controllers.clear()
    inFlight.clear()
    written.clear()
    handledSeq.clear()
    diag('teardown', {})
  }, 'dsh-oil-title teardown')

  ctx.on('session/event', (session, event) => {
    if (stopped || !session || !event) return
    if (event.type !== 'user/message') return
    const kind = event.data?.source?.kind
    diag('event', { session: short(session.id), seq: event.seq, sourceKind: kind })
    if (kind !== 'user') return
    schedule(session)
  })

  diag('listening', {})
}

export { apply, inject, name }
