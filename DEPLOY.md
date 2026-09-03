# Deploy Continental Rummy (step-by-step)

You’ll deploy **two** things: the **server** (game + WebSockets) and the **client** (website). Then you’ll connect the client to the server URL.

---

## Part 1: Deploy the server (Railway)

Railway will run your Node server and give you a public URL.

### Step 1.1 – Create a Railway account

1. Go to **https://railway.app**
2. Click **Login** → **Sign up with GitHub**
3. Authorize Railway to use your GitHub

### Step 1.2 – New project from GitHub

1. In Railway, click **New Project**
2. Choose **Deploy from GitHub repo**
3. Select **nachorn/Conti** (or your repo). If it’s not listed, click **Configure GitHub App** and allow access to the repo, then try again.
4. Click the repo name to add it.

### Step 1.3 – Configure the server

The repository includes `railway.toml`, which builds and starts the server from the repository root.

1. Click the new service (your repo name).
2. Open the **Settings** tab.
3. Leave **Root Directory** at the repository root. Do not set it to `server`, because the config and shared types live at the root.
4. Clear dashboard Build or Start Command overrides so Railway uses `railway.toml`:
   - Build: `npm run build:server`
   - Start: `node server/dist/index.js`
5. Find **Watch Paths** (optional):
   - You can leave default so it redeploys when you push.

6. Configure durable storage **before deploying** (see Saving games below). Set `NODE_ENV=production`.
7. Click **Deploy** (or wait for the first deploy to start).

### Step 1.4 – Get the server URL

1. In your service, open the **Settings** tab.
2. Under **Networking** (or **Public Networking**), click **Generate Domain** (or **Add public domain**).
3. Railway will assign a URL like:  
   **`https://conti-production-xxxx.up.railway.app`**
4. **Copy this URL** (no slash at the end). You’ll use it in Part 2.

If the deploy fails, check the **Deployments** tab logs. Common fixes:
- Root Directory is the repository root.
- Dashboard commands do not override `railway.toml`.
- The `/health` endpoint returns `{ "ok": true }`.

---

## Part 2: Deploy the client (Vercel)

Vercel will build and host the React app. The app will connect to your Railway server using the URL from Part 1.

### Step 2.1 – Create a Vercel account

1. Go to **https://vercel.com**
2. Click **Sign Up** → **Continue with GitHub**
3. Authorize Vercel for your GitHub

### Step 2.2 – Import the repo

1. Click **Add New…** → **Project**
2. Import **nachorn/Conti** (or your repo). If you don’t see it, adjust GitHub permissions and try again.
3. Click **Import**.

### Step 2.3 – Configure the client (root + env)

1. **Root Directory**
   - Click **Edit** next to “Root Directory”.
   - Set it to **`client`**.
   - Confirm.

2. **Framework Preset**
   - Should detect **Vite**. Leave it.

3. **Build and Output**
   - Build Command: **`npm run build`** (default for Vite is fine).
   - Output Directory: **`dist`** (Vite default).

4. **Environment variable (important)**
   - Expand **Environment Variables**.
   - Add:
     - **Name:** `VITE_SOCKET_URL`
     - **Value:** the Railway URL from Part 1, e.g.  
       **`https://conti-production-xxxx.up.railway.app`**  
       (no trailing slash)
   - Set it for **Production** (and optionally Preview if you want).
   - Save.

5. Click **Deploy**.

### Step 2.4 – Get the app URL

When the deploy finishes, Vercel shows a URL like:  
**`https://conti-xxxx.vercel.app`**

That’s the link you and your friend use to play (New York and Spain).

---

## Part 3: Restrict CORS to the deployed client

The server accepts all origins when `CLIENT_ORIGINS` is unset, which makes the first deployment easy. After Vercel gives you the final client URL:

1. Add a Railway environment variable named `CLIENT_ORIGINS`.
2. Set it to the Vercel origin, for example `https://conti-xxxx.vercel.app` (no trailing slash).
3. For multiple allowed clients, use a comma-separated list.
4. Redeploy the server.

---

## Part 4: Test the full flow

1. Open the **Vercel URL** (e.g. `https://conti-xxxx.vercel.app`) in your browser.
2. Create a room and note the **room code**.
3. Open the **same Vercel URL** in another browser or incognito (or send it to your friend).
4. Join with the room code.
5. Start the game and take a turn. If you can draw and discard, the app is working.

---

## Quick reference

| What        | Where |
|------------|--------|
| Server URL | Railway → your service → Settings → Public domain (e.g. `https://....railway.app`) |
| Client URL | Vercel → your project → Domains (e.g. `https://....vercel.app`) |
| Env var    | On Vercel: `VITE_SOCKET_URL` = your Railway server URL |

---

## Saving games and recovering after a server stop

The server now saves a versioned private snapshot before publishing every accepted change. It preserves room codes, seats, hands, deck order, scores, melds and turn state. A reconnect uses a private recovery token; names and room codes cannot reclaim somebody else's hand. Tokens are hashed in storage and must never be copied into bug reports or committed to Git.

- Your seat is recoverable after the first successful join, through connection loss, server restarts and reloads of the **same browser tab**. Keep that tab open. Closing it, clearing browser storage or changing device does not guarantee recovery.
- Disconnected players stay in the room. **Back to menu / Leave** explicitly gives up your seat.
- When all players disconnect, clocks pause. After restart, clocks resume relative to the last saved state with at least 10 seconds of turn grace. If some players remain online, normal configured turn timeouts still apply.
- Abandoned rooms expire after **72 hours** without activity. This is recovery for ongoing games, not permanent game-history storage.
- A storage failure pauses actions. The hosted process exits after the first failed action so the host supervisor can restart it and reload the last confirmed snapshot. Unconfirmed clicks are not automatically replayed. Health checks report an unhealthy store without querying it to keep a free database awake.

Choose **one** storage configuration:

1. **Railway volume:** attach a persistent volume at `/data`, then set `GAME_STATE_PATH=/data/games.json`. Do not set this path unless the volume is actually mounted. Volume usage counts against the hosting allowance; confirm the plan and spending constraints first.
2. **PostgreSQL:** set a server-only `DATABASE_URL` for a durable database, using a direct connection or session-mode pool. Transaction-mode poolers are incompatible with the exclusive writer lock. TLS must remain verified. The database user needs permission to create/update `conti_game_state` in its own database.

Never put `DATABASE_URL` in Vercel's `VITE_` variables. It is a secret for the server, not the website.

The ordinary container filesystem is temporary. A JSON file inside it does **not** survive provider replacement/redeployment. Production, Railway and Render starts refuse to run without explicit storage configuration. Local development defaults to `server/data/games.json` when started from `server/`; this private directory is ignored by Git and Docker.

Run only **one server replica** against a snapshot. Stop the previous instance before starting its replacement. The storage lock intentionally prevents two servers from corrupting a shared game. File locks recover after a hard stop in about 10 seconds; startup waits for the stale lock. PostgreSQL waits up to 20 seconds for the previous writer. With database-backed Render deployments, use manual stop/suspend, deploy/resume so the old writer is released. A normal overlapping zero-downtime deploy will be rejected by the lock. Keep a separate database/snapshot for previews.

## Render fallback (website stays on Vercel)

`render.yaml` declares a **Free** Node web service only. It does not create a database, buy storage, or upgrade a plan. Authorize access to the intended GitHub repository, then supply a durable `DATABASE_URL`. Keep auto-deploy off for the single-writer replacement procedure described above.

If configuring manually:

- Repository root: leave empty (root of Conti).
- Build: `npm --prefix server install --include=dev && npm --prefix server run build`
- Start: `node server/dist/index.js`
- Health check: `/health`
- Node: 22; `NODE_ENV=production`.
- `CLIENT_ORIGINS=https://conti-six.vercel.app` (add separate approved origins only as needed).
- `DATABASE_URL`: durable direct/session-mode PostgreSQL connection, server-only.
- Compute: **Free**, one instance. Do not attach a paid disk or select a paid instance without approval.

After `/health` returns `{ "ok": true }`, set Vercel's `VITE_SOCKET_URL` to the new **HTTPS** Render URL and redeploy the client. Test two-player gameplay and server restart before declaring the migration complete. Keep Railway unchanged until the replacement is verified.

Render Free sleeps after 15 minutes of no inbound HTTP/WebSocket traffic and can take about a minute to wake. Local files are lost on sleep/restart, persistent disks are not available on Free, and free Render Postgres expires after 30 days. Therefore free Render Postgres is not a lasting storage solution. A separate approved durable database is needed for long-term free hosting. Check the account's bandwidth/build allowances and payment settings; do not assume every overage is free. [Render Free documentation](https://render.com/docs/free)

Railway Free currently rejects deployments from 8 a.m. to 8 p.m. in the target region's local time. For US East that means Eastern time. This restriction is separate from code/build failures. [Railway deployment reference](https://docs.railway.com/deployments/reference#free-tier-peak-hours-restriction)

## Updating the app later

- **Code:** Run the tests, push to GitHub, and check the included CI workflow. Railway's “Wait for CI” now has a workflow to wait on. Vercel may deploy automatically. For a shared database, replace the backend using the single-writer procedure above.
- **Server:** Keep the repository root and let `railway.toml` provide the build, start, and health-check settings.
- **Client:** Change Root Directory = `client`, keep `VITE_SOCKET_URL` set to the same Railway URL.
