/**
 * Boot this checkout's dsh against a harness home inside the repository, after
 * making sure every package the profile declares is actually installed.
 *
 * `DSH_HOME` is bootstrap-only: app-boot refuses to let a discovered `.env` set a
 * `DSH_*` name, so the home cannot live in a file the repository carries. This
 * launcher is the single place that sets it, which keeps every session,
 * credential, attachment and skill root under `.dsh/` in the checkout instead of
 * the machine-wide `~/.dsh`.
 *
 * Composed profile bundles live in the checkout, so they need no install. Only
 * plugins added with `dsh plugin add` do, and their absence is otherwise silent:
 * the boot skips an unresolvable bundle and says nothing useful. Reconciling here
 * turns that into either an automatic install or an explicit failure.
 *
 * Usage: pnpm run dsh:local [launcher flags] [app args...]
 *   pnpm run dsh:local                        boot the `.dsh/profiles/local` profile
 *   pnpm run dsh:local --no-open --port 3081  forward the Web app's own flags
 *   pnpm run dsh:local --profile other        boot any profile under `.dsh/profiles`
 *   pnpm run dsh:local plugin --profile local add <pkg>
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute checkout root: this file lives one level below it. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Harness home for every launch from this checkout. */
const HOME = join(ROOT, '.dsh')

/** Profile booted when the arguments name none. */
const PROFILE = 'local'

/** Shipped template the default profile is initialized from. */
const TEMPLATE = 'web'

/** The checkout's own pnpm, so a profile install matches the lockfile this repository pins. */
const PNPM = join(ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

/**
 * Write one diagnostic line to stderr, the channel the boot's own reports use.
 * @param line - the message to print.
 */
function report(line: string): void {
  process.stderr.write(`dsh:local: ${line}\n`)
}

/**
 * Run the checkout's CLI in a child process, forwarding stdio and the exit status.
 * @param args - launcher flags followed by the booted app's own arguments.
 * @returns the child's exit code.
 */
function runCli(args: string[]): Promise<number> {
  return run(process.execPath, ['--import', 'tsx/esm', join(ROOT, 'apps', 'cli', 'src', 'bin.ts'), ...args])
}

/**
 * Run one child process to completion with inherited stdio.
 * @param command - executable to start.
 * @param args - its arguments.
 * @param options - extra spawn options, such as a working directory.
 * @returns the child's exit code.
 */
function run(command: string, args: string[], options: { cwd?: string } = {}): Promise<number> {
  const child = spawn(command, args, {
    // The invoking directory stays the session's default workspace root.
    cwd: options.cwd ?? process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: HOME, DSH_AGENTS_HOME: join(HOME, 'agents') },
  })
  return new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal === null) {
        resolve(code ?? 1)
        return
      }
      // Re-raise the signal on this process so a shell sees the same termination.
      process.kill(process.pid, signal)
      resolve(0)
    })
  })
}

/**
 * Read the dependency names a profile declares.
 * @param profileDir - the profile directory.
 * @returns declared names, or an empty list when the manifest declares none.
 */
function declaredDependencies(profileDir: string): string[] {
  const manifest = readFileSync(join(profileDir, 'package.json'), 'utf8')
  const parsed: unknown = JSON.parse(manifest)
  if (typeof parsed !== 'object' || parsed === null || !('dependencies' in parsed)) return []
  const { dependencies } = parsed
  return typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : []
}

/**
 * Dependency names the profile declares but has not installed.
 * @param profileDir - the profile directory.
 * @returns the missing names, empty when every declared package is present.
 */
function missingDependencies(profileDir: string): string[] {
  return declaredDependencies(profileDir)
    .filter(name => !existsSync(join(profileDir, 'node_modules', name, 'package.json')))
}

/**
 * Install the profile's declared dependencies.
 * @param profileDir - the profile directory pnpm manages.
 * @returns the pnpm exit code.
 */
async function installProfile(profileDir: string): Promise<number> {
  if (!existsSync(PNPM)) {
    report(`cannot install ${profileDir}: ${PNPM} is missing; run 'pnpm install' in the checkout first`)
    return 1
  }
  report(`installing declared plugins in ${profileDir}`)
  const code = await run(process.execPath, [PNPM, 'install'], { cwd: profileDir })
  if (code !== 0) report(`pnpm install failed in ${profileDir} (exit ${code})`)
  return code
}

/**
 * Prepare one profile: initialize it from the shipped template when absent, then
 * reconcile its declared plugins with what is installed.
 * @param name - the profile name under `.dsh/profiles`.
 * @returns the profile directory, or undefined when preparation failed.
 */
async function prepareProfile(name: string): Promise<string | undefined> {
  const profileDir = join(HOME, 'profiles', name)
  // --dump-config writes the manifest without binding a port or mounting the tree.
  if (!existsSync(join(profileDir, 'package.json'))) {
    const priming = await runCli(['--profile', name, '--from-default-profile', TEMPLATE, '--dump-config'])
    if (priming !== 0) return undefined
  }
  const missing = missingDependencies(profileDir)
  if (missing.length > 0) {
    report(`profile ${name} declares ${missing.length} uninstalled plugin(s): ${missing.join(', ')}`)
    if (await installProfile(profileDir) !== 0) return undefined
  }
  return profileDir
}

const raw = process.argv.slice(2)

// `plugin` is its own launcher subcommand and manages package state itself;
// an explicit --profile is already the caller's choice of target.
const explicit = raw[0] === 'plugin' || raw.includes('--profile')
const index = raw.indexOf('--profile')
const program = explicit && index >= 0 ? raw[index + 1] : PROFILE

// Config dumps never mount a tree, so they must not trigger an install.
const dumps = raw.some(arg => arg === '--dump-config' || arg === '--dump-config-schema' || arg === '--dump-default-config')

if (raw[0] !== 'plugin' && !dumps && program !== undefined) {
  const prepared = await prepareProfile(program)
  if (prepared === undefined) process.exit(1)
}

process.exit(await runCli(explicit ? raw : ['--profile', PROFILE, ...raw]))
