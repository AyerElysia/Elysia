/**
 * Channel-agnostic text delivery. Channel plugins register a sender; send_text
 * looks one up by name and never speaks a platform protocol itself.
 * @module @elysia/conscious-mind/outbound
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** One segment handed to a channel plugin. */
export interface OutboundDelivery {
  /** Conversation identifier, interpreted by that channel plugin. */
  conversation: string
  /** One already-split message body. */
  text: string
  /** Quote target. Present only on the first segment of a call. */
  replyTo?: string
}

/** Receipt from a channel plugin after it accepted a segment. */
export interface OutboundReceipt {
  /** Platform message id, when the channel returned one. */
  messageId?: string
}

/** Send one segment. Throw {@link OutboundDeliveryUnknown} when delivery cannot be confirmed. */
export type OutboundSend = (delivery: OutboundDelivery) => Promise<OutboundReceipt>

/** The platform accepted the attempt but could not confirm it landed. Do not retry. */
export class OutboundDeliveryUnknown extends Error {
  constructor() {
    super('投递状态未知')
    this.name = 'OutboundDeliveryUnknown'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    outboundText: OutboundText
  }
}

/**
 * Registry of channel senders. A missing channel is a failed call, not a
 * fallback onto another platform.
 */
export class OutboundText extends Service {
  private readonly senders = new Map<string, OutboundSend>()

  constructor(ctx: Context) {
    super(ctx, 'outboundText')
  }

  /**
   * Register the sender for one channel name.
   * @param channel - channel name, matched exactly after trim.
   * @param send - delivers one segment on that channel.
   * @returns a disposer that removes this registration.
   */
  register(channel: string, send: OutboundSend): () => void {
    const name = channel.trim()
    if (name.length === 0) throw new Error('outbound channel name is empty')
    if (this.senders.has(name)) throw new Error(`outbound channel already registered: ${name}`)
    this.senders.set(name, send)
    return () => {
      if (this.senders.get(name) === send) this.senders.delete(name)
    }
  }

  /**
   * Look up a registered sender.
   * @param channel - channel name from a send_text call.
   * @returns the sender, or undefined when that channel is not mounted.
   */
  sender(channel: string): OutboundSend | undefined {
    return this.senders.get(channel.trim())
  }
}
