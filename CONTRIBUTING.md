# Contributing

Thanks for looking. A few things that make a change easy to accept.

## Setup

```sh
pnpm install
pnpm dev
```

Node 20 or newer, pnpm 9.

## Before you open a pull request

```sh
pnpm check     # prettier, strict TypeScript, ESLint
pnpm build     # the production build must succeed
```

## How changes land

This repository is a mirror of the app's source, published as release
snapshots. A pull request is reviewed here; when accepted it is applied
upstream and appears in the next snapshot, credited to you. That is why merged
work shows up as part of a release commit instead of a merge of your branch.

## Ground rules

- **Local-first.** A feature must not need a server to work with local boards.
  Anything that needs one goes through `apps/client/src/lib/platform.ts`.
- **The document format is shared.** A change to an item's shape needs a schema
  version bump and a migration in `packages/schema`.
- **One design language.** Reuse the existing dialog, select, popover and icon
  components. No new styling frameworks.
- **No secrets in the client.** API keys and credentials never ship in app code.

## Reporting a security issue

Please do not open a public issue for a vulnerability. Email the maintainers
through the contact on boardcache.com with details and steps to reproduce.
