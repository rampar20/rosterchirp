# RosterChirp — Claude Code Development Context

## What is RosterChirp?

**RosterChirp** is a self-hosted, closed-source, full-stack Progressive Web App for team messaging. It supports both single-tenant (selfhost) and multi-tenant (host) deployments.

**Current version:** 0.13.1

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express + Socket.io |
| Frontend | React + Vite (PWA) |
| Database | PostgreSQL 16 via `pg` npm package |
| Deployment | Docker Compose v2, Caddy reverse proxy (SSL) |
| Auth | JWT (cookie + localStorage), bcryptjs |

---

## Repository Layout

```
rosterchirp/
├── CLAUDE.md                      ← this file
├── KNOWN_LIMITATIONS.md
├── Dockerfile
├── build.sh
├── docker-compose.yaml
├── docker-compose.host.yaml
├── Caddyfile.example
├── .env.example
├── about.json.example
├── backend/
│   ├── package.json               ← version bump required
│   └── src/
│       ├── index.js               ← Express app, Socket.io, tenant middleware wiring
│       ├── middleware/
│       │   └── auth.js            ← JWT auth, teamManagerMiddleware
│       ├── models/
│       │   ├── db.js              ← Postgres pool, query helpers, migrations, seeding
│       │   └── migrations/        ← 001–008 SQL files, auto-applied on startup
│       ├── routes/
│       │   ├── auth.js
│       │   ├── groups.js          ← receives io
│       │   ├── messages.js        ← receives io
│       │   ├── usergroups.js      ← receives io
│       │   ├── schedule.js        ← receives io (as of v0.11.14)
│       │   ├── users.js
│       │   ├── settings.js
│       │   ├── push.js
│       │   ├── host.js            ← RosterChirp-Host control plane only
│       │   ├── about.js
│       │   └── help.js
│       └── utils/
│           └── linkPreview.js
└── frontend/
    ├── package.json               ← version bump required
    ├── vite.config.js
    ├── index.html
    ├── public/
    │   ├── manifest.json
    │   ├── sw.js                  ← service worker / push
    │   └── icons/
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── index.css
        ├── contexts/
        │   ├── AuthContext.jsx
        │   ├── SocketContext.jsx
        │   └── ToastContext.jsx
        ├── pages/
        │   ├── Chat.jsx           ← main shell, page routing, all socket wiring
        │   ├── Login.jsx
        │   ├── ChangePassword.jsx
        │   ├── UserManagerPage.jsx
        │   ├── GroupManagerPage.jsx
        │   └── HostAdmin.jsx      ← DEAD CODE (safe to delete)
        ├── components/
        │   ├── Sidebar.jsx        ← conversation list, groupMessagesMode prop
        │   ├── ChatWindow.jsx     ← message thread + header
        │   ├── MessageInput.jsx   ← free-text compose, onTextChange prop
        │   ├── Message.jsx        ← single message renderer
        │   ├── NavDrawer.jsx      ← hamburger menu
        │   ├── SchedulePage.jsx   ← full schedule (~1600 lines, desktop+mobile views)
        │   ├── MobileEventForm.jsx← mobile event create/edit
        │   ├── Avatar.jsx         ← avatar with consistent colour algorithm
        │   ├── PasswordInput.jsx  ← reusable show/hide password input
        │   ├── GroupInfoModal.jsx
        │   ├── ProfileModal.jsx
        │   ├── SettingsModal.jsx
        │   ├── BrandingModal.jsx
        │   ├── HostPanel.jsx
        │   ├── NewChatModal.jsx
        │   ├── UserFooter.jsx
        │   ├── GlobalBar.jsx
        │   └── [others]
        └── utils/
            └── api.js             ← all API calls + parseTS helper
```

---

## Version Bump — Files to Update

When bumping the version (e.g. 0.12.28 → 0.12.29), update **all three**:

```
backend/package.json      "version": "X.Y.Z"
frontend/package.json     "version": "X.Y.Z"
build.sh                  VERSION="${1:-X.Y.Z}"
```

One-liner:
```bash
OLD=0.12.28; NEW=0.12.29
sed -i "s/\"version\": \"$OLD\"/\"version\": \"$NEW\"/" backend/package.json frontend/package.json
sed -i "s/VERSION=\"\${1:-$OLD}\"/VERSION=\"\${1:-$NEW}\"/" build.sh
```

The `.env.example` has no version field. There is no fourth location.

---

## Output ZIP

When packaging for delivery: `rosterchirp.zip` at `/mnt/user-data/outputs/rosterchirp.zip`

Always exclude:
```bash
zip -qr rosterchirp.zip rosterchirp \
  --exclude "rosterchirp/README.md" \
  --exclude "rosterchirp/data/help.md" \
  --exclude "rosterchirp/backend/src/data/help.md"
```

---

## Application Modes (APP_TYPE in .env)

| Mode | Description |
|---|---|
| `selfhost` | Single tenant — one schema `public`. Default if APP_TYPE unset. |
| `host` | Multi-tenant — one schema per tenant. Requires `HOST_DOMAIN` and `HOST_ADMIN_KEY`. |

RosterChirp-Host tenants are provisioned at `{slug}.{HOST_DOMAIN}`. The host control panel lives at `https://{HOST_DOMAIN}/host`.

---

## Database Architecture

- **Pool:** `db.js` — `query(schema, sql, params)`, `queryOne`, `queryResult`, `exec`, `withTransaction`
- **Schema resolution:** `tenantMiddleware` sets `req.schema` from the HTTP `Host` header before any route runs. `assertSafeSchema()` validates all schema names against `[a-z_][a-z0-9_]*`.
- **Migrations:** Auto-run on startup via `runMigrations(schema)`. Files in `migrations/` applied in order, tracked in `schema_migrations` table per schema. **Never edit an applied migration — add a new numbered file.**
- **Seeding:** `seedSettings → seedEventTypes → seedAdmin → seedUserGroups` on startup. All use `ON CONFLICT DO NOTHING`.
- **Current migrations:** 001 (initial schema) → 002 (triggers/indexes) → 003 (tenants) → 004 (host plan) → 005 (U2U restrictions) → 006 (scrub deleted users) → 007 (FCM push) → 008 (rebrand)

---

## Socket Room Naming (tenant-isolated)

All socket rooms are prefixed with the tenant schema to prevent cross-tenant leakage:

```js
const R = (schema, type, id) => `${schema}:${type}:${id}`;
// e.g. R('tenant_acme', 'group', 42) → 'tenant_acme:group:42'
```

Room types: `group:{id}`, `user:{id}`, `schema:all` (tenant-wide broadcast).

Routes that emit socket events receive `io` as a function argument:
- `auth.js(io)`, `groups.js(io)`, `messages.js(io)`, `usergroups.js(io)`, `schedule.js(io)`

---

## Online User Tracking

```js
const onlineUsers = new Map(); // `${schema}:${userId}` → Set<socketId>
```

**Critical:** The map key is `${schema}:${userId}` — not bare `userId`. Integer IDs are per-schema, so two tenants can have the same user ID. Without the schema prefix, push notifications and online presence would leak across tenants.

**Scale note:** This in-process Map is a single-server construct. See Phase 2 (Redis) for the multi-instance replacement.

---

## Active Sessions

Table: `active_sessions(user_id, device, token, ua)` — PK `(user_id, device)`

Device classes: `mobile` | `desktop` (from user-agent). One session per device type per user — logging in on the same device type displaces the previous session (socket receives `session:displaced`).

---

## Feature Flags & Plans

Stored in `settings` table per schema:

| Key | Values | Plan |
|---|---|---|
| `feature_branding` | `'true'`/`'false'` | Brand+ |
| `feature_group_manager` | `'true'`/`'false'` | Team |
| `feature_schedule_manager` | `'true'`/`'false'` | Team |
| `app_type` | `'RosterChirp-Chat'`/`'RosterChirp-Brand'`/`'RosterChirp-Team'` | — |

RosterChirp-Host always forces `RosterChirp-Team` on the public schema at startup.

---

## Avatar Colour Algorithm

**Must be consistent across all three locations** — `Avatar.jsx`, `Sidebar.jsx`, `ChatWindow.jsx`:

```js
const AVATAR_COLORS = ['#1a73e8','#ea4335','#34a853','#fa7b17','#a142f4','#00897b','#e91e8c','#0097a7'];
const bg = AVATAR_COLORS[(user.name || '').charCodeAt(0) % AVATAR_COLORS.length];
```

If you add a new surface that renders user avatars without a custom photo, use this exact algorithm.

---

## Key Frontend Patterns

### Page Navigation (Chat.jsx)
`page` state: `'chat'` | `'groupmessages'` | `'schedule'` | `'users'` | `'groups'` | `'hostpanel'`

**Rule:** Every page navigation must call `setActiveGroupId(null)` and `setChatHasText(false)` to clear the selected conversation and reset the unsaved-text guard.

### Group Messages vs Messages (Sidebar)
- `groupMessagesMode={false}` → shows public groups + non-managed private groups (PRIVATE MESSAGES section)
- `groupMessagesMode={true}` → shows only `is_managed` private groups (PRIVATE GROUP MESSAGES section)
- New chats always go to the Messages view; creating from Group Messages switches `setPage('chat')`

### Unsaved Text Guard (Chat.jsx → ChatWindow.jsx → MessageInput.jsx)
- `MessageInput` fires `onTextChange(val)` on every keystroke and after send
- `ChatWindow` converts to boolean via `onHasTextChange?.(!!val.trim())`
- `Chat.jsx` stores as `chatHasText`; `selectGroup()` shows `window.confirm` if true and switching conversations
- `MessageInput` resets all state (text, image, link preview) on `group?.id` change via `useEffect`

### Date/Time Utilities
Both `SchedulePage.jsx` and `MobileEventForm.jsx` maintain their own copies of:
- `roundUpToHalfHour()` — default start time for new events
- `parseTypedTime(raw)` — parses free-text time entry
- `fmt12(val)` — formats HH:MM as 12-hour display
- `toTimeIn(iso)` — extracts exact HH:MM from ISO (no rounding)
- `buildISO(date, time)` — builds timezone-aware ISO string for Postgres

`TimeInput` (desktop) and `TimeInputMobile` (mobile) are in-file components — free-text input with 5-slot scrollable dropdown showing only :00/:30 slots.

---

## User Deletion Behaviour

Deleting a user (v0.11.11+):
1. Email scrubbed to `deleted_{id}@deleted` — frees the address immediately
2. Name → `'Deleted User'`, display_name/avatar/about_me nulled, password cleared
3. All their messages set `is_deleted=TRUE, content=NULL, image_url=NULL`
4. Direct messages they were part of set `is_readonly=TRUE`
5. Group memberships, sessions, push subscriptions, notifications, event availability purged

Migration 006 back-fills this for pre-v0.11.11 deleted users.

Suspended users: sessions killed, login blocked, but all data intact and reversible.

---

## Notification Rules (Group Member Changes)

Handled in `usergroups.js` when Group Manager saves a user group's member list:

- **1 user added/removed** → named system message: `"{Name} has joined/been removed from the conversation."`
- **2+ users added/removed** → single generic message: `"N new members have joined/been removed from the conversation."`

Single-user add/remove via `groups.js` (GroupInfoModal) always uses the named message.

---

## Schedule / Event Rules

- **Date/time storage:** `TIMESTAMPTZ` in Postgres. All ISO strings from frontend must include timezone offset via `buildISO(date, time)`.
- **toTimeIn** preserves exact minutes (no half-hour snapping) for edit forms.
- **Default start time for new events:** `roundUpToHalfHour()` — current time rounded up to next :00 or :30.
- **Past start time rule:** New events (not edits) cannot have a start date/time in the past.
- **Recurring events:** `expandRecurringEvent` returns only occurrences within the requested range — never the raw original event as a fallback. Past occurrences are not shown.
- **Keyword filter:** Unquoted terms use `\bterm` (word-boundary prefix — `mount` matches `mountain`). Quoted terms use `\bterm\b` (exact whole-word — `"mount"` does not match `mountain`).
- **Type filter:** Does not shift the date window to today-onwards (unlike keyword/availability filters). Shows all matching events in the current month including past ones (greyed).
- **Clearing keyword:** Also resets `filterFromDate` so the view returns to the normal full-month display.

---

## Dead Code (safe to delete)

- `frontend/src/pages/HostAdmin.jsx` — replaced by `HostPanel.jsx`
- `frontend/src/components/UserManagerModal.jsx`
- `frontend/src/components/GroupManagerModal.jsx`
- `frontend/src/components/MobileGroupManager.jsx`

---

## FCM Push Notifications

**Status:** Working on Android (v0.12.26+). iOS in progress.

### Overview

Push notifications use Firebase Cloud Messaging (FCM) — not the older web-push/VAPID approach. VAPID env vars are still present (auto-generated on first start) but are no longer used for push delivery.

### Firebase Project Setup

1. Create a Firebase project at console.firebase.google.com
2. Add a **Web app** to the project → copy the web app config values into `.env`
3. In Project Settings → Cloud Messaging → **Web Push certificates** → generate a key pair → copy the public key as `FIREBASE_VAPID_KEY`
4. In Project Settings → Service accounts → Generate new private key → download JSON → stringify it (remove all newlines) → set as `FIREBASE_SERVICE_ACCOUNT` in `.env`

Required `.env` vars:
```
FIREBASE_API_KEY=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_VAPID_KEY=           # Web Push certificate public key (from Cloud Messaging tab)
FIREBASE_SERVICE_ACCOUNT=     # Full service account JSON, stringified (backend only)
```

### Architecture

```
Frontend (browser/PWA)
  └─ usePushNotifications hook (Chat.jsx or dedicated hook)
       ├─ GET /api/push/firebase-config  → fetches SDK config from backend
       ├─ Initialises Firebase JS SDK + getMessaging()
       ├─ getToken(messaging, { vapidKey })  → obtains FCM token
       └─ POST /api/push/subscribe  → registers token in push_subscriptions table

Backend (push.js)
  ├─ sendPushToUser(schema, userId, payload)  — shared helper, called from:
  │     ├─ messages.js  (REST POST route — PRIMARY message path)
  │     └─ index.js     (socket message:send handler — secondary/fallback)
  └─ Firebase Admin SDK sends the FCM message to Google's servers → device
```

### Database

Table `push_subscriptions` (migration 007):
```sql
id, user_id, device ('mobile'|'desktop'), fcm_token, created_at
```
PK is `(user_id, device)` — one token per device type per user. `/api/push/subscribe` deletes the old row then inserts, so tokens stay fresh.

### Message Payload Structure

All real messages use `notification + data`:
```js
{
  token: sub.fcm_token,
  notification: { title, body },           // FCM shows this even if SW fails
  data: { url: '/', groupId: '42' },        // SW uses for click routing
  android: { priority: 'high', notification: { sound: 'default' } },
  webpush: { headers: { Urgency: 'high' }, fcm_options: { link: url } },
}
```

### Service Worker (sw.js)

`onBackgroundMessage` fires when the PWA is backgrounded/closed. Shows the notification and stores `groupId` for click routing. When the user taps the notification, the SW's `notificationclick` handler navigates to the app.

### Push Trigger Logic (messages.js)

**Critical:** The frontend sends messages via `POST /api/messages/group/:groupId` (REST), not via the socket `message:send` event. Push notifications **must** be fired from `messages.js`, not just from the socket handler in `index.js`.

- **Private group:** query `group_members`, skip sender, call `sendPushToUser` for each member
- **Public group:** query `DISTINCT user_id FROM push_subscriptions WHERE user_id != sender`, call `sendPushToUser` for each
- Image messages use body `'📷 Image'`
- The socket handler in `index.js` has identical logic for any future socket-path senders

### Debug & Test Endpoints

```
GET  /api/push/debug        # admin only — lists all FCM tokens for this schema + firebase status
POST /api/push/test         # sends test push to own device
POST /api/push/test?mode=browser  # webpush-only test (Chrome handles directly, no SW involved)
```

Use `/debug` to confirm tokens are registered. Use `/test` to verify end-to-end delivery independently of real message flow.

### Stale Token Cleanup

`sendPushToUser` catches FCM errors and deletes the `push_subscriptions` row for codes:
- `messaging/registration-token-not-registered`
- `messaging/invalid-registration-token`
- `messaging/invalid-argument`

---

## Scale Architecture

### Context

RosterChirp-Host is expected to grow to 100,000+ tenants with some tenants having 300+ users — potentially millions of concurrent users total. The current single-process, single-database architecture has well-understood ceilings. This section documents what those ceilings are, what needs to change, and exactly how to implement each phase.

### How Messages Are Currently Loaded (No Problem Here)

Messages are **not** pre-loaded into server memory. The backend uses cursor-based pagination:
- On conversation open: fetches the most recent **50 messages** via `ORDER BY created_at DESC LIMIT 50`
- "Load older messages" button: fetches the next 50 using `before={oldest_message_id}` as a cursor
- Each fetch is a fast indexed Postgres query; the Node process returns results and discards them immediately

The `messages` array grows in the **browser tab** as users scroll back (each "load more" prepends 50 items to React state). At extreme history depth this affects browser memory and scroll performance — a virtual scroll window would fix it — but this is a client-side concern, not a server concern.

### Current Architecture Ceilings

| Resource | Current Config | Approximate Ceiling |
|---|---|---|
| Node.js processes | 1 | ~10,000–30,000 concurrent sockets |
| Postgres connections | Pool max 20 | Saturates under concurrent load |
| `onlineUsers` Map | In-process JavaScript Map | Lost on restart; not shared across instances |
| `tenantDomainCache` | In-process JavaScript Map | Stale on other instances after update |
| File storage | `/app/uploads` (container volume) | Not accessible across multiple instances |

### Scale Targets by Phase

| Phase | Concurrent Users | Architecture |
|---|---|---|
| Current | ~5,000–10,000 | Single Node, single Postgres |
| Phase 1 (PgBouncer) | ~20,000–40,000 | + connection pooler, no code changes |
| Phase 2 (Redis) | ~200,000–500,000 | + Redis, multiple Node instances |
| Phase 3 (Read replicas) | ~500,000–1,000,000 | + Postgres streaming replication |
| Phase 4 (Sharding) | 1,000,000+ | Multiple Postgres clusters, regional deploy |

---

## Phase 1 — PgBouncer (Implement Now)

### What It Does

PgBouncer sits between the Node app and Postgres as a connection pooler. Instead of Node holding up to 20 long-lived Postgres connections, PgBouncer maintains a pool of e.g. 100 server-side Postgres connections and multiplexes thousands of short application requests onto them. Postgres itself stays healthy; query throughput increases significantly under concurrent load.

**This requires zero code changes.** It is purely an infrastructure addition.

### Why It Matters Now

The current pool `max: 20` means at most 20 queries run simultaneously across all tenants. Under load (many tenants posting messages simultaneously) requests queue up waiting for a free connection. PgBouncer resolves this without touching a line of application code.

### Implementation

**Step 1: Add PgBouncer service to `docker-compose.host.yaml`**

```yaml
  pgbouncer:
    image: edoburu/pgbouncer:latest
    container_name: ${PROJECT_NAME:-rosterchirp}_pgbouncer
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgres://${DB_USER:-rosterchirp}:${DB_PASSWORD}@db:5432/${DB_NAME:-rosterchirp}
      - POOL_MODE=transaction
      - MAX_CLIENT_CONN=1000
      - DEFAULT_POOL_SIZE=100
      - MIN_POOL_SIZE=10
      - RESERVE_POOL_SIZE=20
      - RESERVE_POOL_TIMEOUT=5
      - SERVER_IDLE_TIMEOUT=600
      - LOG_CONNECTIONS=0
      - LOG_DISCONNECTIONS=0
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h localhost -p 5432 -U ${DB_USER:-rosterchirp}"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Step 2: Point the Node app at PgBouncer instead of Postgres directly**

In `docker-compose.host.yaml`, change the `jama` service environment:
```yaml
      - DB_HOST=pgbouncer   # was: db
      - DB_PORT=5432
```

The `jama` service `depends_on` should add `pgbouncer`.

**Step 3: Tune Postgres `max_connections`**

Add to the `db` service in `docker-compose.host.yaml`:
```yaml
    command: >
      postgres
      -c max_connections=200
      -c shared_buffers=256MB
      -c effective_cache_size=768MB
      -c work_mem=4MB
      -c maintenance_work_mem=64MB
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
      -c random_page_cost=1.1
```

**Step 4: Increase the Node pool size**

In `backend/src/models/db.js`, increase `max` since PgBouncer multiplexes efficiently:
```js
const pool = new Pool({
  host:                    process.env.DB_HOST     || 'db',
  port:                    parseInt(process.env.DB_PORT || '5432'),
  database:                process.env.DB_NAME     || 'rosterchirp',
  user:                    process.env.DB_USER     || 'rosterchirp',
  password:                process.env.DB_PASSWORD || '',
  max:                     100,   // was 20 — PgBouncer handles the actual Postgres pool
  idleTimeoutMillis:       10000, // was 30000 — release faster, PgBouncer manages persistence
  connectionTimeoutMillis: 5000,
});
```

**Important caveat — transaction mode:** PgBouncer in `POOL_MODE=transaction` releases the server connection after each transaction completes. This means `SET search_path` (which `db.js` runs before every query) is safe only because each `query()` call acquires, uses, and releases its own connection. Do **not** use session-level state or `LISTEN/NOTIFY` through PgBouncer — it won't work in transaction mode.

**Step 5: Add `PGBOUNCER_` vars to `.env.example`**
```
PGBOUNCER_MAX_CLIENT_CONN=1000
PGBOUNCER_DEFAULT_POOL_SIZE=100
```

**Step 6: Verify**

After deploying:
```bash
# Connect to PgBouncer admin console
docker compose exec pgbouncer psql -h localhost -p 6432 -U pgbouncer pgbouncer
SHOW POOLS;   -- shows active/idle/waiting connections
SHOW STATS;   -- shows requests/sec
```

### Expected Outcome

With PgBouncer in place, the database connection bottleneck is effectively eliminated for the near term. 1,000 simultaneous tenant requests will queue through PgBouncer's pool of 100 server connections rather than waiting for Node's pool of 20 application-level connections. Throughput roughly 5× at moderate load.

---

## Phase 2 — Redis (Horizontal Scaling)

### What It Does

Redis enables multiple Node.js instances to share state that currently lives in each process's memory:

1. **Socket.io Redis Adapter** — allows `io.to(room).emit()` to reach sockets on any instance
2. **Shared `onlineUsers`** — replaces the in-process Map with a Redis `SADD`/`SREM`/`SMEMBERS` structure
3. **Shared `tenantDomainCache`** — replaces the in-process Map with a Redis hash with TTL

Without Redis, running two Node instances would mean:
- A message emitted on Instance A can't reach a user connected to Instance B
- User A on Instance 1 shows as offline to User B on Instance 2
- A custom domain update on Instance 1 isn't reflected on Instance 2

### Prerequisites

Phase 1 (PgBouncer) should be deployed and stable first. Phase 2 is a significant code change — plan for a maintenance window.

### npm Packages Required

```bash
npm install @socket.io/redis-adapter ioredis
```

Add to `backend/package.json` dependencies.

### Step 1: Add Redis to docker-compose.host.yaml

```yaml
  redis:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME:-rosterchirp}_redis
    restart: unless-stopped
    command: >
      redis-server
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --save ""
      --appendonly no
    volumes:
      - rosterchirp_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  rosterchirp_redis:
    driver: local
```

Add `REDIS_URL=redis://redis:6379` to the `jama` service environment and to `.env.example`.

### Step 2: Socket.io Redis Adapter (index.js)

Replace the current `new Server(server, ...)` block:

```js
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient }  = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Two Redis clients required by the adapter (pub + sub)
const pubClient = createClient(REDIS_URL);
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
console.log('[Server] Socket.io Redis adapter connected');
```

This must be done **before** `io.on('connection', ...)` registers. With this in place, `io.to(room).emit(...)` fans out via Redis pub/sub to every Node instance — no other route code changes required.

### Step 3: Replace onlineUsers Map with Redis (index.js)

Current in-process Map:
```js
const onlineUsers = new Map(); // `${schema}:${userId}` → Set<socketId>
```

Replace with Redis operations. Create a dedicated Redis client for presence (separate from the adapter clients):

```js
const presenceClient = createClient(REDIS_URL);
await presenceClient.connect();

// Key structure: presence:{schema}:{userId} → Set of socketIds
// TTL of 24h prevents stale keys if a server crashes without cleanup
const PRESENCE_TTL = 86400; // seconds

async function addPresence(schema, userId, socketId) {
  const key = `presence:${schema}:${userId}`;
  await presenceClient.sAdd(key, socketId);
  await presenceClient.expire(key, PRESENCE_TTL);
}

async function removePresence(schema, userId, socketId) {
  const key = `presence:${schema}:${userId}`;
  await presenceClient.sRem(key, socketId);
  // Return remaining count — 0 means user is now offline
  return presenceClient.sCard(key);
}

async function isOnline(schema, userId) {
  const key = `presence:${schema}:${userId}`;
  return (await presenceClient.sCard(key)) > 0;
}

async function getOnlineUserIds(schema) {
  // Scan keys matching presence:{schema}:* and return user IDs of non-empty sets
  const pattern = `presence:${schema}:*`;
  const keys = await presenceClient.keys(pattern);
  const online = [];
  for (const key of keys) {
    if ((await presenceClient.sCard(key)) > 0) {
      online.push(parseInt(key.split(':')[2]));
    }
  }
  return online;
}
```

Then replace all `onlineUsers.has/get/set/delete` calls in the `io.on('connection')` handler with the async Redis equivalents. This requires making the connection handler and its sub-handlers `async` where they aren't already.

**Disconnect handler becomes:**
```js
socket.on('disconnect', async () => {
  const remaining = await removePresence(schema, userId, socket.id);
  if (remaining === 0) {
    exec(schema, 'UPDATE users SET last_online=NOW() WHERE id=$1', [userId]).catch(() => {});
    io.to(R('schema', 'all')).emit('user:offline', { userId });
  }
});
```

**users:online handler becomes:**
```js
socket.on('users:online', async () => {
  const userIds = await getOnlineUserIds(schema);
  socket.emit('users:online', { userIds });
});
```

### Step 4: Replace tenantDomainCache with Redis (db.js)

Current in-process Map:
```js
const tenantDomainCache = new Map();
```

Replace with a Redis hash with TTL:

```js
let redisClient = null; // set externally after Redis connects

function setRedisClient(client) { redisClient = client; }

async function resolveSchema(req) {
  // ... existing logic up to custom domain lookup ...

  // Custom domain lookup — Redis first, fallback to DB
  if (redisClient) {
    const cached = await redisClient.hGet('tenantDomainCache', host);
    if (cached) return cached;
  }
  // DB fallback
  const tenant = await queryOne('public',
    'SELECT schema_name FROM tenants WHERE custom_domain=$1 AND status=$2',
    [host, 'active']
  );
  if (tenant) {
    if (redisClient) await redisClient.hSet('tenantDomainCache', host, tenant.schema_name);
    return tenant.schema_name;
  }
  throw new Error(`Unknown tenant for host: ${host}`);
}

async function refreshTenantCache(tenants) {
  if (!redisClient) return;
  // Rebuild the entire hash atomically
  await redisClient.del('tenantDomainCache');
  for (const t of tenants) {
    if (t.custom_domain && t.schema_name) {
      await redisClient.hSet('tenantDomainCache', t.custom_domain.toLowerCase(), t.schema_name);
    }
  }
  await redisClient.expire('tenantDomainCache', 3600); // 1h TTL as safety net
}
```

Export `setRedisClient` and call it from `index.js` after Redis connects, before `initDb()`.

When a custom domain is updated via the host control panel (`host.js`), call `refreshTenantCache` to invalidate immediately.

### Step 5: File Storage — Move to Object Storage

With multiple Node instances, each container has its own `/app/uploads` volume. An avatar uploaded to Instance A isn't accessible from Instance B.

**Recommended: Cloudflare R2** (S3-compatible, free egress, affordable storage)

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Changes to `backend/src/routes/users.js` (avatar upload) and `backend/src/routes/settings.js` (logo/icon upload):

```js
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,      // https://<account>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(buffer, key, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${process.env.R2_PUBLIC_URL}/${key}`;  // R2 public bucket URL
}
```

All `avatarUrl` and `logoUrl` values stored in the DB become full `https://` URLs rather than `/uploads/...` paths. The frontend already renders them via `<img src={url}>` so no frontend changes are needed.

Add to `.env.example`:
```
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=            # e.g. https://assets.yourdomain.com
```

### Step 6: Load Balancing Multiple Node Instances

With Redis adapter in place, run multiple Node containers behind Caddy:

In `docker-compose.host.yaml`, add additional app instances:
```yaml
  rosterchirp_1:
    image: rosterchirp:${ROSTERCHIRP_VERSION:-latest}
    <<: *rosterchirp-base   # use YAML anchors for shared config
    container_name: rosterchirp_1

  rosterchirp_2:
    image: rosterchirp:${ROSTERCHIRP_VERSION:-latest}
    <<: *rosterchirp-base
    container_name: rosterchirp_2
```

**Caddyfile update:**
```
{HOST_DOMAIN} {
  reverse_proxy rosterchirp_1:3000 rosterchirp_2:3000 {
    lb_policy       round_robin
    health_uri      /api/health
    health_interval 15s
  }
}
```

**Critical — WebSocket sticky sessions:** Socket.io with the Redis adapter handles cross-instance messaging, but the **initial HTTP upgrade handshake** must land on the same instance as the polling fallback. Caddy's `lb_policy round_robin` handles this correctly for WebSocket connections (once upgraded, the connection stays). For the polling transport, add:

```
    header_up X-Real-IP {remote_host}
    header_up Cookie {http.request.header.Cookie}
```

Or force WebSocket-only transport in the Socket.io client config (eliminates the polling concern entirely):
```js
// frontend/src/contexts/SocketContext.jsx
const socket = io({ transports: ['websocket'] });
```

### Step 7: Verify Redis Phase

After deploying:
```bash
# Check adapter is working — should see Redis keys
docker compose exec redis redis-cli keys '*'

# Check presence tracking
docker compose exec redis redis-cli keys 'presence:*'

# Check tenant cache
docker compose exec redis redis-cli hgetall tenantDomainCache

# Monitor real-time Redis traffic during a test message send
docker compose exec redis redis-cli monitor
```

### Phase 2 Summary — Files Changed

| File | Change |
|---|---|
| `backend/src/index.js` | Redis adapter, presence helpers replacing onlineUsers Map |
| `backend/src/models/db.js` | Redis-backed tenantDomainCache, setRedisClient export |
| `backend/src/routes/users.js` | R2 upload for avatars |
| `backend/src/routes/settings.js` | R2 upload for logos/icons |
| `backend/package.json` | Add `@socket.io/redis-adapter`, `ioredis`, `@aws-sdk/client-s3` |
| `docker-compose.host.yaml` | Add Redis service, multiple app instances, Caddy lb |
| `frontend/src/contexts/SocketContext.jsx` | Force WebSocket transport |
| `.env.example` | Add `REDIS_URL`, `R2_*` vars |

---

## Mobile Input / Auto-Fill Fixes

### CSS (`index.css`)

**Auto-fill styling** — prevents browser yellow/blue autofill background from breaking the theme:
```css
input:-webkit-autofill {
  -webkit-box-shadow: 0 0 0 1000px var(--surface) inset !important;
  -webkit-text-fill-color: var(--text-primary) !important;
  transition: background-color 5000s ease-in-out 0s !important;
}
```

**Prevent iOS zoom on input focus** — iOS zooms in if font-size < 16px:
```css
@media (max-width: 768px) {
  input:focus, textarea:focus, select:focus { font-size: 16px !important; }
}
```

### Input Attributes

| File | Change |
|---|---|
| `MessageInput.jsx` | `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="sentences"`, `spellCheck="true"` on message textarea |
| `PasswordInput.jsx` | Default `autoComplete="new-password"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck="false"` (callers can override via props) |
| `Login.jsx` | Email: `autoComplete="email"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck="false"`; Password: `autoComplete="current-password"` |
| `ChangePassword.jsx` | Current password: `autoComplete="current-password"`; new/confirm: inherit `new-password` default |
| `UserManagerPage.jsx` | Email: `autoComplete="email"`; First/Last name: `given-name`/`family-name`; Phone: `autoComplete="tel"` |
| `GroupManagerPage.jsx` | Fixed duplicate `autoComplete` attributes; search/name inputs use `autoComplete="off"` |

---

## Phase 3 — Read Replicas (Future)

When write load on Postgres becomes a bottleneck (typically >100,000 concurrent active users):

1. Configure Postgres streaming replication — one primary, 1–2 standbys
2. In `db.js`, maintain two pools: `primaryPool` (writes) and `replicaPool` (reads)
3. Route `query()` to `replicaPool`, `exec()`/`queryResult()` to `primaryPool`
4. `withTransaction()` always uses `primaryPool`

This is entirely within `db.js` — no route changes needed if the abstraction is preserved.

---

## Phase 4 — Tenant Sharding (Future)

When a single Postgres cluster can't handle the write volume (millions of active tenants):

1. Assign each tenant to a shard (DB cluster) at provisioning time — store in the `tenants` table as `shard_id`
2. `resolveSchema()` in `db.js` looks up the tenant's shard and returns both schema name and DB host
3. Maintain a pool per shard rather than one global pool
4. `host.js` provisioning logic assigns shards using a round-robin or least-loaded strategy

This is a significant architectural change. Do not implement until clearly needed.

---

## Outstanding / Deferred Work

### iOS Push Notifications
**Status:** In progress. Android working (v0.12.26+). iOS PWA push requires additional handling — investigation ongoing.

### WebSocket Reconnect on Focus
**Status:** Deferred. Socket drops when Android PWA is backgrounded.
**Fix:** Frontend-only — listen for `visibilitychange` in `SocketContext.jsx`, reconnect socket when `document.visibilityState === 'visible'`. Note: forcing WebSocket-only transport (Phase 2 Step 6) may affect reconnect behaviour — implement reconnect-on-focus at the same time as the transport change.

### Message History — Browser Memory
**Status:** Future. The `messages` array in `ChatWindow` grows unbounded as a user scrolls back through history. At extreme depth (thousands of messages in one session), this affects browser scroll performance.
**Fix:** Virtual scroll window — discard messages scrolled far out of view, re-fetch on demand. This is a non-trivial frontend refactor (react-virtual or similar). Not needed until users regularly have very long scrollback sessions.

### Orphaned Image Cleanup
**Status:** Future. Deleted messages null `image_url` in DB but leave the file on disk (or in R2 after Phase 2). A background job that periodically deletes image files with no corresponding DB row would prevent unbounded storage growth.

### hasMore Heuristic
**Status:** Minor. `hasMore` is set to `true` when `messages.length >= 50`. If a conversation has exactly 50 messages total, this shows a "Load older" button that returns nothing. Fix: return a `total` count from the backend GET messages route, or check `older.length < 50` to detect end of history.

---

## Environment Variables (.env.example)

Key variables:
```
APP_TYPE=selfhost|host
HOST_DOMAIN=             # host mode only
HOST_ADMIN_KEY=          # host mode only
JWT_SECRET=
DB_HOST=db               # set to 'pgbouncer' after Phase 1
DB_NAME=rosterchirp
DB_USER=rosterchirp
DB_PASSWORD=             # avoid ! (shell interpolation issue with docker-compose)
ADMIN_EMAIL=
ADMIN_NAME=
ADMIN_PASS=
ADMPW_RESET=true|false
APP_NAME=rosterchirp
USER_PASS=               # default password for bulk-created users
DEFCHAT_NAME=General Chat
ROSTERCHIRP_VERSION=     # injected by build.sh into Docker image
VAPID_PUBLIC=            # auto-generated on first start if not set
VAPID_PRIVATE=           # auto-generated on first start if not set
FIREBASE_API_KEY=          # FCM web app config
FIREBASE_PROJECT_ID=       # FCM web app config
FIREBASE_MESSAGING_SENDER_ID= # FCM web app config
FIREBASE_APP_ID=           # FCM web app config
FIREBASE_VAPID_KEY=        # FCM Web Push certificate public key
FIREBASE_SERVICE_ACCOUNT=  # FCM service account JSON (stringified, backend only)

# Phase 1 (PgBouncer)
PGBOUNCER_MAX_CLIENT_CONN=1000
PGBOUNCER_DEFAULT_POOL_SIZE=100

# Phase 2 (Redis + R2)
REDIS_URL=redis://redis:6379
R2_ENDPOINT=             # https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=           # https://assets.yourdomain.com
```

---

## Deployment

```bash
# Production: Ubuntu 22.04, Docker Compose v2
# Directory: /home/rick/rosterchirp/

./build.sh              # builds Docker image
docker compose up -d    # starts all services
```

Build sequence: `build.sh` → Docker build → `npm run build` (Vite) → `docker compose up -d`

---

## Session History

Development continues in Claude Code from v0.11.26 (rebranded from jama to RosterChirp). Scale architecture analysis and Phase 1/2 implementation specs added based on planned growth to 100,000+ tenants.
