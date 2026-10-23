# Cookbook：从本检出运行 dsh

[English](running-from-the-checkout.md) | 中文

一份检出可以持有自己的 dsh home，因此在本仓库内运行时所写的会话、凭据、附件或技能不会进入机器级的 `~/.dsh`。该 home 位于 `.dsh/`，其中的 profile 定义进版本控制，协作者克隆后可以启动同一套插件组合。

## 1. 每个克隆安装一次

```sh
pnpm install
pnpm run build:artifacts
```

两者是前置条件，不是启动器会重复执行的步骤。`pnpm install` 链接 366 个工作区包；`build:artifacts` 产出每个包的 `lib/`，缺少它时启动会在第一个导入构建产物的插件上失败。这两棵树都不进版本控制：`node_modules/` 与 `lib/` 留在 Git 之外。

`pnpm run dsh:local --dump-default-config` 打印出组装后的 profile，即表示安装完成。

## 2. 启动

```sh
pnpm run dsh:local                          # `.dsh/profiles/local` profile
pnpm run dsh:local --no-open --port 3081    # Web 应用自行解析其参数
pnpm run dsh:local --profile other          # `.dsh/profiles` 下的任意 profile
pnpm run dsh:local plugin --profile local add <package>
```

`scripts/dsh-local.ts` 把 `DSH_HOME` 设为 `<checkout>/.dsh`、`DSH_AGENTS_HOME` 设为 `<checkout>/.dsh/agents`，然后在子进程里通过 `tsx/esm` 运行 `apps/cli/src/bin.ts`。调用目录仍是会话的默认工作区根。

`DSH_HOME` 不能来自 `.env` 文件：[app-boot](../../packages/boot/app-boot/src/index.ts) 拒绝被发现的环境层里的任何 `DSH_*` 名称，因为随克隆到来的文件不得决定运行时把用户数据放在哪里。启动器是设置它的唯一位置。

## 3. 哪些共享，哪些留在本机

| 路径 | 是否跟踪 | 原因 |
|---|---|---|
| `.dsh/profiles/*/package.json` | 是 | 声明的插件与有序 `bundles` 列表 |
| `.dsh/profiles/*/pnpm-lock.yaml` | 是 | 锁定双方安装的插件精确版本 |
| `.dsh/profiles/*/cordis.patch.yml` | 是 | profile 自己的配置层 |
| `.dsh/profiles/*/cordis.yml` | 是 | 空的根条目列表；启动时会确定性地重写它 |
| `.dsh/profiles/*/node_modules/` | 否 | 由 lockfile 还原 |
| `.dsh/profiles/*/.plugin-manager/` | 否 | 包操作日志 |
| `.dsh/sessions/`、`.dsh/storages/` | 否 | 对话历史与投影缓存 |
| `.dsh/attachments/`、`.dsh/cache/` | 否 | 附件字节与可重建缓存 |
| `.dsh/logs/` | 否 | 启动诊断，可能引用配置值 |
| `.dsh/.credentials.yaml`、`.dsh/.env` | 否 | 凭据 |

忽略规则是一次白名单反转：`.dsh/*` 忽略一层，`!.dsh/profiles/` 重新纳入该目录，随后更窄的规则排除其中的内容。Git 无法重新纳入父目录已被排除的文件，所以模式必须按此顺序书写。

## 4. 克隆之后新增的插件

`dsh plugin add` 把包写入 profile 的 `dependencies`，并追加到 `dsh.profile.bundles`。启动时只有解析结果有意义：检出自身的 bundle（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）从 `apps/cli` 的安装锚点解析，不需要 profile 安装；第三方插件则从 profile 自己的 `node_modules` 解析。

启动器在启动前核对两者。profile 声明了尚未安装的依赖时，会用本检出自带的 pnpm 在 profile 目录内执行一次 `pnpm install`；失败则以 pnpm 的退出码中止启动，而不是让插件静默缺失地起来。启动无法解析的 bundle 会被跳过并打印一行点名该 bundle；启动器只预先处理它能修复的那一类。

```sh
# 拉取了一个新增插件的提交后，这样做就够了：
pnpm run dsh:local
```

## 5. 重置与查看

```sh
pnpm run dsh:local --dump-default-config   # 只看 bundle 层，不含用户层
pnpm run dsh:local --dump-config           # 组装后的完整树，然后退出
```

删除 `.dsh/profiles/local/` 会在下次启动时从内置的 `web` 模板重建。删除整个 `.dsh/` 会连本检出的会话与凭据一起丢弃。
