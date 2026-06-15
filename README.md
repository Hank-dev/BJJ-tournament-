# BJJ Tournament App

Vite + React tournament desk with a small Node backend for shared tournament storage.

## Local Development

```bash
npm install
npm run dev
```

The Vite dev server uses browser `localStorage` by default. To develop against the backend API too:

```bash
npm run build
ADMIN_PASSCODE=local-admin npm run dev:server
```

Then open the backend URL from the terminal output. The backend serves `dist/` and stores data in `./data/tournament-store.json` unless `DATA_DIR` is set.

## Railway Deployment

Railway reads `railway.json`, builds with Railpack, runs `npm run build`, then starts the backend with `npm start`.

Set these Railway variables:

```text
ADMIN_PASSCODE=<choose-a-real-admin-passcode>
```

For persistent tournament data, attach a Railway volume to the service. The backend automatically uses Railway's `RAILWAY_VOLUME_MOUNT_PATH` when a volume is attached. Without a volume, stored tournament data can be lost when the service is rebuilt or moved.

The server listens on `0.0.0.0:$PORT`, which is required for Railway public networking.

## VPS Deployment

The simplest VPS setup is Docker Compose. The app builds the Vite frontend, runs the Node backend on port `3000`, and stores tournament data in a persistent Docker volume at `/app/data`.

On the VPS:

```bash
git clone <your-repo-url>
cd <repo-directory>
cp .env.example .env
```

Edit `.env` and set a real `ADMIN_PASSCODE`. Then start the app:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/api/health
```

If you are not using a domain yet, open `http://<your-vps-ip>:3000`. If you are using Nginx in front of the app, keep `APP_PORT=3000` and proxy your domain to the local container port:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

To deploy updates after pushing new code:

```bash
git pull
docker compose up -d --build
```

Tournament data is stored in the `tournament_data` Docker volume. To inspect or back it up:

```bash
docker compose exec tournament-app ls -lah /app/data
docker compose cp tournament-app:/app/data/tournament-store.json ./tournament-store.backup.json
```
