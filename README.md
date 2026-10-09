# Clockwork Alchemy Workshop Signups

## admin stack

- cms
  - pocketbase admin ui (https://pocketbase.io)
- email service
  - cloudflare email service (https://developers.cloudflare.com/email-service)
- host
  - site: cloudflare workers (https://workers.cloudflare.com)
  - database: coolify (https://coolify.io)

## dev stack

- meta framework
  - svelte kit (https://svelte.dev)
- database
  - pocketbase (https://pocketbase.io)
- monorepo
  - pnpm workspaces (https://pnpm.io/workspaces)
- tooling
  - mise (https://mise.jdx.dev)
  - fish + tmux dev loop (`pnpm start`)

## dev libraries

- styles
  - simple.css (https://simplecss.org)
- email content
  - svelty-email (https://github.com/cmjoseph07/svelty-email)
- database client
  - pocketbase js sdk (https://github.com/pocketbase/js-sdk)
- validation
  - valibot (https://valibot.dev)
- pocketbase hooks
  - tsdown (https://tsdown.dev)

## packages

- `packages/www`
  - the signup site
- `packages/database`
  - pocketbase schema, hooks, and deploy
- `packages/scripts`
  - dev loop orchestration
- `packages/www-old`
  - last year's airtable + vercel site, for reference

## routes

- `/`
  - info on workshops
  - one form to sign up for workshops (or join the waitlist)
- `/signin`
  - one-time code sign in for returning users
- `/confirmation`
  - page users are redirected to after a submission
  - summary of their signups, also emailed to them
- `/signout`
  - clears the session
