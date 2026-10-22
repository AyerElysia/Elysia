/**
 * Keep the new QQ path up: an inbound text becomes one model turn, and the
 * reply leaves only through send_text.
 */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ConsciousMind from '../../conscious-mind/src/index.ts'
import { defineSendTextTool } from '../../conscious-mind/src/send-text.ts'
import type { SendTextArgs, SendTextResult } from '../../conscious-mind/src/send-text.ts'
import { loadElysiumNapcatConfig } from './config.ts'
import type { QqInboundText } from './inbound.ts'
import { NapcatLink } from './link.ts'

const PROMPTS = '/home/ayerelysia/Elysia/Data/standing-prompts'
const MODELS_TOML = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../config/models.toml')
const FILES = ['SOUL.md', 'USER.md', 'MEMORY.md', 'EXISTENCE.md', 'TOOLS.md']
const AYER = '2665253325'

interface ChatConfig {
  baseURL: string
  apiKey: string
  model: string
}

function tomlString(section: string, key: string, source: string): string | undefined {
  const body = source.split(/\n(?=\s*\[)/).find(block => block.trimStart().startsWith(`[${section}]`))
  const match = body === undefined ? undefined : new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(body)
  return match?.[1]
}

function loadChatConfig(): ChatConfig {
  const source = readFileSync(MODELS_TOML, 'utf8')
  const baseURL = tomlString('providers.NexusAI', 'base_url', source)
  const apiKey = tomlString('providers.NexusAI', 'api_key', source)
  if (baseURL === undefined || apiKey === undefined) throw new Error('NexusAI 配置不完整')
  return { baseURL: baseURL.replace(/\/+$/, ''), apiKey, model: 'claude-opus-4-6' }
}

async function modelReply(config: ChatConfig, system: string, inbound: QqInboundText, toolParameters: unknown): Promise<SendTextArgs> {
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.8,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `渠道 qq\n会话 ${inbound.conversation}\n${inbound.senderName || inbound.senderId}：${inbound.text}\n用 send_text 回到这一个会话。`,
        },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'send_text',
          description: '把文字发到外部渠道。content 里的换行会拆成多条消息。thought 必须非空。',
          parameters: toolParameters,
        },
      }],
      tool_choice: { type: 'function', function: { name: 'send_text' } },
    }),
  })
  if (!response.ok) throw new Error(`模型请求失败 ${response.status}: ${(await response.text()).slice(0, 400)}`)
  const body = await response.json() as {
    choices?: { message?: { content?: string; tool_calls?: { function?: { arguments?: string } }[] } }[]
  }
  const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  const parsed = JSON.parse(call ?? '{}') as Partial<SendTextArgs>
  return {
    channel: 'qq',
    conversation: inbound.conversation,
    content: String(parsed.content ?? ''),
    thought: String(parsed.thought ?? '').trim() || '回这句',
    mood: String(parsed.mood ?? ''),
    decision: String(parsed.decision ?? ''),
    expected_response: String(parsed.expected_response ?? ''),
    ...(inbound.messageId.length > 0 ? { reply_to: inbound.messageId } : {}),
  }
}

const port = Number(process.argv[2] ?? '8097')
const settings = loadElysiumNapcatConfig()
settings.port = port
const chat = loadChatConfig()
const ctx = new Context()
await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
await ctx.plugin(ConsciousMind, { baseDir: PROMPTS, files: FILES })
const tool = defineSendTextTool(ctx.outboundText)
const seen = new Set<string>()
let chain = Promise.resolve()

async function handle(message: QqInboundText): Promise<void> {
  if (message.messageId.length > 0 && seen.has(message.messageId)) return
  if (message.messageId.length > 0) seen.add(message.messageId)
  process.stderr.write(`收到 ${message.conversation} ${message.text}\n`)
  const system = renderPrompt(await ctx.systemPrompt.assemble())
  const sendArgs = await modelReply(chat, system, message, tool.parameters)
  const result: SendTextResult = await ctx.outboundText.sender('qq') === undefined
    ? { sent: [], error: 'qq sender missing' }
    : await tool.execute(sendArgs, { signal: new AbortController().signal } as never)
  process.stderr.write(`回复 ${JSON.stringify(result)}\n`)
}

function enqueue(message: QqInboundText): void {
  chain = chain.then(() => handle(message)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  })
}

const link = new NapcatLink(settings, enqueue)
ctx.outboundText.register('qq', delivery => link.session.sendText(delivery))
await link.start()
process.stderr.write(`新架构在听 127.0.0.1:${port}\n`)
await link.waitForConnection(45_000)
process.stderr.write('NapCat 已连接\n')
const missed = await link.session.latestPrivateText(AYER)
if (missed !== undefined) enqueue(missed)
await new Promise(() => {})
