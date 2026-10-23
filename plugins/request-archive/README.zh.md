# @elysia/request-archive

[English](README.md) | 中文

每次模型调用发出去之前，把当时的完整请求写成一个 JSON 文件。会话日志之后怎么压缩、替换，这些文件都不再改。

请求挂在 `llm/stream` 上。写盘失败时，这次调用不会继续发给适配器。

文件在 `/home/ayerelysia/Elysia/Data/requests`，一个调用一个文件。可用配置改目录：

```yaml
- id: elysia-request-archive
  name: elysia-request-archive
  config:
    dir: /home/ayerelysia/Elysia/Data/requests
```

每份记录包含当时的 `messages`、`system`、工具 schema、模型、温度和 `sessionId`。取消信号不写入。图片以请求里的附件引用保留，字节仍在附件存储里。
