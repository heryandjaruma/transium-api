# Development Docs

All about development listed here.

## Deploy Latest

```shell
npm run deploy
```

## Create & Apply Migration

```shell
npx wrangler d1 migrations create transium <short-description>
npx wrangler d1 migrations apply transium --remote/--local
```