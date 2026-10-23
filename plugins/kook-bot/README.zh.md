# @elysia/kook-bot

[English](README.md) | 中文

KOOK 渠道插件。它把 Elysium 已经在用的 Bot 接到主意识的 `send_text`。

账号不另存一份。Bot Token 读 `config/plugins/kook_adapter/config.toml`。

## 会话窗口

`channel` 固定是 `kook`。

| 窗口 | id |
|---|---|
| 私信 | `kook:direct:<userId>` |
| 频道 | `kook:channel:<channelId>` |

`userId` 和 `channelId` 是 KOOK 事件里的正整数字符串。入口消息带上这个 id，回复时原样抄回 `conversation`。

## 发送

私信用 `/direct-message/create`，频道用 `/message/create`。`use_kmarkdown` 为真时消息类型是 9，否则是 1。`reply_with_quote` 为真时，`replyTo` 放进 `quote`。每一段只发一条文字。

## 接收

Gateway 信令 0 里的文字收成：

```ts
interface KookInboundText {
  channel: 'kook'
  conversation: string
  target: { kind: 'direct'; userId: string } | { kind: 'channel'; channelId: string }
  messageId: string
  senderId: string
  senderName: string
  text: string
}
```

机器人自己的消息丢掉。`listen: true` 时插件打开 Gateway。同一枚 Token 只能保持一条，再连一次会把正在跑的 Elysium 顶掉。
