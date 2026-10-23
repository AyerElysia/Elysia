/**
 * Reject a commit that would publish this machine's model setup.
 *
 * The Web UI's config editor writes to the profile patch layer, which is tracked.
 * A provider or a default model chosen in the UI therefore lands in the
 * repository. This check names the offending rows so they move to the ignored
 * home layer instead.
 *
 * Usage: tsx scripts/check-dsh-profile-config.ts
 */

import { readFileSync } from 'node:fs'

/** Profile patch layer that a clone reproduces. */
const PROFILE_PATCH = '.dsh/profiles/local/cordis.patch.yml'

/**
 * Rows that describe one machine's setup rather than the repository's plugin
 * composition. Each belongs in the ignored `.dsh/cordis.patch.yml`.
 */
const MACHINE_LOCAL_ROWS = ['llm-pi-ai', 'agent-default-model']

/**
 * Managed model providers and default-model choices written by the UI.
 * @returns whether any machine-local row appears in the tracked layer.
 */
function main(): void {
  let content: string
  try {
    content = readFileSync(PROFILE_PATCH, 'utf8')
  } catch {
    return
  }
  const found = MACHINE_LOCAL_ROWS.filter(id => new RegExp(`^- id: ${id}$`, 'm').test(content))
  if (found.length === 0) return
  process.stderr.write(
    `check-dsh-profile-config: ${PROFILE_PATCH} contains machine-local rows: ${found.join(', ')}\n`
    + 'Move them to .dsh/cordis.patch.yml, which is ignored (see .dsh/README.md).\n',
  )
  process.exit(1)
}

main()
