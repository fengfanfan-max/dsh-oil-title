# dsh-oil-title

Keeps DeepSeek Harness session titles in sync with the work: after each turn the title becomes `<category emoji> <object>｜<ongoing goal>`, so the sidebar tells you what every session is about.

```
🧩 Title plugin｜0.2.x support     🎨 Login form｜Layout refinement
🔎 Model selection｜Accuracy        📝 Release flow｜Docs cleanup
```

## Compatibility

| dsh version | Status |
| --- | --- |
| 0.2.1-rc.2 (DSH Desktop 0.2.1-rc.2) | Install, runtime, type probe |
| 0.2.1-rc.1 | Type probe |
| 0.1.2-rc.1 | Type probe |

Peer range: `>=0.1.2-rc.1 <0.3.0`. CI installs each version's official type packages and compiles `test/compat/probe.ts` against them; the probe only calls the APIs this plugin depends on, so a green build means those signatures still hold. Versions live in [`compat.json`](./compat.json). 0.3.x is unverified; move the upper bound only after re-checking.

## Install

```sh
dsh plugin --profile desktop add dsh-oil-title
```

Or straight from GitHub:

```sh
dsh plugin --profile desktop add github:fengfanfan-max/dsh-oil-title
```

Restart DSH, then send a concrete request in a new session; the sidebar title updates after that turn.

## Configuration

Override the row in `~/.dsh/profiles/<profile>/cordis.patch.yml` (or global `~/.dsh/cordis.patch.yml`):

```yaml
- id: dsh-oil-title
  config:
    enabled: true
    reasoning: min        # min | default | <effort-id>
    debug: false          # decision log, off by default
    debounceMs: 600
    timeoutMs: 60000
    routeRetryMs: 1500
    maxMessages: 5
    maxChars: 600
    maxConflicts: 16
    respectManualTitles: true
```

With `respectManualTitles`, a title you rename by hand into free-form text is treated as pinned and never overwritten automatically.

`reasoning` controls thinking on the title call: `min` takes the model's lowest advertised effort (for DeepSeek that is `off`, i.e. thinking disabled); `default` leaves the provider default (usually high). If the chosen effort is rejected, the call retries once without it.

`debug` appends every decision to `~/.dsh/dsh-oil-title.log` (JSONL). It is off in published builds; `scripts/check-release.mjs` blocks `npm publish` while it is enabled.

## Boundaries

- Titles are written only through the official `sessionTitle.rename()`; no provider registration, no core changes, no direct session-store writes.
- The model sees truncated data only: the latest `maxMessages` user messages (`maxChars` each), the current title, the workspace leaf name, and other live session titles.
- Failures, timeouts, invalid output, and title conflicts leave the current title untouched and add no messages.
- No extra network calls, no data upload.

## Relation to upstream

This repository is a fork of [oil-dsh-title](https://github.com/598829314/oil-dsh-title); the naming policy comes from [oil-codex-title](https://github.com/oil-oil/oil-codex-title).

Upstream pins exact peer versions (`0.1.2-rc.1`), which DSH 0.2.x rejects at install time. The APIs used are unchanged between both versions, so a semantic range fixes it. Fixes were sent upstream: [#1 compatibility](https://github.com/598829314/oil-dsh-title/pull/1) · [#2 debounce/dedupe](https://github.com/598829314/oil-dsh-title/pull/2) · [#3 manual pin (draft)](https://github.com/598829314/oil-dsh-title/pull/3). Until they land, this repo maintains the full feature set.

| Aspect | Upstream oil-dsh-title | This repo |
| --- | --- | --- |
| Peer versions | Exact `0.1.2-rc.1`, rejected on 0.2.x | Range `>=0.1.2-rc.1 <0.3.0`, optional |
| Trigger | Fires on two events | Debounced, route retry |
| Duplicates | Same batch may call the model twice | Deduplicated by latest `seq` |
| Manual rename | Overwritten later | Treated as pinned |
| Config | None | See above |

See [docs/兼容性.md](./docs/兼容性.md) for compatibility details (Chinese).

## Development

```sh
npm test
npm run check
```

## License

MIT. Naming policy from [oil-codex-title](https://github.com/oil-oil/oil-codex-title) (oil); DSH integration from [oil-dsh-title](https://github.com/598829314/oil-dsh-title) (G_QMark). Not affiliated with DeepSeek.
