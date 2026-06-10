---
name: run-mobile
description: Launch the Hindsite Expo mobile app (mobile/) in the iOS simulator against the local Docker backend, to manually test or screenshot a change. Use when asked to run/start/launch/preview the mobile or iOS app, or to verify a mobile change in the simulator.
---

# Run the Hindsite mobile app in the iOS simulator

The mobile app lives in `mobile/` (Expo Router + TypeScript). It talks to the
FastAPI backend over HTTP — so the backend must be up first. Testing always
uses the **local Docker backend**, never production. The iOS Simulator shares
the Mac's network, so the app's `mobile/.env`
(`EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`) reaches the Docker backend
directly.

Run the steps in order. Don't `sleep`-chain to wait; use the `until`/`for`
poll loops shown (a single loop per call is fine).

## 1. Bring up the backend (local Docker)

```bash
cd /Users/jon/Development/code/timeline
docker info >/dev/null 2>&1 || { open -a Docker; for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done; }
docker compose up -d
```

Then wait for health (the backend has a two-phase lifespan; health is up after
the sync phase):

```bash
for i in $(seq 1 30); do r=$(curl -s -m 3 http://localhost:8000/api/health); [ -n "$r" ] && { echo "$r"; break; }; sleep 2; done
```

Expect `{"status":"ok"}`. The local DB carries its own seed data (events to open).
Root `.env` already has `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` (required) plus
`RESEND_API_KEY` + `ALLOWED_EMAIL` (so login emails a real 6-digit code).

## 2. Boot a simulator

```bash
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null
open -a Simulator
```

Pick any available device from `xcrun simctl list devices available | grep iPhone`
if "iPhone 17 Pro" is gone.

## 3. Start Metro + install to the sim (background, long-running)

Run this with `run_in_background: true` — Metro stays up across turns:

```bash
cd /Users/jon/Development/code/timeline/mobile
npx expo start --ios > /tmp/expo-start.log 2>&1
```

Wait for the first bundle (no error), then it's live:

```bash
for i in $(seq 1 90); do grep -qi "Bundled" /tmp/expo-start.log && break; grep -qiE "error|CommandError|failed" /tmp/expo-start.log && break; sleep 2; done
tail -20 /tmp/expo-start.log
```

Success looks like `iOS Bundled NNNNms node_modules/expo-router/entry.js`.

## 4. Verify on screen — screenshot and LOOK

```bash
xcrun simctl io booted screenshot /tmp/sim-shot.png
```

Then Read `/tmp/sim-shot.png`. A blank/Expo-splash frame that never advances is
a failure — check `/tmp/expo-start.log` for a red-box error.

- A **session token persists in the iOS Keychain**, so the app often launches
  already past login, straight into the Timeline (or wherever it last was).
- If it's on the login screen, login needs the **email-code flow**: enter the
  allowlisted email → a 6-digit code is emailed → enter it. (No way to bypass
  unless `AUTH_DISABLED=true` is set on the backend.) Hand this step to the user.

## 5. Live changes (Fast Refresh)

Fast Refresh is **on by default** — editing any file under `mobile/` hot-updates
the running sim, usually preserving the current screen. You'll only *see* a
change for a screen you're currently on (edits to other screens apply but show
on navigation). If it looks stuck, press `r` in the Metro terminal for a full
reload, or re-run the screenshot after a moment. Driving the GUI itself
(tapping rows, etc.) is manual — there's no scripted UI driver wired up.

## 6. Tear down (when done)

```bash
cd /Users/jon/Development/code/timeline
docker compose down
xcrun simctl shutdown all; osascript -e 'quit app "Simulator"' 2>/dev/null
pkill -f "expo start" 2>/dev/null; lsof -ti tcp:8081 2>/dev/null | xargs kill 2>/dev/null
```

(The backgrounded `expo start` task will report a non-zero exit when killed —
that's expected, not a failure.)

## Sanity check (no sim needed)

To just confirm the mobile code typechecks without launching anything:

```bash
cd /Users/jon/Development/code/timeline/mobile && npm run tsc
```
