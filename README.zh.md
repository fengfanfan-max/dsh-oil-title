# dsh-oil-title

兼容 **DeepSeek Harness 0.1.x ～ 0.2.x** 的会话标题插件：每轮对话后自动把会话标题维护成「类别 emoji + 对象｜目标」，在侧边栏一眼找回在做什么。

这是 [oil-codex-title](https://github.com/oil-oil/oil-codex-title) 命名规则在 DSH 上的第三个一脉相承的移植：命名策略沿用 oil 的原始设计，DSH 接入层基于 [oil-dsh-title](https://github.com/598829314/oil-dsh-title) 重做，主要解决 **DSH 0.2.x 插件版本门禁拒绝安装** 的问题，并补强并发与「手动固定标题」的行为。

## 上游 PR

- [#1 fix: 放宽 peer 依赖范围](https://github.com/598829314/oil-dsh-title/pull/1) —— 最小兼容修复，只改 peer 范围 + 一条回归测试
- [#2 perf: 合并连续触发并跳过重复批次](https://github.com/598829314/oil-dsh-title/pull/2) —— 防抖与去重
- [#3 feat: 用户手动改名后不再自动覆盖](https://github.com/598829314/oil-dsh-title/pull/3) —— 手动固定（草稿，堆叠在 #2 上）

合入进度以 PR 状态为准；本仓库不等上游发版，独立维护完整能力。

## 为什么需要这个 fork

上游 `oil-dsh-title@0.1.1` 把 peer 依赖锁成了精确版本：

```json
"peerDependencies": {
  "@deepseek-ai/dsh-llm": "0.1.2-rc.1",
  "@deepseek-ai/dsh-session": "0.1.2-rc.1",
  "@deepseek-ai/dsh-session-title": "0.1.2-rc.1"
}
```

DSH 0.2.x 的插件管理器按这份声明做版本门禁，于是：

```
dsh: installation rejected: Plugin oil-dsh-title@0.1.1 is incompatible with dsh 0.2.1-rc.2:
requirements {"@deepseek-ai/dsh-llm":"0.1.2-rc.1", ...}
```

实测比对 0.1.2-rc.1 与 0.2.1-rc.2 的类型声明，插件用到的 API（`sessions.list` / `session.snapshotEvents` / `session.requestHeader` / `ctx.llm.stream` / `sessionTitle.get` / `sessionTitle.rename`）**全部未变**。所以这里把 peer 改成语义化范围并标记可选（插件运行时不 import 这些包），门禁即通过，行为不变。

## 相对上游的改动

| 项目 | 上游 oil-dsh-title | 本 fork |
| --- | --- | --- |
| peer 版本 | 精确 `0.1.2-rc.1`，0.2.x 被拒 | 范围 `>=0.1.2-rc.1 <0.3.0`，可选 |
| 触发方式 | `user/message` 与 `request/header` 各触发一次 | 只在 `user/message` 触发，debounce 合并，路由缺失自动重试一次 |
| 重复触发 | 同一批消息可能重复调用模型 | 按最新消息 `seq` 去重 |
| 手动改过的标题 | 会被后续自动改名覆盖 | 识别为「用户固定」，默认不再覆盖 |
| 插件配置 | 无 | `debounceMs` / `timeoutMs` / `respectManualTitles` 等 |
| 构建期脚本 | — | 无 `prepare`，从 git 安装不需要 allowBuilds |

## 安装

```sh
# 本地目录（开发）
dsh plugin --profile desktop add /path/to/dsh-oil-title

# GitHub
dsh plugin --profile desktop add github:<你的账号>/dsh-oil-title
```

安装后重启 DSH，在新会话里发一条具体需求，等这一轮结束后看侧边栏标题。

## 配置

在 `~/.dsh/profiles/<profile>/cordis.patch.yml`（或全局 `~/.dsh/cordis.patch.yml`）里按行覆盖：

```yaml
- id: dsh-oil-title
  config:
    enabled: true
    debounceMs: 600
    timeoutMs: 60000
    routeRetryMs: 1500
    maxMessages: 5
    maxChars: 600
    maxConflicts: 16
    respectManualTitles: true
```

`respectManualTitles` 打开时，如果你把标题手动改成不符合「emoji 对象｜目标」的自由文本，插件就把它当成你固定的名字，不再自动覆盖。

## 行为边界

- 只用官方 `sessionTitle.rename()` 写标题，不注册 provider、不改 DSH 核心、不直接写会话库。
- 发给模型的只有截断后的数据：最近 `maxMessages` 条用户消息（每条 `maxChars` 字符）、当前标题、工作目录末级名称、其他活跃会话标题。
- 模型失败、超时、输出不合规、标题冲突时一律保持原标题，不新增命名消息。
- 不上传任何数据；不使用插件之外的网络请求。

## 开发

```sh
npm test          # 单元测试 + 版本门禁回归
npm run check     # 测试 + 打包检查
```

## 许可与致谢

MIT。命名规则部分来自 [oil-codex-title](https://github.com/oil-oil/oil-codex-title)（作者 oil），DSH 接入层来自 [oil-dsh-title](https://github.com/598829314/oil-dsh-title)（作者 G_QMark）。本仓库与 DeepSeek 官方无隶属关系。
