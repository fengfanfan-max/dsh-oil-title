/**
 * 兼容性探针：只使用插件实际调用的 DSH API。
 * 由 scripts/compat-matrix.mjs 在指定 dsh 版本的类型声明上做一次编译期校验。
 */
import type { Context } from '@deepseek-ai/cordis'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-session-title'
import '@deepseek-ai/dsh-llm'

declare const ctx: Context
declare const session: Session

// 会话存储：遍历活跃会话、按 id 取回
for (const other of ctx.sessions.list()) {
  other.id
}
const sameSession = ctx.sessions.get(session.id)

// 会话自身：日志快照 / 请求头 / 工作目录
const events = session.snapshotEvents()
for (const event of events) {
  if (event.type === 'user/message') event.data.source.kind
}
const header = session.requestHeader()
const cwd = session.header.cwd

// 标题服务：读当前标题、写回标题
const snapshot = ctx.sessionTitle.get(session)
const currentTitle = snapshot?.title
const sourceKind = snapshot?.source.kind
ctx.sessionTitle.rename(session, '🧩 probe｜compat')

// 模型流：插件构造的用户消息 + GenerateOptions 的全部字段
const message: Message = {
  id: MessageId('probe'),
  role: 'user',
  content: [{ type: 'text', text: 'hi' }],
  // 插件使用自有 source kind。MessageSourceMap 是可合并扩展的，
  // 消费方对未知 kind 按 fall through 处理，因此这里显式放宽。
  source: { kind: 'dsh-oil-title' } as unknown as Message['source'],
}

const stream = ctx.llm.stream({
  provider: 'probe',
  model: 'probe',
  messages: [message],
  system: 'probe',
  maxTokens: 8,
  purpose: 'session-title',
  sessionId: session.id,
  signal: new AbortController().signal,
})

export { sameSession, header, cwd, currentTitle, sourceKind, stream }
