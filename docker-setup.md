## docker-compose.yaml

added multiple variable options, that requires a .env file (envirnment variable)

```
services:
  jama:
    image: jama:${JAMA_VERSION:-latest}
    container_name: ${PROJECT_NAME:-jamachat}
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - NODE_ENV=production
      - TZ=${TZ:-UTC}
      - ADMIN_NAME=${ADMIN_NAME:-Admin User}
      - ADMIN_EMAIL=${ADMIN_EMAIL:-admin@jama.local}
      - ADMIN_PASS=${ADMIN_PASS:-Admin@1234}
      - USER_PASS=${USER_PASS:-user@1234}
      - ADMPW_RESET=${ADMPW_RESET:-false}
      - JWT_SECRET=${JWT_SECRET:-changeme_super_secret_jwt_key_2024}
      - DB_KEY=${DB_KEY}
      - APP_NAME=${APP_NAME:-jama}
      - DEFCHAT_NAME=${DEFCHAT_NAME:-General Chat}
    volumes:
      - ${PROJECT_NAME}_db:/app/data
      - ${PROJECT_NAME}t_uploads:/app/uploads
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  ${PROJECT_NAME:-jamachat}_db:
    driver: local
  ${PROJECT_NAME:-jamachat}_uploads:
    driver: local
```
## .env file

these are an example of a required .env. It can usually be imported in to docker managers.

```
# jama Configuration
# just another messaging app

# Timezone — must match your host timezone (e.g. America/Toronto, Europe/London, Asia/Tokyo)
# Run 'timedatectl' on your host to find the correct value
TZ=UTC
# Copy this file to .env and customize

# Image version to run (set by build.sh, or use 'latest')
JAMA_VERSION=0.9.3

# Default admin credentials (used on FIRST RUN only)
ADMIN_NAME=Admin User
ADMIN_EMAIL=admin@jama.local
ADMIN_PASS=Admin@1234

# Default password for bulk-imported users (when no password is set in CSV)
USER_PASS=user@1234

# Set to true to reset admin password to ADMIN_PASS on every restart
# WARNING: Leave false in production - shows a warning on login page when true
ADMPW_RESET=false

# JWT secret - change this to a random string in production!
JWT_SECRET=changeme_super_secret_jwt_key_change_in_production

# Database encryption key (SQLCipher AES-256)
# Generate a strong random key: openssl rand -hex 32
# IMPORTANT: If you are upgrading from an unencrypted install, run the
# migration script first: node scripts/encrypt-db.js
# Leave blank to run without encryption (not recommended for production)
DB_KEY=

# App port (default 3000)
PORT=3069

# App name (can also be changed in Settings UI)

# Default public group name (created on first run only)
DEFCHAT_NAME=General Chat
APP_NAME=jama

PROJECT_NAME=myjamachat ```