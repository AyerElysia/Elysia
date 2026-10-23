# @elysia/kook-bot

English | [中文](README.zh.md)

The KOOK channel plugin. It connects the Bot Elysium already uses to the conscious mind's `send_text`.

The account is not stored twice. The Bot Token comes from `config/plugins/kook_adapter/config.toml`.

## Conversation windows

`channel` is always `kook`.

| Window | id |
|---|---|
| Direct message | `kook:direct:<userId>` |
| Channel | `kook:channel:<channelId>` |

`userId` and `channelId` are the positive-integer strings KOOK events carry. The inbound message carries this id, and a reply copies it back into `conversation` unchanged.

## Sending

Direct messages use `/direct-message/create`; channels use `/message/create`. When `use_kmarkdown` is true the message type is 9, otherwise 1. When `reply_with_quote` is true, `replyTo` goes into `quote`. Each segment sends one text message.

## Receiving

Text inside Gateway signal 0 becomes:

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

The bot's own messages are dropped. With `listen: true` the plugin opens the Gateway. One token can hold only one gateway, and connecting again displaces the running Elysium instance.
