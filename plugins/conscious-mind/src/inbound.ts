/**
 * One inbound text, whatever channel it came from.
 * @module @elysia/conscious-mind/inbound
 */

/** A text message waiting to be answered. */
export interface InboundText {
  /** send_text channel name, such as `qq` or `feishu`. */
  channel: string
  /** Window id. The reply copies this into `conversation`. */
  conversation: string
  /** Platform message id. Empty when the channel has none. */
  messageId: string
  /** Sender id on that channel. */
  senderId: string
  /** Sender display name. Empty when the channel omitted it. */
  senderName: string
  /** Plain text. */
  text: string
}
