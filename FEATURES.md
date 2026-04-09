# RosterChirp — Feature Reference

> **Current version:** 0.12.42
> **Application types:** RosterChirp-Chat · RosterChirp-Brand · RosterChirp-Team

---

## All Users

### Messaging

- **Public Messages** — Read and post in public group channels open to all members. Channels can be marked read-only by an admin (announcements-style).
- **Private Group Messages** — Participate in named private groups with a specific set of members.
- **Direct Messages (U2U)** — Start a private one-on-one conversation with any user who has not blocked direct messages.
- **Group Messages** — Access managed private group conversations assigned to you through User Groups (requires RosterChirp-Team).
- **Message History** — Scroll back through conversation history with paginated loading (50 messages per page).
- **Message Reactions** — React to any message with an emoji.
- **Image Sharing** — Attach and send images in any conversation.
- **Reply Threading** — Reply to a specific message to preserve context.
- **@Mentions** — Mention users by name; mentioned users receive a notification badge.
- **Link Previews** — URLs pasted into messages automatically generate a title/image preview card.
- **Message Deletion** — Authors can delete their own messages; deleted messages are replaced with a tombstone.

### Schedule (requires RosterChirp-Team)

- **Calendar View** — Browse events in a full monthly calendar grid (desktop) or a day-list view (mobile).
- **Event Details** — Tap any event to view its full details: date/time, location, description, event type, assigned user groups, and recurrence pattern.
- **Availability Response** — Respond to events with **Going**, **Maybe**, or **Not Going**, plus an optional short note (up to 20 characters).
- **Bulk Availability** — Respond to multiple pending events at once from a single screen.
- **Response Summary** — See how many group members have responded Going / Maybe / Not Going on any event you are assigned to.
- **Filter & Search** — Filter the calendar by event type, keyword, or your own availability status. Keyword search supports word-boundary matching and exact quoted terms.

### Profile & Account

- **Display Name** — Set a public display name shown alongside your username (must be unique).
- **Avatar** — Upload a custom profile photo. A consistent colour avatar is generated automatically from your name if no photo is set.
- **About Me** — Add a short bio visible on your profile.
- **Hide Admin Tag** — Admins can choose to hide the "Admin" role badge on their messages.
- **Block Direct Messages** — Opt out of receiving unsolicited direct messages from other users.
- **Change Password** — Change your own account password at any time.
- **Font Scale** — Adjust the interface text size (80%–200%) stored per-device.

### Notifications & Presence

- **Push Notifications** — Receive push notifications for new messages when the app is backgrounded. Supports Android (Firebase Cloud Messaging) and iOS 16.4+ PWA (Web Push / VAPID).
- **Notification Permission** — Grant or revoke push notification permission from the Notifications tab in your profile.
- **Unread Badges** — Conversations with unread messages display a count badge in the sidebar and on the PWA app icon.
- **Online Presence** — A green indicator shows which users are currently active. Last-seen time is displayed for offline users.
- **Browser Tab Badge** — The page title and PWA icon badge update with the total unread count across all conversations.

### App Experience

- **Progressive Web App (PWA)** — Install RosterChirp to your home screen on Android, iOS, and desktop for a native app feel.
- **Dark / Light Theme** — The interface respects your operating system's colour scheme preference automatically.
- **Mobile-Optimised Layout** — A dedicated mobile layout with a slide-in sidebar, swipe-back navigation, and mobile-native time/date pickers.
- **Keyboard Shortcuts** — Press Enter to send messages; Escape to dismiss modals.

---

## Managers (Tool Managers)

Tool Manager access is granted by an admin to members of one or more designated **User Groups**. Managers have access to the following tools in addition to all user features.

### User Manager

- **View All Users** — Browse the full user directory including email, role, phone, status, and last seen time.
- **Create Users** — Add individual new user accounts with name, email, role, and phone.
- **Bulk Import** — Import multiple users at once from a structured list (CSV-compatible).
- **Edit Users** — Update names, email addresses, phone numbers, and minor status for any user.
- **Suspend / Activate** — Suspend a user to block login without deleting their account or messages. Reversible at any time.
- **Reset Password** — Set a new temporary password for any user.

### Group Manager (requires RosterChirp-Team)

- **Create User Groups** — Create named user groups to organise members into teams or departments.
- **Manage Members** — Add or remove users from any user group. Member changes trigger a system notification in the group's conversation.
- **Multi-Groups** — Create a multi-group conversation that spans multiple user groups simultaneously.
- **Assign Schedule Groups** — Link user groups to schedule events to control who is invited and whose availability is tracked.

### Schedule Manager (requires RosterChirp-Team)

- **Create Events** — Create new calendar events with title, type, date/time, location, description, visibility (public/private), and assigned user groups.
- **Edit & Delete Events** — Modify or remove any event. Recurring events support editing/deleting a single occurrence, all future occurrences, or the entire series.
- **Recurring Events** — Schedule repeating events (daily, weekly, bi-weekly, monthly) with optional end date or occurrence count. Supports specific weekday selection for weekly recurrence.
- **Event Types** — Create and manage colour-coded event type categories (e.g. Training, Match, Meeting).
- **Track Availability** — Enable availability tracking on an event to collect Going / Maybe / Not Going responses from assigned group members.
- **View Full Responses** — See the complete list of who has responded and with what answer, including individual notes. The **No Response** count shows how many assigned members have not yet replied.
- **Download Availability List** — Export a formatted `.txt` file of all availability responses for an event, organised by section (Going, Maybe, Not Going, No Response) and sorted alphabetically by last name within each section.
- **Import Schedule** — Upload and preview a schedule import file, then confirm to bulk-create events.
- **Past Event Visibility** — View and manage past events in the calendar; past events are displayed in a greyed style.

---

## Admins

Admins have full access to all user and manager features plus the following administrative controls.

### User Manager (extended)

- **Delete Users** — Permanently scrub a user's account: email and name are anonymised, all their messages are marked deleted, and direct message threads become read-only. Frees the email address for re-registration immediately.
- **Assign Roles** — Promote or demote users between the **User**, **Manager**, and **Admin** roles.

### Settings

- **Message Features** — Enable or disable individual message channel types across the entire instance: Public Messages, Group Messages, Private Group Messages, and Private Messages (U2U). Disabled features are hidden from all menus, sidebars, and modals.
- **Registration** — Apply a registration code to unlock the application type (Chat / Brand / Team) and associated features. View the instance serial number and current registration status.

### Branding (requires RosterChirp-Brand or higher)

- **App Name** — Set a custom application name that appears in the header, browser tab, and push notifications.
- **Logo / Favicon** — Upload a custom logo used as the app header image and PWA icon (192×512 px generated automatically).
- **Header Colour** — Set custom header bar colours for light mode and dark mode independently.
- **Avatar Colours** — Customise the default avatar colours used for public channel icons and direct message icons.
- **Reset Branding** — Restore all branding settings to the default RosterChirp values in one click.

### Team Configuration (requires RosterChirp-Team)

- **Tool Manager Groups** — Designate one or more User Groups whose members are granted Tool Manager access (User Manager, Group Manager, Schedule Manager). Admins always have full access regardless of this setting.

### Control Panel (Host mode only — admin on the host domain)

- **Tenant Management** — View, create, suspend, and delete tenant instances from a central dashboard.
- **Assign Plans** — Set the application type (Chat / Brand / Team) for each tenant.
- **Custom Domains** — Assign a custom domain to a tenant in addition to its default subdomain.
- **Tenant Details** — View each tenant's slug, plan, status, custom domain, and creation date.

---

## Hosting & Tenant Privacy

RosterChirp supports two deployment modes configured via the `APP_TYPE` environment variable.

### Self-Hosted (Single Tenant)

`APP_TYPE=selfhost` — The default mode for teams running their own private instance. All data is stored in a single PostgreSQL schema. There are no subdomains or tenant concepts; the application runs at the root of whatever domain or IP the server is deployed on.

### RosterChirp-Host (Multi-Tenant)

`APP_TYPE=host` — Enables multi-tenant hosting from a single server. Each tenant is provisioned with:

- **A unique slug** — for example, the slug `acme` creates a dedicated instance accessible at `acme.yourdomain.com`. The slug is set at provisioning time and forms the permanent subdomain for that tenant.
- **An isolated Postgres schema** — every tenant's data (users, messages, groups, events, settings) lives in its own named schema (`tenant_acme`, etc.) within the same database. No data is shared between tenants.
- **An optional custom domain** — a tenant can be mapped to a fully custom domain (e.g. `chat.acme.com`) in addition to its default subdomain. Custom domain lookups are cached for performance.
- **Plan-level feature control** — each tenant can be assigned a different application type (Chat / Brand / Team), enabling per-tenant feature gating from the host control panel.

### Privacy & Isolation Guarantees

- **Schema isolation** — all database queries are scoped to the tenant's schema. A query in one tenant's context cannot read or write another tenant's tables.
- **Socket room isolation** — all real-time socket rooms are prefixed with the tenant schema name (`acme:group:42`). Events emitted in one tenant's rooms cannot reach sockets in another tenant.
- **Online presence isolation** — the online user map is keyed by `schema:userId`, preventing user ID collisions between tenants from leaking presence data.
- **Session isolation** — JWT tokens are validated against the tenant schema. A valid token for one tenant is not accepted by another.
- **Host control plane separation** — the host admin control panel is only accessible on the host's own root domain, protected by a separate `HOST_ADMIN_KEY`, and hidden from all tenant subdomains.
