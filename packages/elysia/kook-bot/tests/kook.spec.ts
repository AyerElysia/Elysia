import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { OutboundText } from '../../conscious-mind/src/outbound.ts'
import { KookClient } from '../src/client.ts'
import { parseElysiumKookConfig } from '../src/config.ts'
import { handleKookFrame } from '../src/frame.ts'
import { kookInboundText } from '../src/inbound.ts'
import * as KookBot from '../src/index.ts'

const settings = parseElysiumKookConfig(`
[bot]
token = "bot-token"
bot_name = "爱莉希雅"
[features]
use_kmarkdown = true
reply_with_quote = true
`)

describe('Elysium KOOK config', () => {
  it('reads the bot name and the send flags', () => {
    expect(settings.botName).toBe('爱莉希雅')
    expect(settings.useKmarkdown).toBe(true)
    expect(settings.replyWithQuote).toBe(true)
    expect(settings.token).toBe('bot-token')
  })
})

describe('KOOK text', () => {
  it('turns a direct text event into a conversation and drops the bot itself', () => {
    const inbound = kookInboundText({
      channel_type: 'PERSON',
      type: 9,
      content: '在吗',
      msg_id: 'k1',
      author_id: '1370110560',
      extra: { author: { username: '小希' } },
    }, '999')
    expect(kookInboundText({
      channel_type: 'PERSON',
      type: 1,
      content: '自己',
      msg_id: 'k2',
      author_id: '999',
    }, '999')).toBeUndefined()
    expect(inbound).toMatchObject({
      channel: 'kook',
      conversation: 'kook:direct:1370110560',
      messageId: 'k1',
      senderName: '小希',
      text: '在吗',
    })
  })

  it('sends one channel segment as kmarkdown and quotes the first reply', async () => {
    const calls: { url: string; authorization?: string; body?: unknown }[] = []
    const client = new KookClient(settings, async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return Response.json({ code: 0, data: { msg_id: 'k-sent' } })
    })
    const receipt = await client.sendText({
      conversation: 'kook:channel:42',
      text: '第一句',
      replyTo: 'k1',
    })
    expect(receipt).toEqual({ messageId: 'k-sent' })
    expect(calls[0]?.url).toContain('/message/create')
    expect(calls[0]?.authorization).toBe('Bot bot-token')
    expect(calls[0]?.body).toEqual({ target_id: '42', content: '第一句', type: 9, quote: 'k1' })
  })
})

describe('KOOK gateway frames', () => {
  it('accepts hello, keeps the newest event, and clears the session on reconnect', () => {
    const state = { sn: 0, sessionId: '' }
    expect(handleKookFrame({ s: 1, d: { code: 0, session_id: 'sess' } }, state)).toEqual({ type: 'hello', sessionId: 'sess' })
    expect(handleKookFrame({ s: 0, sn: 4, d: { content: '在吗' } }, state)).toEqual({ type: 'event', event: { content: '在吗' } })
    expect(handleKookFrame({ s: 0, sn: 4, d: { content: '旧的' } }, state)).toEqual({ type: 'ignore' })
    expect(handleKookFrame({ s: 5 }, state)).toEqual({ type: 'reconnect' })
    expect(state).toEqual({ sn: 0, sessionId: '' })
  })
})

describe('kook-bot plugin', () => {
  it('registers the kook sender from a config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kook-bot-'))
    const configPath = join(dir, 'config.toml')
    await writeFile(configPath, `
[bot]
token = "bot-token"
bot_name = "爱莉希雅"
`)
    const ctx = new Context()
    try {
      new OutboundText(ctx)
      const fiber = await ctx.plugin(KookBot, { configPath, listen: false })
      expect(typeof ctx.outboundText.sender('kook')).toBe('function')
      await fiber.dispose()
      expect(ctx.outboundText.sender('kook')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
