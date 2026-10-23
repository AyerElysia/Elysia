/**
 * Register a plugin-provided companion skin before the TUI draws its first frame.
 *
 * ## Why this runs before `runProfile`
 *
 * `dsh --profile <name>` executes this package's `bin.ts`, not dsh-tui's
 * `bin/dsh-tui.js`, so dsh-tui never gets the chance to pre-register anything.
 * The profile's plugins do load — but only after the boot sequence starts, and
 * the terminal surface reads its companion skin during the very first render.
 *
 * Those two facts leave a gap: `companionSkinStore` still holds its default,
 * `COMPANION_SKIN_IDS` has only the three built-in entries, and the `skins`
 * map has no plugin skin in it. The first frame therefore draws the built-in
 * whale and swaps to the configured skin once `apply()` has run — visible as a
 * flash of the wrong mascot on every start.
 *
 * This module closes that gap at the earliest point the CLI controls.
 *
 * ## Why it constructs the skin instead of calling the plugin's `apply()`
 *
 * The plugin locates its host package by walking up from `process.argv[1]`
 * (`resolveHostRoot()`). From here that walk lands on a different copy of
 * dsh-tui than the one the TUI will render with, so importing the plugin would
 * produce a second `skins.js` and a second `tuiDisplayPrefs.js` — the
 * registration would write into a map nobody reads.
 *
 * Importing the host's own modules by absolute path from the profile's
 * `node_modules` avoids that: this module and the renderer end up holding the
 * same module instances. The plugin still supplies the skin itself
 * (`createSkin`), with host dependencies injected explicitly.
 *
 * ## Failure behaviour
 *
 * Every step is best-effort. A profile with no plugin skin, a malformed
 * configuration, or a plugin that fails to load leaves the built-in skins in
 * place and lets the boot continue — the pre-registration is a fix for a
 * cosmetic flash, never a reason to refuse to start.
 *
 * @module @deepseek-ai/dsh/pet-preregister
 */

import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** The subset of dsh-tui's display-preference module this file touches. */
interface HostPrefs {
  readonly COMPANION_SKIN_IDS: string[]
  applyCompanionSkin: (id: string) => unknown
}

/** Bundles that are the harness itself rather than skin providers. */
const NON_PLUGIN_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'])

/**
 * Read the `companion.skin` value out of a profile's patch layer.
 *
 * Deliberately a line scan rather than a YAML parse: this runs before the
 * loader, and pulling in the YAML stack here would be a second implementation
 * of the same file's semantics. Only the `dsh-tui` row's `companion.skin` is
 * of interest, and the profile layer is a flat array of id-targeted rows.
 *
 * @param patchFile - Absolute path to the profile's `cordis.patch.yml`.
 * @returns The requested skin id, or undefined when the row or key is absent.
 */
function readRequestedSkin(patchFile: string): string | undefined {
  let text: string
  try {
    text = readFileSync(patchFile, 'utf8')
  } catch {
    return undefined
  }

  let inTuiRow = false
  let inCompanion = false
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '').replace(/\s+$/u, '')
    if (line.trim() === '')
      continue
    const indent = line.length - line.trimStart().length

    if (indent === 0 && /^-\s+id:/u.test(line)) {
      inTuiRow = /^-\s+id:\s*dsh-tui\s*$/u.test(line)
      inCompanion = false
      continue
    }
    if (!inTuiRow)
      continue
    if (indent > 0 && /^\s+companion:\s*$/u.test(line)) {
      inCompanion = true
      continue
    }
    if (!inCompanion)
      continue

    const skin = /^\s+skin:\s*(\S+)\s*$/u.exec(line)
    if (skin?.[1] !== undefined)
      return skin[1].replace(/^['"]|['"]$/gu, '')
    if (/^\s+\w+:\s*$/u.test(line))
      inCompanion = false
  }
  return undefined
}

/**
 * Read a profile's declared bundle list.
 * @param profileDir - Absolute path to the profile directory.
 * @returns Bundle names, or an empty list when the manifest is unreadable.
 */
function readBundles(profileDir: string): readonly string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles : []
  }
  catch {
    return []
  }
}

/**
 * Make a configured plugin skin available to the TUI before it renders.
 *
 * @param profile - Profile name the CLI is booting.
 */
export async function preRegisterCompanionSkin(profile: string): Promise<void> {
  const home = process.env.DSH_HOME ?? resolveDshHome()
  const profileDir = join(home, 'profiles', profile)
  const tuiDir = join(profileDir, 'node_modules', '@deepseek-harness-tui', 'dsh-tui')
  const typesDir = join(tuiDir, 'lib', 'types')

  const wanted = readRequestedSkin(join(profileDir, 'cordis.patch.yml'))
  if (wanted === undefined)
    return

  let prefs
  try {
    prefs = await import(pathToFileURL(join(typesDir, 'tuiDisplayPrefs.js')).href) as HostPrefs
  }
  catch {
    return
  }

  // A built-in skin needs no registration; just make it the active one.
  if (prefs.COMPANION_SKIN_IDS.includes(wanted)) {
    prefs.applyCompanionSkin(wanted)
    return
  }

  for (const name of readBundles(profileDir)) {
    if (NON_PLUGIN_BUNDLES.has(name) || prefs.COMPANION_SKIN_IDS.includes(wanted))
      continue

    try {
      let packageDir = join(profileDir, 'node_modules', name)
      try {
        packageDir = realpathSync(packageDir)
      }
      catch {
        // Keep the unresolved path: the imports below report the real problem.
      }

      const skinModule = await import(pathToFileURL(join(packageDir, 'lib', 'skin.js')).href)
        .catch(() => undefined)
      if (typeof skinModule?.createSkin !== 'function')
        continue

      const configModule = await import(pathToFileURL(join(packageDir, 'lib', 'config.js')).href)
      const config = configModule.resolveConfig({})
      if (config.skinId !== wanted)
        continue

      const animations = await import(pathToFileURL(join(packageDir, 'lib', 'animations.js')).href)
      const frames = await import(pathToFileURL(join(packageDir, 'lib', 'frames.js')).href)
      const register = await import(pathToFileURL(join(packageDir, 'lib', 'register.js')).href)
      const kit = frames.loadKit()
      if (kit === undefined)
        continue

      // React must come from the host's own resolution chain: the plugin's
      // physical path need not sit on it.
      const hostRequire = createRequire(pathToFileURL(join(tuiDir, 'package.json')))
      const React = hostRequire('react')

      const [skins, whale, ui, imageHooks, sidePanelContext] = await Promise.all([
        import(pathToFileURL(join(typesDir, 'components', 'sidePanel', 'companion', 'skins.js')).href),
        import(pathToFileURL(join(typesDir, 'components', 'Whale.js')).href),
        import(pathToFileURL(join(typesDir, 'ui.js')).href),
        import(pathToFileURL(join(typesDir, 'ink', 'hooks', 'use-terminal-images.js')).href),
        import(pathToFileURL(join(typesDir, 'components', 'sidePanel', 'SidePanelRuntimeContext.js')).href),
      ])

      skinModule.setHostDeps({
        Box: ui.Box,
        Text: ui.Text,
        Image: ui.Image,
        renderSpriteRows: whale.renderSpriteRows,
        useTerminalImages: imageHooks.useTerminalImages,
        useTerminalImageProtocol: imageHooks.useTerminalImageProtocol,
        useSidePanelChannel: sidePanelContext.useSidePanelChannel,
      })

      const resolver = animations.createResolver(kit.animations, config)
      const skin = skinModule.createSkin({ React, kit, resolver, config })
      skins.registerCompanionSkin(skin)
      register.appendSkinId({ COMPANION_SKIN_IDS: prefs.COMPANION_SKIN_IDS }, wanted)
      break
    }
    catch {
      // A bundle that cannot supply this skin is not an error: try the next one.
    }
  }

  prefs.applyCompanionSkin(wanted)
}
