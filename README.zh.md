# dsh-oil-title

让 DeepSeek Harness 的会话标题跟着工作走：每轮对话后自动维护成「类别 emoji + 对象｜目标」，侧边栏一眼看出每个会话在做什么。

```
🧩 标题插件｜兼容 0.2.x     🎨 登录表单｜布局优化
🔎 模型选型｜准确率对比       📝 发布流程｜文档整理
```

## 兼容性

| dsh 版本 | 状态 |
| --- | --- |
| 0.2.1-rc.2（DSH Desktop 0.2.1-rc.2） | 安装与运行已验证 |
| 0.1.2-rc.1 | 仍在支持范围 |

peer 声明为 `>=0.1.2-rc.1 <0.3.0`。0.3.x 尚未验证，确认接口未变之后再放开上界。

## 安装

```sh
dsh plugin --profile desktop add dsh-oil-title
```

也可以直接从 GitHub 装：

```sh
dsh plugin --profile desktop add github:fengfanfan-max/dsh-oil-title
```

重启 DSH，在新会话里发一条具体需求，这一轮结束后侧边栏标题就会更新。

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

`respectManualTitles` 打开时，如果你手动把标题改成不符合「emoji 对象｜目标」的自由文本，插件会当成你固定的名字，不再自动覆盖。

## 行为边界

- 只通过官方 `sessionTitle.rename()` 写标题，不注册 provider、不改 DSH 核心、不直接写会话库。
- 发给模型的只有截断后的数据：最近 `maxMessages` 条用户消息（每条 `maxChars` 字符）、当前标题、工作目录末级名称、其他活跃会话标题。
- 模型失败、超时、输出不合规或标题冲突时保持原标题，不新增命名消息。
- 不额外联网，不上传数据。

## 与上游的关系

本仓库基于 [oil-dsh-title](https://github.com/598829314/oil-dsh-title) fork，命名规则来自 [oil-codex-title](https://github.com/oil-oil/oil-codex-title)。

上游把 peer 依赖锁成精确的 `0.1.2-rc.1`，而 DSH 0.2.x 会按这份声明做安装期版本门禁并直接拒绝安装。实测两版接口未变，改成语义化范围即可。相关修复已提交上游：[#1 兼容修复](https://github.com/598829314/oil-dsh-title/pull/1) · [#2 防抖与去重](https://github.com/598829314/oil-dsh-title/pull/2) · [#3 手动固定（草稿）](https://github.com/598829314/oil-dsh-title/pull/3)。合入之前，本仓库独立维护完整能力。

| 项目 | 上游 oil-dsh-title | 本仓库 |
| --- | --- | --- |
| peer 版本 | 精确 `0.1.2-rc.1`，0.2.x 被拒 | 范围 `>=0.1.2-rc.1 <0.3.0`，可选 |
| 触发 | 两个事件各触发一次 | 防抖合并，路由缺失自动重试 |
| 重复 | 同一批消息可能重复调用 | 按最新消息 `seq` 去重 |
| 手动改名 | 会被后续覆盖 | 视为固定，默认不覆盖 |
| 配置 | 无 | 见上方配置块 |

兼容性细节与复核流程见 [docs/兼容性.md](./docs/兼容性.md)。

## 开发

```sh
npm test          # 单元测试 + 版本门禁回归
npm run check     # 测试 + 打包检查
```

## 许可

MIT。命名策略来自 [oil-codex-title](https://github.com/oil-oil/oil-codex-title)（作者 oil），DSH 接入层来自 [oil-dsh-title](https://github.com/598829314/oil-dsh-title)（作者 G_QMark）。与 DeepSeek 官方无隶属关系。
