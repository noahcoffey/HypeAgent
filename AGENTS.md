# Repository Guidelines

## Project Structure & Module Organization
HypeAgent runs as a pnpm workspace (see `pnpm-workspace.yaml`). Source TypeScript lives in `packages/*/src` for reusable modules and `apps/cli/src` for the CLI entry point. Tests sit beside sources in `test/` folders, and compiled artifacts flow to `dist/`. Pipeline output drafts are written to `updates/`, so keep that directory under version control when reviewing publisher changes. Shared configuration such as `.editorconfig`, `eslint.config.mjs`, and `.nvmrc` apply repo-wide.

## Build, Test, and Development Commands
Run `corepack enable && pnpm install` after cloning. Use `pnpm -r build` to emit TypeScript for every workspace and `pnpm run cli:build` when you need the CLI bundle specifically. `pnpm -r test` executes Vitest across all packages; scope work with `pnpm --filter @hypeagent/core test`. Lint with `pnpm run lint`, check formatting via `pnpm run format:check`, and auto-format using `pnpm run format`. During manual runs, `pnpm run cli:run` executes `apps/cli/dist/index.js`, while `pnpm run cli:watch` loops executions on an interval.

## Coding Style & Naming Conventions
Follow the default TypeScript ESLint recommendations enforced by `pnpm run lint`. Prettier (3.x) handles formatting with 2-space indentation, LF endings, and trimmed trailing whitespace per `.editorconfig`. Prefer explicit exports from each package and retain the `@hypeagent/*` naming scheme for new workspaces. Use kebab-case for file and directory names, and reserve PascalCase for exported classes or React-like components (if introduced).

## Testing Guidelines
Vitest is the unified test runner. Add unit tests alongside code in `test/*.test.ts`, mirroring the module name (e.g., `flags.test.ts` for `flags.ts`). Write deterministic tests—avoid network calls and mock connectors instead. Verify coverage for new features before opening a PR via `pnpm -r test` and include targeted `--filter` runs in the PR notes when helpful.

## Commit & Pull Request Guidelines
Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`), matching the existing history. Keep messages in the imperative and describe the intent, not the implementation. For pull requests, provide a concise summary, reference issues or tasks, and add CLI output or screenshots when behavior changes. Confirm lint and test commands in the PR checklist and mention any new environment variables added to `.env.example`.

## Environment & Secrets
Use Node 20 (`.nvmrc`) to match CI. Copy `.env.example` to `.env` before local runs, and never commit real tokens. The CLI reads configuration at startup, so restart long-running sessions after modifying environment variables.
