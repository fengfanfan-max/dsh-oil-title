process.env.DSH_OIL_TITLE_DIAG = '0'

import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

const CONFIG = { debounceMs: 0, routeRetryMs: 0 }

function userMessage(text, seq = 1) {
  return {
    seq,
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
  }
}

function makeSession({ events, route = true, model = 'test-model' } = {}) {
  return {
    id: 'session-test',
    header: { cwd: '/tmp/dsh-oil-title' },
    requestHeader: () => (route ? { config: { provider: 'test-provider', model } } : undefined),
    snapshotEvents: () => events ?? [userMessage('请验证 DSH 标题插件的事件监听和自动改名。')],
  }
}

function makeCtx(session, { snapshot, output = '{"action":"rename","title":"🧩 DSH插件｜验证自动改名"}' } = {}) {
  const state = {
    listener: undefined,
    cleanup: undefined,
    renamed: [],
    calls: 0,
    title: snapshot ?? { title: '旧标题' },
  }
  const ctx = {
    sessionTitle: {
      get: () => state.title,
      rename: (_session, value) => {
        state.renamed.push(value)
        state.title = { title: value, source: { kind: 'user' } }
      },
    },
    llm: {
      stream: async function* () {
        state.calls += 1
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    sessions: {
      list: () => [session],
      get: id => (id === session.id ? session : undefined),
    },
    on: (_event, handler) => {
      state.listener = handler
    },
    effect: factory => {
      state.cleanup = factory()
    },
    logger: { debug: () => {} },
  }
  return { ctx, state }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

test('用户发言后按 debounce 自动改名', async () => {
  const session = makeSession()
  const { ctx, state } = makeCtx(session)
  apply(ctx, CONFIG)
  state.listener(session, userMessage('请验证 DSH 标题插件的事件监听和自动改名。'))
  await settle()
  assert.deepEqual(state.renamed, ['🧩 DSH插件｜验证自动改名'])
  assert.equal(state.calls, 1)
  state.cleanup?.()
})

test('同一批消息重复触发只调用一次模型', async () => {
  const session = makeSession()
  const { ctx, state } = makeCtx(session)
  apply(ctx, CONFIG)
  state.listener(session, userMessage('同一批消息', 7))
  await settle()
  state.listener(session, userMessage('同一批消息', 7))
  await settle()
  assert.equal(state.calls, 1)
  state.cleanup?.()
})

test('用户手动改出的自由标题会被当成固定标题，不再覆盖', async () => {
  const session = makeSession()
  const { ctx, state } = makeCtx(session, { snapshot: { title: '我自己起的名字', source: { kind: 'user' } } })
  apply(ctx, CONFIG)
  state.listener(session, userMessage('换个话题继续'))
  await settle()
  assert.deepEqual(state.renamed, [])
  assert.equal(state.calls, 0)
  state.cleanup?.()
})

test('模型返回 keep 时不改名', async () => {
  const session = makeSession()
  const { ctx, state } = makeCtx(session, { output: '{"action":"keep","title":"旧标题"}' })
  apply(ctx, CONFIG)
  state.listener(session, userMessage('继续'))
  await settle()
  assert.deepEqual(state.renamed, [])
  state.cleanup?.()
})

test('没有可用路由时不抛错也不改名', async () => {
  const session = makeSession({ route: false })
  const { ctx, state } = makeCtx(session)
  apply(ctx, CONFIG)
  state.listener(session, userMessage('没有路由'))
  await settle()
  assert.deepEqual(state.renamed, [])
  state.cleanup?.()
})

test('模型不支持指定 reasoning 档位时自动降级重试', async () => {
  const session = makeSession({ model: 'test-model-effort' })
  const { ctx, state } = makeCtx(session)
  const usedEfforts = []
  ctx.llm.resolveModelInfo = async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } })
  ctx.llm.stream = async function* (options) {
    state.calls += 1
    usedEfforts.push(options.reasoningEffort)
    if (options.reasoningEffort) throw new Error('UNSUPPORTED_REASONING_EFFORT: not supported by this model')
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"action":"rename","title":"🧩 DSH插件｜降级重试"}' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  apply(ctx, CONFIG)
  state.listener(session, userMessage('测试 reasoning 降级'))
  await settle()
  assert.deepEqual(usedEfforts, ['off', undefined])
  assert.deepEqual(state.renamed, ['🧩 DSH插件｜降级重试'])
  state.cleanup?.()
})

test('模型输出不合规的标题时保持原标题', async () => {
  const session = makeSession()
  const { ctx, state } = makeCtx(session, { output: '{"action":"rename","title":"普通标题没有结构"}' })
  apply(ctx, CONFIG)
  state.listener(session, userMessage('输出不合规'))
  await settle()
  assert.deepEqual(state.renamed, [])
  state.cleanup?.()
})