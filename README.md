<img width="953" height="907" alt="schedules-tracking-response" src="https://github.com/user-attachments/assets/55967732-9d2b-413b-a58e-a47e4967fd28" />
# RosterChirp

A modern, self-hosted team messaging Progressive Web App (PWA) built for small to medium teams. RosterChirp runs via Docker Compose with PostgreSQL and supports both single-tenant (self-hosted) and multi-tenant (hosted) deployments. 

Development was vibe-coded using Claude.ai.

**Current version:** 0.13.1

<img src="https://github.com/rampar20/rosterchirp/tree/main/screens/messages-private-user2user.png" alt="Alt Text" width="200">
<img src="https://github.com/rampar20/rosterchirp/tree/main/screens/dark-mode.png" alt="Alt Text" width="200">
<img src="https://github.com/rampar20/rosterchirp/tree/main/screens/schedules.png" alt="Alt Text" width="200">
<img src="https://github.com/rampar20/rosterchirp/tree/main/screens/schedules-event-editor.png" alt="Alt Text" width="200">
<img src="https://github.com/rampar20/rosterchirp/tree/main/screens/schedules-tracking-response.png" alt="Alt Text" width="200">

---

## Features

### Messaging
- **Real-time messaging** — WebSocket-powered (Socket.io); messages appear instantly across all clients
- **Image attachments** — Attach and send images via the + menu; auto-compressed client-side before upload
- **Camera capture** — Take a photo directly from the + menu on mobile devices
- **Emoji picker** — Send standalone emoji messages at large size via the + menu
- **Message replies** — Quote and reply to any message with an inline preview
- **Emoji reactions** — Quick-react with common emojis or open the full emoji picker; one reaction per user, replaceable
- **@Mentions** — Type `@` to search and tag users using `@[Display Name]` syntax; autocomplete scoped to group members; mentioned users receive a notification
- **Link previews** — URLs are automatically expanded with Open Graph metadata (title, image, site name)
- **Typing indicators** — See when others are composing a message
- **Image lightbox** — Tap any image to open it full-screen with pinch-to-zoom support
- **Message grouping** — Consecutive messages from the same user are visually grouped; avatar and name shown only on first message
- **Last message preview** — Sidebar shows "You:" prefix when the current user sent the last message

### Channels & Groups
- **Public channels** — Admin-created; all users are automatically added
- **Private groups / DMs** — Any user can create; membership is invite-only by the owner
- **Direct messages** — One-to-one private conversations; sidebar title always shows the other user's real name
- **Duplicate group prevention** — Creating a private group with the same member set as an existing group redirects to the existing group automatically
- **Read-only channels** — Admin-configurable announcement-style channels; only admins can post
- **Support group** — A private admin-only group that receives submissions from the login page contact form
- **Custom group names** — Each user can set a personal display name for any group, visible only to them
- **Group Messages** — Managed private groups (created and controlled by admins via Group Manager) appear in a separate "Private Group Messages" section in the sidebar

### Schedule
- **Team schedule** — Full calendar view for creating and managing team events (Team plan)
- **Desktop & mobile views** — Dedicated layout for each; desktop shows a full monthly grid, mobile shows a scrollable event list
- **Event types** — Colour-coded event categories (configurable by admins)
- **Recurring events** — Create daily, weekly, or custom-interval recurring events; only future occurrences are shown
- **Availability** — Users can mark their availability per event
- **Keyword filter** — Search events by keyword with word-boundary matching; quoted terms match exactly
- **Type filter** — Filter events by event type across the current month (including past events, shown greyed)
- **Past event protection** — New events cannot be created with a start date/time in the past

### Users & Profiles
- **Authentication** — Email/password login with optional Remember Me (30-day session)
- **Forced password change** — New users must change their password on first login
- **User profiles** — Custom display name, avatar upload, About Me text
- **Profile popup** — Click any user's avatar in chat to view their profile card
- **Admin badge** — Admins display a role badge; can be hidden per-user in Profile settings
- **Online presence** — Real-time online/offline status tracked per user
- **Last seen** — Users' last online timestamp updated on disconnect

### Notifications
- **In-app notifications** — Mention alerts with toast notifications
- **Unread indicators** — Private groups with new unread messages are highlighted and bolded in the sidebar
- **Push notifications** — Firebase Cloud Messaging (FCM) push notifications for mentions and new private messages when the app is backgrounded or closed (Android PWA; requires HTTPS and Firebase setup)

### Admin & Settings
- **User Manager** — Create, suspend, activate, delete users; reset passwords; change roles
- **Bulk CSV import** — Import multiple users at once from a CSV file
- **Group Manager** — Create and manage private groups and their membership centrally (Team plan)
- **App branding** — Customize app name, logo, and icons via the Settings panel (Brand+ plan)
- **Reset to defaults** — One-click reset of all branding customizations
- **Version display** — Current app version shown in the Settings panel
- **Default user password** — Configurable via `USER_PASS` env var; shown live in User Manager
- **Feature flags** — Plan-gated features (branding, group manager, schedule manager) controlled via settings

### User Deletion
- Deleting a user scrubs their email, name, and avatar immediately
- Their messages are marked deleted (content removed); direct message threads become read-only
- Group memberships, sessions, push subscriptions, and notifications are purged
- Suspended users retain all data and can be re-activated

### Help & Onboarding
- **Getting Started modal** — Appears automatically on first login; users can dismiss permanently with "Do not show again"
- **Help menu item** — Always accessible from the user menu regardless of dismissed state
- **Editable help content** — `data/help.md` is edited before build and baked into the image at build time

### PWA
- **Installable** — Install to home screen on mobile and desktop via the browser install prompt
- **Adaptive icons** — Separate `any` and `maskable` icon entries; maskable icons sized for Android circular crop
- **Dynamic app icon** — Uploaded logo is automatically resized and used as the PWA shortcut icon
- **Dynamic manifest** — App name and icons update live when changed in Settings
- **Pull-to-refresh disabled** — In PWA standalone mode, pull-to-refresh is disabled to prevent a layout shift bug on mobile

### Contact Form
- **Login page contact form** — A "Contact Support" button on the login page opens a form that posts directly into the admin Support group

---

## Deployment Modes

| Mode | Description |
|---|---|
| `selfhost` | Single tenant — one team, one database schema. Default. |
| `host` | Multi-tenant — one schema per tenant, provisioned via subdomains. Requires `APP_DOMAIN`, `HOST_SLUG`, and `HOST_ADMIN_KEY`. |

Set `APP_TYPE=selfhost` or `APP_TYPE=host` in `.env`.

---

## Plans & Feature Flags

| Plan | Features |
|---|---|
| **RosterChirp-Chat** | Messaging, channels, DMs, profiles, push notifications |
| **RosterChirp-Brand** | Everything in Chat + custom branding (logo, app name, icons) |
| **RosterChirp-Team** | Everything in Brand + Group Manager + Schedule Manager |

Feature flags are stored in the database `settings` table and can be toggled by the admin.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, Socket.io |
| Database | PostgreSQL 16 (via `pg`) |
| Frontend | React 18, Vite |
| Push notifications | Firebase Cloud Messaging (FCM) |
| Image processing | sharp |
| Containerization | Docker, Docker Compose v2 |
| Reverse proxy / SSL | Caddy (recommended) |

---

## Requirements

- **Docker** and **Docker Compose v2**
- A domain name with DNS pointed at your server (required for HTTPS and push notifications)
- Ports **80** and **443** open on your server firewall (if using Caddy for SSL)
- (Optional) A Firebase project for push notifications

---

## Building the Image

All builds use `build.sh`. No host Node.js installation is required.

> **Tip:** Edit `data/help.md` before running `build.sh` to customise the Getting Started help content baked into the image.

```bash
# Build and tag as :latest only
./build.sh

# Build and tag as a specific version
./build.sh 0.13.1
```

---

## Installation

### 1. Clone the repository

```bash
git clone https://your-git/youruser/rosterchirp.git
cd rosterchirp
```

### 2. Build the Docker image

```bash
./build.sh 0.13.1
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env
```

At minimum, set `ADMIN_EMAIL`, `ADMIN_PASS`, `ADMIN_NAME`, `JWT_SECRET`, and `DB_PASSWORD`.

### 4. Start the services

```bash
docker compose up -d
docker compose logs -f rosterchirp
```

### 5. Log in

Open `http://your-server:3000`, log in with your `ADMIN_EMAIL` and `ADMIN_PASS`, and change your password when prompted.

---

## HTTPS & SSL

RosterChirp does not manage SSL itself. Use **Caddy** as a reverse proxy.

### Caddyfile

```
chat.yourdomain.com {
    reverse_proxy rosterchirp:3000
}
```

### docker-compose.yaml (with Caddy)

```yaml
services:
  rosterchirp:
    image: rosterchirp:${ROSTERCHIRP_VERSION:-latest}
    container_name: rosterchirp
    restart: unless-stopped
    expose:
      - "3000"
    environment:
      - NODE_ENV=production
      - APP_TYPE=${APP_TYPE:-selfhost}
      - ADMIN_NAME=${ADMIN_NAME:-Admin User}
      - ADMIN_EMAIL=${ADMIN_EMAIL:-admin@rosterchirp.local}
      - ADMIN_PASS=${ADMIN_PASS:-Admin@1234}
      - USER_PASS=${USER_PASS:-user@1234}
      - ADMPW_RESET=${ADMPW_RESET:-false}
      - JWT_SECRET=${JWT_SECRET:-changeme}
      - APP_NAME=${APP_NAME:-RosterChirp}
      - DEFCHAT_NAME=${DEFCHAT_NAME:-General Chat}
      - DB_HOST=db
      - DB_NAME=${DB_NAME:-rosterchirp}
      - DB_USER=${DB_USER:-rosterchirp}
      - DB_PASSWORD=${DB_PASSWORD}
      - ROSTERCHIRP_VERSION=${ROSTERCHIRP_VERSION:-latest}
    volumes:
      - rosterchirp_uploads:/app/uploads
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    container_name: rosterchirp_db
    restart: unless-stopped
    environment:
      - POSTGRES_DB=${DB_NAME:-rosterchirp}
      - POSTGRES_USER=${DB_USER:-rosterchirp}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - rosterchirp_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-rosterchirp}"]
      interval: 10s
      timeout: 5s
      retries: 5

  caddy:
    image: caddy:alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_certs:/config
    depends_on:
      - rosterchirp

volumes:
  rosterchirp_db:
  rosterchirp_uploads:
  caddy_data:
  caddy_certs:
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_TYPE` | `selfhost` | Deployment mode: `selfhost` (single tenant) or `host` (multi-tenant) |
| `ROSTERCHIRP_VERSION` | `latest` | Docker image tag to run |
| `TZ` | `UTC` | Container timezone (e.g. `America/Toronto`) |
| `ADMIN_NAME` | `Admin User` | Display name of the default admin account |
| `ADMIN_EMAIL` | `admin@rosterchirp.local` | Login email for the default admin account |
| `ADMIN_PASS` | `Admin@1234` | Initial password for the default admin account |
| `USER_PASS` | `user@1234` | Default temporary password for bulk-imported users when no password is specified in CSV |
| `ADMPW_RESET` | `false` | If `true`, resets the admin password to `ADMIN_PASS` on every restart. Emergency recovery only. |
| `JWT_SECRET` | *(insecure default)* | Secret used to sign auth tokens. **Must be changed in production.** |
| `APP_NAME` | `RosterChirp` | Initial application name (can also be changed in Settings UI) |
| `DEFCHAT_NAME` | `General Chat` | Name of the default public channel created on first run |
| `DB_HOST` | `db` | PostgreSQL hostname |
| `DB_NAME` | `rosterchirp` | PostgreSQL database name |
| `DB_USER` | `rosterchirp` | PostgreSQL username |
| `DB_PASSWORD` | *(required)* | PostgreSQL password. **Avoid `!` — shell interpolation issue with Docker Compose.** |
| `APP_DOMAIN` | — | Base domain for multi-tenant host mode (e.g. `example.com`) |
| `HOST_SLUG` | — | Subdomain slug for the host control panel (e.g. `chathost` → `chathost.example.com`) |
| `HOST_ADMIN_KEY` | — | Secret key for the host control plane API |

### Firebase Push Notification Variables (optional)

| Variable | Description |
|---|---|
| `FIREBASE_API_KEY` | Firebase web app API key |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `FIREBASE_APP_ID` | Firebase web app ID |
| `FIREBASE_VAPID_KEY` | Web Push certificate public key (from Firebase Cloud Messaging tab) |
| `FIREBASE_SERVICE_ACCOUNT` | Full service account JSON, stringified (remove all newlines) |

> `ADMIN_EMAIL` and `ADMIN_PASS` are only used on the **first run**. Once the database is seeded they are ignored — unless `ADMPW_RESET=true`.

### Example `.env`

```env
ROSTERCHIRP_VERSION=0.13.1
APP_TYPE=selfhost
TZ=America/Toronto

ADMIN_NAME=Your Name
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASS=ChangeThisNow!

USER_PASS=Welcome@123
ADMPW_RESET=false

JWT_SECRET=replace-this-with-a-long-random-string-at-least-32-chars

APP_NAME=RosterChirp
DEFCHAT_NAME=General Chat

DB_NAME=rosterchirp
DB_USER=rosterchirp
DB_PASSWORD=a-strong-db-password
```

---

## First Login & Setup Checklist

1. Log in with `ADMIN_EMAIL` / `ADMIN_PASS`
2. Change your password when prompted
3. Read the **Getting Started** guide that appears on first login
4. Open ⚙️ **Settings** → upload a logo and set the app name
5. Open 👥 **User Manager** to create accounts for your team

---

## User Management

Accessible from the bottom-left menu (admin only).

| Action | Description |
|---|---|
| Create user | Set name, email, temporary password, and role |
| Bulk CSV import | Upload a CSV to create multiple users at once |
| Reset password | User is forced to set a new password on next login |
| Suspend | Blocks login; messages are preserved |
| Activate | Re-enables a suspended account |
| Delete | Scrubs account data; messages are removed; threads become read-only |
| Change role | Promote member → admin or demote admin → member |

### CSV Import Format

```csv
name,email,password,role
John Doe,john@example.com,TempPass123,member
Jane Smith,jane@example.com,,admin
```

- `password` is optional — defaults to the value of `USER_PASS` if omitted
- All imported users must change their password on first login

---

## Group Types

| | Public Channels | Private Groups | Direct Messages |
|---|---|---|---|
| Who can create | Admin only | Any user | Any user |
| Membership | All users (automatic) | Invite-only by owner | Two users only |
| Sidebar title | Group name | Group name (customisable per user) | Other user's real name |
| Rename | Admin only | Owner only | ❌ Not allowed |
| Read-only mode | ✅ Optional | ❌ N/A | ❌ N/A |
| Duplicate prevention | N/A | ✅ Redirects to existing | ✅ Redirects to existing |
| Managed (Group Manager) | ❌ | ✅ Optional | ❌ |

### @Mention Scoping

- **Public channels** — all active users appear in the `@` autocomplete
- **Private groups** — only members of that group appear
- **Direct messages** — only the other participant appears

---

## Custom Group Names

Any user can set a personal display name for any group:

1. Open the group and tap the **ⓘ info** icon
2. Enter a name under **Your custom name** and tap **Save**
3. The custom name appears in your sidebar and chat header only
4. Message Info shows: `Custom Name (Owner's Name)`
5. Clear the field and tap **Save** to revert to the owner's name

---

## Schedule

The Schedule page (Team plan) provides a full team calendar:

- **Desktop view** — Monthly grid with event cards per day
- **Mobile view** — Scrollable event list with a date picker
- **Event types** — Colour-coded categories created by admins
- **Recurring events** — Set daily, weekly, or custom recurrence intervals
- **Availability** — Members can mark availability per event
- **Keyword search** — Unquoted terms match word prefixes; quoted terms match whole words exactly
- **Type filter** — Filter by event type across the full current month

---

## Push Notifications

RosterChirp uses **Firebase Cloud Messaging (FCM)** for push notifications. HTTPS is required.

### Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Add a **Web app** → copy the config values into `.env`
3. Go to **Project Settings → Cloud Messaging → Web Push certificates** → generate a key pair → copy the public key as `FIREBASE_VAPID_KEY`
4. Go to **Project Settings → Service accounts → Generate new private key** → download the JSON → stringify it (remove all newlines) → set as `FIREBASE_SERVICE_ACCOUNT`

Push notifications are sent for:
- New messages in private groups (to all members except the sender)
- New messages in public channels (to all subscribers except the sender)
- Image messages show as `📷 Image`

---

## Help Content

The Getting Started guide is sourced from `data/help.md`. Edit before running `build.sh` — it is baked into the image at build time.

```bash
nano data/help.md
./build.sh 0.13.1
```

Users can access the guide at any time via **User menu → Help**.

---

## Data Persistence

| Volume | Container path | Contents |
|---|---|---|
| `rosterchirp_db` | `/var/lib/postgresql/data` | PostgreSQL data directory |
| `rosterchirp_uploads` | `/app/uploads` | Avatars, logos, PWA icons, message images |

### Backup

```bash
# Backup database
docker compose exec db pg_dump -U rosterchirp rosterchirp | gzip > rosterchirp_db_$(date +%Y%m%d).sql.gz

# Restore database
gunzip -c rosterchirp_db_20240101.sql.gz | docker compose exec -T db psql -U rosterchirp rosterchirp

# Backup uploads
docker run --rm \
  -v rosterchirp_uploads:/data \
  -v $(pwd):/backup alpine \
  tar czf /backup/rosterchirp_uploads_$(date +%Y%m%d).tar.gz -C /data .
```

---

## Upgrades & Rollbacks

Database migrations run automatically on startup. There is no manual migration step.

```bash
# Upgrade
./build.sh 0.13.1
# Set ROSTERCHIRP_VERSION=0.13.1 in .env
docker compose up -d

# Rollback
# Set ROSTERCHIRP_VERSION=0.12.x in .env
docker compose up -d
```

Data volumes are untouched in both cases.

---

## PWA Icons

| File | Purpose |
|---|---|
| `icon-192.png` / `icon-512.png` | Standard icons — desktop PWA shortcuts (`purpose: any`) |
| `icon-192-maskable.png` / `icon-512-maskable.png` | Adaptive icons — Android home screen (`purpose: maskable`); logo at 75% scale on solid background |

---

## ADMPW_RESET Flag

Resets the **admin account** password to `ADMIN_PASS` on every container restart. Use only when the admin password has been lost.

```env
# Enable for recovery
ADMPW_RESET=true

# Disable after recovering access
ADMPW_RESET=false
```

A ⚠️ warning banner is shown on the login page and in Settings when active.

---

## Development

```bash
# Backend (port 3000)
cd backend && npm install && npm run dev

# Frontend (port 5173)
cd frontend && npm install && npm run dev
```

The Vite dev server proxies all `/api` and `/socket.io` requests to the backend automatically. You will need a running PostgreSQL instance and a `.env` file in the project root.

---

## License

Proprietary — all rights reserved.
