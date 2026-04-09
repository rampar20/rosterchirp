ARG VERSION=dev
ARG BUILD_DATE=unknown

FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:20-alpine
ARG VERSION=dev
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="rosterchirp" \
      org.opencontainers.image.description="Self-hosted team chat PWA" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV ROSTERCHIRP_VERSION=${VERSION}

# No native build tools needed — pg uses pure JS by default
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev

COPY backend/ ./
COPY --from=builder /app/frontend/dist ./public

RUN mkdir -p /app/uploads/avatars /app/uploads/logos /app/uploads/images

EXPOSE 3000
CMD ["node", "src/index.js"]
