# @elysia/conscious-mind

爱莉希雅的主意识。一个 agent，一条长期 session。

插件不重做 Harness 已有的会话日志、压缩、提示词组装和工具循环。下面两件是这个插件自己的。

## 前缀

前缀是系统提示词里那一段稳定身份。固定提示词都放在一个目录里。插件不扫描这个目录，只按配置里的文件名顺序读取、拼成一段。

目录和文件名都写在本插件的配置里，例如：

```yaml
baseDir: /home/ayerelysia/Elysia/Data/standing-prompts
files:
  - SOUL.md
  - USER.md
  - MEMORY.md
  - EXISTENCE.md
  - TOOLS.md
```

`baseDir` 可以是绝对路径。相对路径在插件挂载时按进程的当前目录解析。Harness 没有「提示词目录」这个配置；`personaPrefix` 只接受一段写死在配置里的字符串。目录路径由本插件自己的配置字段保存。

加载复用 `ctx.systemPrompt.section()`。注册一段 `complete: true`、`interpolate: false` 的段，`text` 是函数。agent loop 每个模型步骤都会 `assemble()`，函数在这一刻按 `files` 顺序把文件读出来，用空行接上。段的 `text` 回调是同步的，而 `complete` 段在异步 waterfall 之前就定稿，所以这里用同步读盘，不用 `ctx.fs.readText`。`interpolate: false` 让正文里的 `{{` 保持原样。`complete` 让这一段成为整份系统提示词，盖住 Harness 自带的 `harness:identity`。

`SOUL.md` 读不到或是空的，这一轮中止，不用上一轮的缓存继续说。名单里其他文件缺失或为空就跳过。文件名必须落在这个目录里。

爱莉的五份正文不放在这个包里，放在 `/home/ayerelysia/Elysia/Data/standing-prompts`：`SOUL.md`、`USER.md`、`MEMORY.md`、`EXISTENCE.md`、`TOOLS.md`。

文件变动也不另做监视。`ctx.fs.watch` 和技能目录用的 Chokidar 都没有接到系统提示词上；`system-prompt/change` 只在注册或卸下提示词段时发出，文件内容变了不会发。下一轮 `assemble()` 会重新读盘，agent loop 拿渲染后的整段字符串和当前 `system/message` 比较：一样就不写会话；不一样就由 `SystemPromptProjection` 更新。路由声明了 `systemPromptUpdate: 'in-history'` 且这次请求序列还在延续，新前缀追加到历史后面；否则原地替换开头那一条。会话闲着的时候改文件，要等到下一次模型步骤才会被读到。

现在在哪个聊天、直播怎么接话，不写进前缀。那是入口消息上的现场。说话习惯写在这些文件里，不写在插件代码里。

## send_text

`send_text` 是主意识把文字发到外部渠道的工具。渠道是 QQ、飞书、Kook，以及以后接上的同类入口。

模型直接写出的 assistant 正文只留在这条 session 里，不会出现在任何渠道上。要让对方看见，必须调用 `send_text`。调用带上正文，以及发到哪个渠道、哪一段对话。

这个工具不实现 QQ、飞书、Kook 的连接和协议。它把「正文」和「发到哪」交给对应的渠道插件，由渠道插件送出去。

## 终端入口

在 `deepseek-harness` 目录下，用 Node 22：

```sh
pnpm exec tsx --tsconfig tsconfig.base.json packages/elysia/conscious-mind/src/tui.ts
```

这台机器上的 Node 22 和 pnpm 在 `/home/ayerelysia/.local/share/node-v22/bin`。`/quit` 退出。

每一轮都重新组装前缀，再发给模型。模型默认走 Elysium `config/models.toml` 里的 `providers.NexusAI`，模型名 `gemini-3.8-flash`。可以用 `ELYSIA_BASE_URL`、`ELYSIA_API_KEY`、`ELYSIA_MODEL`，或 `--base-url`、`--model` 换掉。`--once "一句话"` 只问一轮。

这一入口把模型正文打在终端上，还没有发到 QQ、飞书、Kook。
