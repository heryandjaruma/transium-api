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

## Hit Private Endpoints

Run this to create a dummy session.

```shell
npx wrangler d1 execute transium --local --command "
INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
VALUES ('debug-user', 'Debug User', 'debug@example.com', 1, datetime('now'), datetime('now'));"

npx wrangler d1 execute transium --local --command "
INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
VALUES ('debug-session', datetime('now', '+30 days'), 'debug-token-123', datetime('now'), datetime('now'), 'debug-user');"
```

Then do request for the private endpoint with the debug session like above.

```
Header: Authorization: Bearer debug-token-123
```