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

## Sign In / Sign Out

Sign-in and sign-out are handled by Better Auth's own catch-all handler (`/api/auth/*`), not a custom Transium route — see `src/app/api/auth/[...all]/route.ts` and `src/lib/auth.ts`.

| Method | Path                       | Purpose                                                                 |
| ------ | --------------------------- | -------------------------------------------------------------------------- |
| POST   | `/api/auth/sign-in/social`  | Exchange an Apple identity token for a Transium session.               |
| POST   | `/api/auth/sign-out`        | Delete the caller's session, invalidating its bearer token.            |

**Sign in** — the iOS app runs the native `ASAuthorizationController` Sign in with Apple flow, then POSTs the resulting identity token:

```json
POST /api/auth/sign-in/social
{ "provider": "apple", "idToken": { "token": "<identityToken JWT>", "user": { "name": { "firstName": "...", "lastName": "..." } } } }
```

`idToken.user` is only ever sent by Apple on the **first** authorization for a given Apple ID + app — omit it on later sign-ins (including after account deletion + re-signup, which resets that state). The response's `token` field (also mirrored in the `set-auth-token` response header) is the value to send as `Authorization: Bearer <token>` on every other endpoint.

**Sign out**:

```
POST /api/auth/sign-out
Authorization: Bearer <session-token>
```

Deletes that one session; other signed-in devices are untouched. Call `DELETE /private/device` first if that device should also stop receiving pushes.

Full request/response schemas are documented in the OpenAPI spec (`/api/openapi.json`, rendered at `/reference`) under the "Auth" tag.

## Hit Private Endpoints

For local testing without going through a real Apple sign-in, run this to create a dummy session.

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

### Journey endpoints

| Method | Path                          | Purpose                                                                        |
| ------ | ------------------------------ | --------------------------------------------------------------------------------- |
| POST   | `/api/private/journey/go`      | Start a journey attempt for a quest. Body: `{ questId }`.                       |
| GET    | `/api/private/journey`         | List the caller's journey attempts. Query: `status?`.                          |
| GET    | `/api/private/journey/{id}`    | Get a single journey attempt, its steps, its summary, and its walked path (all empty/null until ended). |
| POST   | `/api/private/journey/{id}/complete` | Explicitly complete a journey attempt once every step is `status: "done"`. Awards the quest's `xp` to the caller's Profile.level. |
| POST   | `/api/private/journey/media`   | Upload a photo for a journey step. Form fields: `journeyStepId`, `file`.       |

Full request/response schemas are documented in the OpenAPI spec (`/api/openapi.json`, rendered at `/reference`) under the "Journey" tag.

### Profile endpoints

| Method | Path                          | Purpose                                                                        |
| ------ | ------------------------------ | --------------------------------------------------------------------------------- |
| GET    | `/api/private/profile/{id}`    | Get the caller's own profile. `id` must be the caller's own user id.           |
| PATCH  | `/api/private/profile/{id}`    | Update `firstName`/`lastName` on the caller's own profile.                     |
| POST   | `/api/private/profile/media`   | Upload the caller's avatar, setting `user.image`. Form field: `file`.          |
| DELETE | `/api/private/profile/media`   | Remove the caller's avatar.                                                     |

Full request/response schemas are documented in the OpenAPI spec (`/api/openapi.json`, rendered at `/reference`) under the "Profile" tag.

### Gallery endpoints

| Method | Path                          | Purpose                                                                        |
| ------ | ------------------------------ | --------------------------------------------------------------------------------- |
| GET    | `/api/private/gallery`         | List every photo across all of the caller's journey steps, most recent first. |
| GET    | `/api/private/gallery/{id}`    | Download a single photo (`id` is the Media id) as an attachment.              |

Full request/response schemas are documented in the OpenAPI spec (`/api/openapi.json`, rendered at `/reference`) under the "Gallery" tag.

### Device endpoints

Registers APNs device tokens so a user can be pushed to on more than one device. Common flow: `POST` right after sign-in (and again on token rotation), `DELETE` on sign-out.

| Method | Path                  | Purpose                                                                 |
| ------ | ---------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/private/device`      | List the caller's registered devices.                                  |
| POST   | `/api/private/device`      | Register/re-register a device token. Body: `{ token, environment? }`.  |
| DELETE | `/api/private/device`      | Unregister a device token. Body: `{ token }`.                          |
| POST   | `/api/private/device/test` | Send a test push to all of the caller's registered devices.            |

Full request/response schemas are documented in the OpenAPI spec (`/api/openapi.json`, rendered at `/reference`) under the "Device" tag.

### Account endpoints

| Method | Path                   | Purpose                                                                          |
| ------ | ---------------------- | --------------------------------------------------------------------------------- |
| DELETE | `/api/private/account` | Permanently delete the caller's account and all associated data. Irreversible.  |

Full request/response schemas are documented in the OpenAPI spec (`/api/openapi.json`, rendered at `/reference`) under the "Account" tag.
