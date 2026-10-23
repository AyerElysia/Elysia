# @elysia/request-archive

English | [中文](README.zh.md)

Before each model call is sent, the request as it stands is written to one JSON file. However the session log is later compacted or replaced, these files stay as they were.

The request hooks into `llm/stream`. A write failure stops that call from reaching the adapter.

Files live in `/home/ayerelysia/Elysia/Data/requests`, one per call. The directory is configurable:

```yaml
- id: elysia-request-archive
  name: elysia-request-archive
  config:
    dir: /home/ayerelysia/Elysia/Data/requests
```

Each record holds the `messages`, `system`, tool schemas, model, temperature, and `sessionId` as they were then. The abort signal is not written. Images stay as the attachment references the request carried; their bytes remain in attachment storage.
