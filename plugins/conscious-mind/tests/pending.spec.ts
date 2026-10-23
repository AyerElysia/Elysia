import { describe, expect, it } from 'vitest'
import { takeConversationBatch } from '../src/pending.ts'

describe('pending conversation batch', () => {
  it('drains one conversation and leaves the other queued', () => {
    const taken = takeConversationBatch([
      { conversation: 'qq:private:1', text: '第一句' },
      { conversation: 'feishu:private:ou_a', text: '飞书' },
      { conversation: 'qq:private:1', text: '第二句' },
    ])
    expect(taken.batch.map(item => item.text)).toEqual(['第一句', '第二句'])
    expect(taken.rest.map(item => item.text)).toEqual(['飞书'])
  })
})
