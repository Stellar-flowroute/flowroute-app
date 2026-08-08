# Contributing

## Workspace setup

This is a pnpm workspace with three packages: `packages/sdk`, `apps/web`, and `indexer`. See the [README](README.md#quick-start) for full setup, including environment files and Postgres.

Install dependencies from the repo root, not from individual packages:

```
pnpm install
```

## Git workflow

- Never `git add .` or `git add -A`. Stage files by name so unrelated or sensitive files can't slip into a commit.
- One commit per logical unit of work. Don't bundle unrelated changes into a single commit.
- Use conventional commit format: `type(scope): summary`, for example `fix(sdk): handle empty recipient list` or `docs(web): document env vars`. Common types are `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.
- Push your branch promptly after committing rather than accumulating unpushed local commits.
- Do not amend or force-push commits that have already been pushed, unless you are the only one working on that branch and you say so explicitly in the PR.

## Running checks

Run these across all three packages from the repo root before opening a PR:

```
pnpm -r typecheck
pnpm -r lint
pnpm -r build
```

To run a package's tests individually:

```
pnpm --filter @stellar-flowroute/sdk test
pnpm --filter @stellar-flowroute/indexer test
```

The CI workflow (`.github/workflows/ci.yml`) runs install, typecheck, lint, and build on every push and pull request to `main`. A PR should not be opened with any of these failing locally.

## Opening a pull request

1. Branch off `main`.
2. Keep the PR scoped to one logical change; open separate PRs for unrelated work.
3. Make sure `pnpm -r typecheck`, `pnpm -r lint`, and `pnpm -r build` all pass locally.
4. Write a PR description that explains why the change is needed, not just what changed.
5. Link any related issue.
