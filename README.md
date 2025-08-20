# HypeAgent

[![CI](https://github.com/noahcoffey/HypeAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/noahcoffey/HypeAgent/actions/workflows/ci.yml)

Minimal, extensible pipeline to pull facts from connectors (e.g. GitHub), persist project state, and optionally publish update drafts.

## Packages

- `packages/core`: domain models, config loader, filesystem storage, and pipeline orchestrator (`runOnce`).
- `packages/github`: GitHub connector scaffold using Octokit.
- `packages/publisher-fs`: filesystem publisher writing `UpdateDraft` markdown to disk.
- `packages/publisher-ghpages`: GitHub Pages publisher committing updates directly to the `gh-pages` branch.
- `apps/cli`: simple CLI to run a single pipeline pass.

## Quickstart

Prereqs: Node 20 (see `.nvmrc`). If you have Node 23 locally, run `nvm use` or update `.nvmrc` to your preferred version (ensure CI matches).

```bash
corepack enable
pnpm install
pnpm -r build
pnpm run lint
pnpm -r test
```

## Scripts

Root scripts:

- `pnpm run lint` — ESLint across the repo
- `pnpm -r build` — TypeScript build for all workspaces
- `pnpm -r test` — Vitest across workspaces
- `pnpm run cli:build` — build all, including the CLI
- `pnpm run cli:run` — run the CLI entrypoint

## Configuration

Core reads environment via `loadEnvConfig()` with validation, and the CLI reads additional envs:

- `TIMEZONE` (default: `UTC`) — must be a valid IANA timezone
- `PUBLISHER` (default: `fs`) — select how updates are published
  - `fs`: write markdown drafts to disk via `@hypeagent/publisher-fs`
  - `gh-pages`: publish directly to the `gh-pages` branch via GitHub API (no PRs)
  - `none`: disable publishing (facts still pulled and state persisted)
- `STATE_FILE` (optional) — path to persist state (default: `.hypeagent/state.json`)
- `PUBLISH_OUT_DIR` (optional) — output directory for filesystem publisher (default: `updates/`)
- `PUBLISH_BASE_URL` (optional) — base URL used to return a public URL to the published file
- `PUBLISH_ONLY_SUMMARY` (optional) — when `true`, skip publishing the full update and only publish the AI-generated summary (also implies `PUBLISH_AI_SUMMARY=true` unless explicitly overridden)
- `GITHUB_TOKEN` (optional) — token for GitHub API calls (required if using the GitHub connector)
- GitHub Pages publisher env (when `PUBLISHER=gh-pages`):
  - `GHPAGES_OWNER` — repo owner (user or org)
  - `GHPAGES_REPO` — repo name
  - `GHPAGES_BRANCH` (default: `gh-pages`) — branch to publish to
  - `GHPAGES_TOKEN` — GitHub token, or omit to fall back to `GITHUB_TOKEN`
  - `PUBLISH_OUT_DIR` — path inside the branch to place files (default: `updates/`)
- `GITHUB_REPOS` (optional) — comma-separated list for the GitHub connector. Supports optional branch suffix per repo:
  - Examples: `owner/repo`, `owner/repo@main`, `owner1/repo1,owner2/repo2@release`
- `OPENAI_API_KEY` (optional) — when set, the CLI will generate a concise AI summary of each update
- `AI_SUMMARY_MODEL` (optional) — defaults to `gpt-4o-mini`
- `PUBLISH_AI_SUMMARY` (optional) — when `true`, writes a separate markdown file with the AI summary next to the main update; automatically enabled when `PUBLISH_ONLY_SUMMARY=true`
- `AI_SUMMARY_PROMPT` (optional) — custom system prompt to control tone/style of the AI summary
- `AI_INCLUDE_BODIES` (optional) — when not `false`, the CLI fetches Issue/PR bodies and full commit messages to enrich the AI context (default: `true`)
- `AI_MAX_COMMENTS` (optional) — number of recent Issue/PR comments to include in AI context (default: `3`)
- `AI_MAX_CONTEXT_CHARS` (optional) — max characters of each Issue/PR/Commit body included in AI context (default: `2000`)

Example `.env`:

```
TIMEZONE=UTC
PUBLISHER=fs
STATE_FILE=.hypeagent/state.json
PUBLISH_OUT_DIR=updates
# Optional when serving files publicly (e.g., GitHub Pages, a web server):
# PUBLISH_BASE_URL=https://example.com/updates

# Enable GitHub connector
GITHUB_TOKEN=ghp_...
# Filter commits to a branch by suffixing with @branch (applies to commit pulls only)
GITHUB_REPOS=noahcoffey/hypeagent@main
```

## CLI usage

Build and run a pipeline pass. If `GITHUB_TOKEN` and `GITHUB_REPOS` are set, the GitHub connector will pull updated issues/PRs since the last run and convert them to facts. The filesystem publisher writes a markdown Update draft each run.

```bash
pnpm run cli:build
pnpm run cli:run
```

By default, state persists to `.hypeagent/state.json` and the selected publisher writes to `updates/`. Customize with env vars above.

### AI summarization (optional)

If `OPENAI_API_KEY` is set, the CLI will send the newly generated update content to the OpenAI API to produce a concise, social-media-ready summary (1–3 sentences). You can override the model via `AI_SUMMARY_MODEL` (default: `gpt-4o-mini`). Customize the system prompt with `AI_SUMMARY_PROMPT`.

For better summaries, the CLI includes a brief markdown list of new facts and, when enabled, a Details section composed from Issue/PR bodies, recent comments, and full commit messages. Control this with:

- `AI_INCLUDE_BODIES` — include Issue/PR/Commit bodies (`true` by default)
- `AI_MAX_COMMENTS` — include up to N recent comments per Issue/PR
- `AI_MAX_CONTEXT_CHARS` — truncate long bodies to this length

If you set `PUBLISH_AI_SUMMARY=true`, the summary is saved as a separate markdown file alongside the main update (with an id suffix `-summary`). If `PUBLISH_ONLY_SUMMARY=true`, only this summary post is published and the full update is skipped. The model response is expected to be strict minified JSON like `{ "title": "...", "summary": "..." }`; the CLI parses these and publishes a clean summary without extra headers. The CLI output also includes the `aiSummary` text and the published URL (when `PUBLISH_BASE_URL` is configured).

When using `PUBLISHER=gh-pages`, the generated site includes a minimal Jekyll scaffold. The homepage `index.md` renders only summary posts (identified via frontmatter `ha_kind: summary`) in reverse chronological order, with simple readable styling.

## Publishing to GitHub Pages (PUBLISHER=gh-pages)

This publisher commits update markdown files directly to your repository's `gh-pages` branch, and bootstraps a minimal Jekyll site to render them.

### Setup

- Create (or let the publisher create) the `gh-pages` branch in your repository.
- In your repo settings, enable GitHub Pages to serve from the `gh-pages` branch.
- Optionally configure a custom domain; otherwise your site will be hosted at:
  - Project Pages: `https://<owner>.github.io/<repo>/`
  - User/Org Pages (special repo `<owner>.github.io`): `https://<owner>.github.io/`

### Required environment

- `PUBLISHER=gh-pages`
- `GHPAGES_OWNER` — repository owner (user/org)
- `GHPAGES_REPO` — repository name
- `GHPAGES_BRANCH` — branch to publish to (default `gh-pages`)
- `GHPAGES_TOKEN` — token used for API writes; falls back to `GITHUB_TOKEN` if omitted

Optional:

- `PUBLISH_BASE_URL` — override the public base URL used for returned links. Useful for custom domains.
  - Example (project pages): `https://<owner>.github.io/<repo>/updates`
  - Example (custom domain): `https://example.com/updates`
- `PUBLISH_ONLY_SUMMARY=true` — only publish the AI-generated summary (no full update). Implicitly enables `PUBLISH_AI_SUMMARY=true` unless you override it.

### What gets generated

- Collection files under `_${PUBLISH_OUT_DIR}/` (default `_updates/`) with YAML front matter (including `ha_kind`, timestamps, permalink) and a body segment wrapped by markers `<!--HA-START--> ... <!--HA-END-->`.
- `index.md` styled page that lists only summary posts, newest first. It derives each card title from front matter (preferring `ha_title`/`title`) or falls back to the first H1.

### Troubleshooting

- Title shows a slug or body shows a duplicate H1
  - Ensure there's a blank line after the closing front matter (`---`) before content.
  - The publisher now emits this blank line automatically; republish if older files exist.
- Links are missing base path
  - Set `PUBLISH_BASE_URL` to match your Pages site if you're hosting under a custom domain.
- Pages not updating after a push
  - GitHub Pages may take 1–2 minutes to rebuild. Hard refresh the site.

### Example workflow (scheduled and manual)

See `.github/workflows/publish.yml` for a complete example. It runs the CLI on a schedule and uses `PUBLISHER=gh-pages` to push updates directly to the `gh-pages` branch.

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on pushes/PRs:

- install deps
- lint
- build
- test

## Development notes

- Strong typing with Zod runtime validation in `packages/core`.
- Models and schemas live in `packages/core/src/models.ts`.
- Pipeline orchestrator in `packages/core/src/pipeline.ts` (`runOnce`).
- File-based persistence: `FileSystemStorage` in `packages/core/src/storage.ts`.
