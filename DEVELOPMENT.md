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



## SQLite

### Execute SQL script to remote or local

```shell
npx wrangler d1 execute transium --remote --file=resources/bus_stops_routes_insert.sql
```

or using CLI

```shell
npx wrangler d1 execute transium --local --command "SELECT * FROM BusStop LIMIT 20"
npx wrangler d1 execute transium --remote --command "SELECT * FROM BusStop LIMIT 20"
```