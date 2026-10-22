/**
 * KOOK channel plugin. It reads Elysium's bot config, registers the `kook`
 * sender used by send_text, and can hold the gateway socket.
 * @module @elysia/kook-bot
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '../../conscious-mind/src/outbound.ts'
import { KookClient } from './client.ts'
import { loadElysiumKookConfig } from './config.ts'
import { KookGateway } from './gateway.ts'
import type { KookInboundText } from './inbound.ts'

export { formatKookConversation, parseKookConversation } from './conversation.ts'
export type { KookConversation } from './conversation.ts'
export { kookDirectMessageEvent, kookInboundText } from './inbound.ts'
export type { KookInboundText } from './inbound.ts'
export { ELYSIUM_KOOK_CONFIG, KOOK_API_BASE, loadElysiumKookConfig, parseElysiumKookConfig } from './config.ts'
export type { KookSettings } from './config.ts'
export { KookClient } from './client.ts'
export type { KookDirectChat } from './client.ts'
export { KookGateway } from './gateway.ts'
export { handleKookFrame } from './frame.ts'

/** Cordis plugin name. */
export const name = 'kook-bot'

/** The outbound registry send_text already uses. */
export const inject = ['outboundText']

/** Optional path override. The bot token still comes from that file. */
export interface Config {
  /** Path to Elysium's kook_adapter config.toml. */
  configPath?: string
  /** Open the gateway. The same token can keep only one. */
  listen?: boolean
}

/** Runtime schema. */
export const Config: z<Config> = z.object({
  configPath: z.string().default(''),
  listen: z.boolean().default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A text message arrived from KOOK. */
    'kook/message'(message: KookInboundText): void
  }
}

/**
 * Register the kook sender from Elysium's config.
 * @param ctx - context that already provides outboundText.
 * @param config - optional path override and whether to open the socket.
 */
export function apply(ctx: Context, config: Config): void {
  const settings = loadElysiumKookConfig(config.configPath === '' ? undefined : config.configPath)
  const client = new KookClient(settings)
  const gateway = new KookGateway(client, message => { ctx.emit('kook/message', message) })
  ctx.effect(() => ctx.outboundText.register('kook', delivery => client.sendText(delivery)))
  if (config.listen) {
    ctx.effect(() => {
      void gateway.start().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger('kook-bot').error(`KOOK Gateway 失败: ${message}`)
      })
      return () => { gateway.stop() }
    })
  }
}
