# dsh-oil-title

A DeepSeek Harness plugin (compatible with **0.1.x – 0.2.x**) that keeps session titles meaningful: after each turn it maintains a title of the form `<category emoji> <object>｜<ongoing goal>`.

This is a fork of [oil-dsh-title](https://github.com/598829314/oil-dsh-title), which ports the naming policy of [oil-codex-title](https://github.com/oil-oil/oil-codex-title) to DSH. The fork fixes installation on DSH 0.2.x and hardens runtime behaviour.

## Why this fork exists

`oil-dsh-title@0.1.1` pinned exact peer versions (`0.1.2-rc.1`). DSH 0.2.x gates plugin installation on those declarations and rejects it. The APIs the plugin actually uses are unchanged in 0.2.1-rc.2, so relaxing the ranges to `>=0.1.2-rc.1 <0.3.0` (marked optional, since nothing is imported at runtime) restores installation without changing behaviour.

## Differences from upstream

- Semantic peer ranges instead of exact pins.
- Single trigger (`user/message`) with debounce; route retry; per-session `seq` dedupe.
- Respects a title you renamed by hand: a free-form title is treated as pinned and never overwritten.
- Configurable (`debounceMs`, `timeoutMs`, `respectManualTitles`, …).
- No `prepare` script, so git installs do not need `allowBuilds`.

## Install

```sh
dsh plugin --profile desktop add github:<you>/dsh-oil-title
```

## License

MIT. Naming policy: [oil-codex-title](https://github.com/oil-oil/oil-codex-title). DSH integration: [oil-dsh-title](https://github.com/598829314/oil-dsh-title).
