# Elysia-Harness

Elysia's harness work: a vendored [DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH) checkout, the plugins she runs on it, and one harness home per surface.

## Layout

```text
dsh/        DSH 0.2.1-rc.2, unmodified. A plain folder, not a submodule.
plugins/    Five packages: a conscious mind, text delivery, four channels, a
            request archive. Each mounts as a bundle and unmounts on its own.
homes/      Two harness homes. web/ and tui/ mount different bundles and keep
            separate session histories; both read model providers from shared/.
```

`dsh/` is a dependency, not the subject. Keeping the source in one folder means an
upstream update is a directory replacement instead of a rebase against thousands
of files, and means this repository's own tree stays readable.

## Surfaces

The web and terminal surfaces are separate processes with separate homes. A
surface picks its bundle list from the profile under its home:

```sh
homes/web/profiles/web/package.json   # dsh-base + dsh-web-app + the plugins
homes/tui/profiles/tui/package.json   # dsh-base + dsh-tui    + the plugins
```

Model providers live in `homes/shared/models.patch.yml` and apply to both.

## Getting started

```sh
cd dsh && pnpm install && pnpm run build:artifacts && cd ..

# Web surface
DSH_HOME="$PWD/homes/web" dsh/... --profile web

# Terminal surface
DSH_HOME="$PWD/homes/tui" dsh/... --profile tui
```

## License and attribution

`dsh/` is MIT-licensed, copyright DeepSeek. The license text is at
`dsh/LICENSE`, third-party attributions at `dsh/THIRD_PARTY_NOTICES.md`.

This project is built on DeepSeek-Harness. It is not produced, endorsed, or
supported by DeepSeek. DeepSeek-Harness is a trademark of DeepSeek; the name
`Elysia-Harness` is this project's own and carries no such claim.

Practices that apply inside `dsh/` come from upstream and are documented in
`dsh/AGENTS.md`.
