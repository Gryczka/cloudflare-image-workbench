# Contributing

Thanks for helping improve this Cloudflare Workers reference. Open an issue to discuss larger changes before starting work.

## How To Contribute

1. Fork the repository.
2. Create a focused branch from `main`, such as `fix/…`, `feature/…`, or `docs/…`.
3. Make and test your changes.
4. Open a pull request describing the behavior and verification performed.

## Development Setup

```sh
git clone https://github.com/<your-user>/cloudflare-image-workbench.git
cd cloudflare-image-workbench
npm ci
npm run db:migrate:local
npm run check
```

Use `npm run dev` for local development; [Getting started](README.md#getting-started) covers secrets, Turnstile, and the remote Workers AI binding. Local Images is a low-fidelity implementation, so verify changes to face gravity, effects, text, or encoding on a Worker deployed to your own account, not on the hosted demo.

`npm run check` runs ESLint and Prettier, the Vitest suites in the Workers runtime, `astro check` and the browser-script typecheck, the demo-asset digest and source-marker checks, and a production build. CI runs the same command and also fails when `worker-configuration.d.ts` is stale.

## Code Style

- Prettier formats the repository: two-space indentation, single quotes, semicolons, and a 100-character line width. Run `npm run lint:fix` before committing.
- Keep Worker configuration in `wrangler.jsonc`. After changing bindings or variables, run `npm run cf-typegen` and commit the regenerated `worker-configuration.d.ts`; never edit it by hand.
- Add each schema change as a new numbered file in `migrations/`. Keep semicolons out of SQL comments, because the test helper splits migrations on them.
- The page's source excerpts come from `// showcase:start <name>` and `// showcase:end <name>` markers. Keep each pair intact; `npm run check:sources` verifies them.
- Immutable `public/showcase-*` files carry a SHA-256 prefix in their names. When a file's bytes change, rename it and update its reference (and, for demo sources, its digest and size) in `src/showcases/catalog.ts`.
- Comment non-obvious security, caching, and retention decisions, not self-explanatory statements.

## Commit Messages

Use short, imperative commit subjects that describe the user-visible change, such as `Purge the gallery list after a takedown`.

## Pull Request Process

- Keep each pull request scoped to one concern.
- Include tests for changes to validation, authorization, quotas, caching, retention, or the Workflow.
- Update the README when behavior, setup, limits, or privacy commitments change.
- Run `npm run check` and include the result in the pull request.
- Use only self-made or appropriately licensed images, and record their attribution. Never commit visitor uploads, credentials, account IDs, private hostnames, or deployment-specific resource IDs.

## Bug Reports

Use the [bug report template](../../issues/new?template=bug_report.md). Include the sample or route involved, the response or error, your Wrangler version, relevant configuration with secrets removed, and clear reproduction steps.

## Feature Requests

Use the [feature request template](../../issues/new?template=feature_request.md) and explain which image, delivery, or workflow problem the proposal addresses.

## Code Of Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
