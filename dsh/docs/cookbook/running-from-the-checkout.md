# Cookbook: running dsh from this checkout

English | [中文](running-from-the-checkout.zh.md)

A checkout can keep its own dsh home, so a session, credential, attachment, or skill written while running from this repository never reaches the machine-wide `~/.dsh`. The home lives at `.dsh/` and the profile definition inside it is committed, which lets a collaborator boot the same plugin composition after a clone.

## 1. Install once per clone

```sh
pnpm install
pnpm run build:artifacts
```

Both are prerequisites, not steps the launcher repeats. `pnpm install` links the 366 workspace packages; `build:artifacts` emits each package's `lib/`, without which the boot fails on the first plugin that imports a built artifact. Neither tree is tracked: `node_modules/` and `lib/` stay out of Git.

Setup is complete when `pnpm run dsh:local --dump-default-config` prints the composed profile.

## 2. Boot

```sh
pnpm run dsh:local                          # `.dsh/profiles/local` profile
pnpm run dsh:local --no-open --port 3081    # Web 应用自行解析其参数
pnpm run dsh:local --profile other          # `.dsh/profiles` 下的任意 profile
pnpm run dsh:local plugin --profile local add <package>
```

`scripts/dsh-local.ts` sets `DSH_HOME` to `<checkout>/.dsh` and `DSH_AGENTS_HOME` to `<checkout>/.dsh/agents`, then runs `apps/cli/src/bin.ts` through `tsx/esm` in a child process. The launching directory stays the session's default workspace root.

`DSH_HOME` cannot come from a `.env` file: [app-boot](../../packages/boot/app-boot/src/index.ts) rejects any `DSH_*` name found in a discovered environment layer, because a file arriving with a clone must not decide where the runtime keeps user data. The launcher is the one place that sets it.

## 3. What is shared and what stays local

| Path | Tracked | Why |
|---|---|---|
| `.dsh/profiles/*/package.json` | yes | The declared plugins and the ordered `bundles` list |
| `.dsh/profiles/*/pnpm-lock.yaml` | yes | Pins the exact plugin versions both sides install |
| `.dsh/profiles/*/cordis.patch.yml` | yes | The profile's own configuration layer |
| `.dsh/profiles/*/cordis.yml` | yes | The empty root entry list; the boot rewrites it deterministically |
| `.dsh/profiles/*/node_modules/` | no | Restored from the lockfile |
| `.dsh/profiles/*/.plugin-manager/` | no | Package-operation logs |
| `.dsh/sessions/`, `.dsh/storages/` | no | Conversation history and projection caches |
| `.dsh/attachments/`, `.dsh/cache/` | no | Attachment bytes and rebuildable cache |
| `.dsh/logs/` | no | Startup diagnostics, which can quote configuration values |
| `.dsh/.credentials.yaml`, `.dsh/.env` | no | Credentials |

The ignore rule is a whitelist inversion: `.dsh/*` ignores one level, `!.dsh/profiles/` re-admits the directory, and narrower rules then exclude the content inside it. Git cannot re-admit a file whose parent directory is excluded, so the pattern must be written in this order.

## 4. Plugins added after the clone

`dsh plugin add` writes the package into the profile's `dependencies` and appends it to `dsh.profile.bundles`. Only the resolved name matters at boot: the checkout's own bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`) resolve from `apps/cli`'s installation anchor and need no profile install, while a third-party plugin resolves from the profile's own `node_modules`.

The launcher reconciles the two before booting. A profile that declares dependencies it has not installed triggers one `pnpm install` inside the profile directory using this checkout's own pnpm; a failure stops the boot with the pnpm exit code instead of starting with the plugin silently absent. Bundles the boot cannot resolve are skipped with a line naming the bundle; the launcher only pre-empts the case it can repair.

```sh
# 拉取了一个新增插件的提交后，这样做就够了：
pnpm run dsh:local
```

## 5. Reset or inspect

```sh
pnpm run dsh:local --dump-default-config   # 只看 bundle 层，不含用户层
pnpm run dsh:local --dump-config           # 组装后的完整树，然后退出
```

Deleting `.dsh/profiles/local/` re-creates it from the shipped `web` template on the next boot. Deleting the whole `.dsh/` discards this checkout's sessions and credentials with it.
