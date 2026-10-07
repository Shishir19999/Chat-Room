# Chat Room

Real-time chat: React (Vite) frontend + Express, Socket.IO and MongoDB backend.

## Setup

1. `npm install` in `Backend` and `Frontend`.
2. Copy `Backend/.env.example` to `Backend/.env` (`PORT`, `MONGODB_URL`, `CORS_ORIGIN`) and `Frontend/.env.example` to `Frontend/.env` (`VITE_API_URL`, must match the backend port).
3. `npm run dev` in `Backend` (or `npm start`), then `npm run dev` in `Frontend`.

`CORS_ORIGIN` is a comma-separated list of allowed origins (default `http://localhost:5173`) used for both REST and Socket.IO.

## Live demo

https://shishir19999.github.io/Chat-Room/

The hosted demo is static (no server, no database). It runs a simulated backend inside your browser.

## Run modes

- Full stack: Express + Socket.IO + MongoDB as in Setup. Real-time over WebSockets, data in MongoDB.
- Browser-only demo: `cd Frontend && npm run dev:demo` (or set `VITE_DEMO=true`). Data lives in localStorage, tabs of the same browser stay in sync through BroadcastChannel, and simulated bot users reply, react and show typing indicators. A "Demo mode" banner offers "Reset demo data". Open two tabs to chat with yourself.
- Static build for GitHub Pages: `cd Frontend && npm run build:pages` writes `Frontend/dist` (base `/Chat-Room/`, hash routing). Preview with `npm run preview:pages`.

## Features

- Rooms list with unread badges; create and join rooms.
- Replies, emoji reactions, edit and delete your own messages, emoji picker.
- Image paste or upload (resized, size-limited data URL).
- @mention highlighting, message search, date separators, load older history (cursor pagination).
- Typing and online indicators, connection status with automatic reconnect, optional notification sound.
- Avatars with colors, light/dark theme (follows the system, remembered), responsive from 320px with a slide-over sidebar, skeletons, toasts, confirm dialogs, inline validation, 404 page.
- Text is escaped by React; inputs are validated and uploads are size-limited.

Parallax and scroll-reveal effects are used only on the landing/join hero and section backgrounds (never in the message list). They use only transform and opacity via IntersectionObserver and requestAnimationFrame, and are disabled for prefers-reduced-motion, small screens and low-power devices.

## API

- `GET /messages?room=general&before=<id>&limit=30&q=text` - page of messages, oldest first, with `hasMore`
- `POST /messages` - body `{ user, message, room?, image?, replyTo? }`
- `GET /rooms`, `POST /rooms`, `POST /rooms/unread`

## Socket events

Client to server: `join {user, room}`, `leave`, `message {message, image?, replyTo?}`, `edit {id, message}`, `delete {id}`, `react {id, emoji}` (acks `{ok, error}`), `typing boolean`.
Server to client: `message`, `message_updated`, `presence`, `typing`, `activity`, `rooms_changed`, `joined`, `error_message`.

## Demo data
`cd Backend && npm run seed` (idempotent, deterministic, database `chatroom`) inserts 400 messages over 6 rooms (`general` 90, `dev` 85, `random` 65, `design` 55, `support` 55, `music` 50) from 12 usernames (alice, bob, carol, dave, erin, frank, grace, heidi, ivan, judy, mallory, nina), spread over the 21 days before 2026-09-30. No login is needed; just pick any name.


## Deploy with Docker

Files: `Backend/Dockerfile`, `Frontend/Dockerfile` (Vite build served by nginx, SPA fallback in `Frontend/nginx.conf`), `.dockerignore` in both folders and `docker-compose.yml` here (mongo + backend + frontend).

```bash
cp .env.example .env      # optional: set CORS_ORIGIN / ports
docker compose up --build -d
```

- Frontend: http://localhost:8081 (`FRONTEND_PORT`), API: http://localhost:8080 (`BACKEND_PORT`). MongoDB is only reachable inside the compose network and its data lives in the `mongo-data` volume.
- `VITE_API_URL` is baked into the frontend bundle at build time and must be the address the **browser** uses to reach the backend (for a server: `http://<server-ip-or-domain>:8080`); rebuild with `docker compose build frontend` after changing it.
- `CORS_ORIGIN` must contain the origin the browser loads the frontend from (default `http://localhost:8081`); for a server use e.g. `http://<server-ip>:8081`.
- Seed demo data: `docker compose exec backend npm run seed` fails in the production image because the seed uses a dev dependency (`@faker-js/faker`); run the seed from your machine instead: `cd Backend && MONGODB_URL=mongodb://127.0.0.1:27017/chatroom npm run seed` after temporarily publishing mongo (add `ports: ["27017:27017"]` to the `mongo` service).
- The backend serves REST and Socket.IO on the same port; `CORS_ORIGIN` is used for both.

> Note: these Docker files were written and reviewed but not built or run in the authoring environment (Docker engine was off).

## Open the app from a phone on the same Wi-Fi

1. Find the PC's LAN IP (`ipconfig` on Windows, look for the IPv4 address, e.g. `192.168.1.79`).
2. Start the backend bound to all interfaces (the default `HOST=0.0.0.0`) with the phone's origin allowed, and Vite with `--host`:
   ```bash
   # Backend
   CORS_ORIGIN=http://localhost:5173,http://192.168.1.79:5173 npm start
   # Frontend: the API URL must use the LAN IP, not localhost
   VITE_API_URL=http://192.168.1.79:8080 npm run dev -- --host 0.0.0.0 --port 5173
   ```
   (PowerShell: `$env:CORS_ORIGIN="..."; npm start`.)
3. Allow the two ports through Windows Firewall (first run usually prompts; otherwise add an inbound rule for TCP 8080 and 5173, "Private" network only).
4. On the phone (same network) open `http://192.168.1.79:5173`.

Without `CORS_ORIGIN` set the API only accepts `http://localhost:5173`. If the phone shows the page but API calls fail, `VITE_API_URL` still points at `localhost` or the origin is missing from `CORS_ORIGIN`.

## Tests

`cd Backend && npm test` (node:test + supertest) runs against a throwaway local database that is dropped afterwards (set `TEST_MONGO_URI` to change the server, default `mongodb://127.0.0.1:27017`).

## Message pagination
`GET /messages?room=general&limit=50` returns `{ data, hasMore, nextBefore }` (data oldest to newest). Pass `before=<message id or ISO date>` to get the page of older messages; the UI has a "Load older messages" button. `limit` defaults to 50, max 100. (This replaces the old plain-array response.)
