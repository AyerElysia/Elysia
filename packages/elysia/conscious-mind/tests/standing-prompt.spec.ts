import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import * as ConsciousMind from '../src/index.ts'
import { STANDING_PROMPT_SECTION } from '../src/index.ts'
import { StandingPromptError, loadStandingPrompt } from '../src/load.ts'

const directories: string[] = []

function directory(): string {
  const path = join(tmpdir(), `elysia-standing-${Date.now()}-${directories.length}`)
  mkdirSync(path)
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

const files = ['SOUL.md', 'USER.md', 'MEMORY.md']

describe('loadStandingPrompt', () => {
  it('joins the listed files in order and skips a missing optional file', () => {
    const base = directory()
    writeFileSync(join(base, 'SOUL.md'), '  soul  \n')
    writeFileSync(join(base, 'MEMORY.md'), 'memory {{kept}}\n')

    expect(loadStandingPrompt(base, files, ['SOUL.md'])).toBe('soul\n\nmemory {{kept}}')
  })

  it('aborts when SOUL.md is missing or empty', () => {
    const missing = directory()
    writeFileSync(join(missing, 'USER.md'), 'user')
    expect(() => loadStandingPrompt(missing, files, ['SOUL.md'])).toThrow(StandingPromptError)

    const empty = directory()
    writeFileSync(join(empty, 'SOUL.md'), ' \n')
    expect(() => loadStandingPrompt(empty, files, ['SOUL.md'])).toThrow(/empty/)
  })

  it('rejects a file name that leaves the directory', () => {
    expect(() => loadStandingPrompt(directory(), ['../SOUL.md'], [])).toThrow(StandingPromptError)
  })
})

describe('elysia-conscious-mind', () => {
  it('replaces the harness identity with the current files, including a later edit', async () => {
    const base = directory()
    writeFileSync(join(base, 'SOUL.md'), 'soul-v1')
    writeFileSync(join(base, 'USER.md'), 'user')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: true, personaPrefix: 'deployment' })
      await ctx.plugin(ConsciousMind, { baseDir: base, files: ['SOUL.md', 'USER.md'] })
      const first = await ctx.systemPrompt.assemble()
      expect(first.sections.map(section => section.name)).toEqual([STANDING_PROMPT_SECTION])
      expect(renderPrompt(first)).toBe('soul-v1\n\nuser')
      expect(renderPrompt(first)).not.toContain('DeepSeek Harness')

      writeFileSync(join(base, 'SOUL.md'), 'soul-v2')
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('soul-v2\n\nuser')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails assembly when the required file disappears', async () => {
    const base = directory()
    writeFileSync(join(base, 'SOUL.md'), 'soul')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
      await ctx.plugin(ConsciousMind, { baseDir: base, files: ['SOUL.md'] })
      rmSync(join(base, 'SOUL.md'))
      await expect(ctx.systemPrompt.assemble()).rejects.toThrow(/missing: SOUL.md/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('joins the configured files into the only system prompt section', async () => {
    const base = directory()
    writeFileSync(join(base, 'SOUL.md'), '# SOUL.md')
    writeFileSync(join(base, 'USER.md'), '# USER.md')
    writeFileSync(join(base, 'MEMORY.md'), '# MEMORY.md')
    writeFileSync(join(base, 'EXISTENCE.md'), '# EXISTENCE.md')
    writeFileSync(join(base, 'TOOLS.md'), '# TOOLS.md')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: true })
      await ctx.plugin(ConsciousMind, {
        baseDir: base,
        files: ['SOUL.md', 'USER.md', 'MEMORY.md', 'EXISTENCE.md', 'TOOLS.md'],
      })
      const rendered = renderPrompt(await ctx.systemPrompt.assemble())
      expect(rendered).toBe('# SOUL.md\n\n# USER.md\n\n# MEMORY.md\n\n# EXISTENCE.md\n\n# TOOLS.md')
      expect(rendered).not.toContain('You are an AI agent powered by DeepSeek Harness.')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses to mount when SOUL.md is not in the file list', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
      await expect(ctx.plugin(ConsciousMind, { baseDir: directory(), files: ['USER.md'] }))
        .rejects.toThrow(/not listed: SOUL.md/)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
