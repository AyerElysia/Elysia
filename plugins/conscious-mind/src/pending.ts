/**
 * Pending inbound messages for the conscious mind.
 *
 * Messages wait here instead of each starting a reply. One turn drains every
 * waiting message in the same conversation.
 * @module @elysia/conscious-mind/pending
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { InboundText } from './inbound.ts'

/** How long to keep collecting after the first message of a quiet period. */
export const COLLECT_MS = 1200

/** Split off the first conversation's messages, preserving arrival order. */
export function takeConversationBatch<T extends { conversation: string }>(pending: readonly T[]): { batch: T[], rest: T[] } {
  const conversation = pending[0]?.conversation
  if (conversation === undefined) return { batch: [], rest: [] }
  return {
    batch: pending.filter(item => item.conversation === conversation),
    rest: pending.filter(item => item.conversation !== conversation),
  }
}

/** Replies to one drained batch. Channels do not call this. */
export type PendingTurn = (batch: readonly InboundText[]) => Promise<void>

declare module '@deepseek-ai/cordis' {
  interface Context {
    inboundPending: InboundPending
  }
}

/**
 * The conscious mind's pending list. Every channel receives into this one queue.
 */
export class InboundPending extends Service {
  private readonly items: InboundText[] = []
  private readonly seen = new Set<string>()
  private wakeup: (() => void) | undefined
  private turn: PendingTurn | undefined
  private stopped = false

  constructor(ctx: Context) {
    super(ctx, 'inboundPending')
    void this.loop()
  }

  /**
   * Queue one inbound text. A duplicate message id on the same channel is ignored.
   * @param message - text from any registered channel.
   */
  receive(message: InboundText): void {
    const key = `${message.channel}\0${message.messageId}`
    if (message.messageId.length > 0 && this.seen.has(key)) return
    if (message.messageId.length > 0) this.seen.add(key)
    this.items.push(message)
    process.stderr.write(`pending ${this.items.length} ${message.channel} ${message.conversation} ${message.text}\n`)
    this.wake()
  }

  /**
   * Install the single reply used for every channel.
   * @param turn - answers one drained batch, usually through send_text.
   */
  replyWith(turn: PendingTurn): void {
    this.turn = turn
    this.wake()
  }

  /** Stop the collect loop. */
  stop(): void {
    this.stopped = true
    this.wake()
  }

  private wake(): void {
    const wakeup = this.wakeup
    this.wakeup = undefined
    wakeup?.()
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      if (this.items.length === 0 || this.turn === undefined) {
        await new Promise<void>(resolve => {
          this.wakeup = resolve
          if (this.items.length > 0 && this.turn !== undefined) this.wake()
        })
        if (this.stopped) return
      }
      await new Promise(resolve => setTimeout(resolve, COLLECT_MS))
      if (this.stopped || this.turn === undefined) continue
      const taken = takeConversationBatch(this.items)
      this.items.splice(0, this.items.length, ...taken.rest)
      if (taken.batch.length === 0) continue
      process.stderr.write(`取出 ${taken.batch.length} 条 ${taken.batch[0]?.channel} ${taken.batch[0]?.conversation} ${taken.batch.map(message => message.text).join(' / ')}\n`)
      try {
        await this.turn(taken.batch)
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
  }
}
