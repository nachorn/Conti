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

### Step 1.3 – Configure the server (root + start command)

Railway will add a “service” for your repo. You need to tell it to run the **server** folder, not the root.

1. Click the new service (your repo name).
2. Open the **Settings** tab.
3. Find **Root Directory** (or **Source**):
   - Set it to **`server`**  
   So Railway only uses the `server` folder.

4. Find **Build Command** (or **Build**):
   - Set it to: **`npm run build`**

5. Find **Start Command** (or **Start**):
   - Set it to: **`npm start`**  
   (This runs `node dist/index.js` after the build.)

6. Find **Watch Paths** (optional):
   - You can leave default so it redeploys when you push.

7. Click **Deploy** (or wait for the first deploy to start).

### Step 1.4 – Get the server URL

1. In your service, open the **Settings** tab.
2. Under **Networking** (or **Public Networking**), click **Generate Domain** (or **Add public domain**).
3. Railway will assign a URL like:  
   **`https://conti-production-xxxx.up.railway.app`**
4. **Copy this URL** (no slash at the end). You’ll use it in Part 2.

If the deploy fails, check the **Deployments** tab logs. Common fixes:
- Root Directory is exactly **server**.
- Build command is **npm run build**, Start command is **npm start**.

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

## Part 3: CORS (if the client can’t connect)

If the browser shows a CORS error when connecting to the server:

1. In Railway, your server already uses `cors({ origin: true })`, so any origin is allowed. If you later restrict origins, add your Vercel URL (e.g. `https://conti-xxxx.vercel.app`).
2. Redeploy the server after any change.

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

## Updating the app later

- **Code:** Push to GitHub. Railway and Vercel will redeploy automatically if connected to the repo.
- **Server:** Change Root Directory = `server`, Build = `npm run build`, Start = `npm start`.
- **Client:** Change Root Directory = `client`, keep `VITE_SOCKET_URL` set to the same Railway URL.
