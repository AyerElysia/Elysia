/**
 * Text extracted from one KOOK message event.
 * @module @elysia/kook-bot/inbound
 */

import { formatKookConversation, type KookConversation } from './conversation.ts'

/** One inbound KOOK text message. */
export interface KookInboundText {
  channel: 'kook'
  conversation: string
  target: KookConversation
  messageId: string
  senderId: string
  senderName: string
  text: string
}

interface KookEvent {
  channel_type?: string
  type?: number
  content?: string
  msg_id?: string
  author_id?: string
  target_id?: string
  extra?: { author?: { username?: string; bot?: boolean } }
}

/**
 * Map one REST direct-message row onto the gateway PERSON event shape.
 * @param message - one item from `/direct-message/list`.
 * @param userId - the other person in that chat.
 * @returns the event `kookInboundText` already understands.
 */
export function kookDirectMessageEvent(message: Record<string, unknown>, userId: string): KookEvent {
  const author = message.author !== null && typeof message.author === 'object'
    ? message.author as { id?: unknown; username?: unknown; bot?: unknown }
    : {}
  return {
    channel_type: 'PERSON',
    type: Number(message.type ?? 1),
    target_id: userId,
    author_id: String(message.author_id ?? author.id ?? ''),
    content: String(message.content ?? ''),
    msg_id: String(message.id ?? message.msg_id ?? ''),
    extra: { author: { username: author.username === undefined ? undefined : String(author.username), bot: author.bot === true } },
  }
}

/**
 * Keep a user text message. The bot's own messages and non-text events return undefined.
 * @param raw - the `d` object of a KOOK gateway event.
 * @param selfId - this bot's user id.
 * @returns the text, or undefined when this event is not a user text message.
 */
export function kookInboundText(raw: unknown, selfId: string): KookInboundText | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const event = raw as KookEvent
  if (event.type !== 1 && event.type !== 9) return undefined
  if (event.extra?.author?.bot === true) return undefined
  const senderId = String(event.author_id ?? '').trim()
  if (senderId.length === 0 || senderId === selfId) return undefined
  const text = String(event.content ?? '').trim()
  if (text.length === 0) return undefined
  const messageId = String(event.msg_id ?? '').trim()
  if (messageId.length === 0) return undefined
  const target: KookConversation = event.channel_type === 'PERSON'
    ? { kind: 'direct', userId: senderId }
    : { kind: 'channel', channelId: String(event.target_id ?? '').trim() }
  return {
    channel: 'kook',
    conversation: formatKookConversation(target),
    target,
    messageId,
    senderId,
    senderName: event.extra?.author?.username?.trim() || senderId,
    text,
  }
}
