---
name: run-mobile
description: Launch the Hindsite Expo mobile app (mobile/) in the iOS simulator against the local Docker backend, to manually test or screenshot a change. Use when asked to run/start/launch/preview the mobile or iOS app, or to verify a mobile change in the simulator.
---

# Run the Hindsite mobile app in the iOS simulator

The mobile app lives in `mobile/` (Expo SDK 58, Expo Router + TypeScript,
routes under `mobile/src/app/`). It runs as a **development build** (via
`expo-dev-client`), not Expo Go — Expo Go only ever supports the newest SDK and
can't load the app's native config. It talks to the
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
xcrun simctl list devices available | grep iPhone
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null
open -a Simulator
```

If the list is **empty** (devices show as "unavailable, runtime profile not
found"), the iOS Simulator runtime isn't installed for the current Xcode. The
fix is `xcodebuild -downloadPlatform iOS` (multi-GB download from Apple) —
ask the user before running it. Pick any listed device if "iPhone 17 Pro" is gone.

## 3. Build + install the dev client, start Metro (background, long-running)

The first run — and any run after adding/upgrading a package with native code
or changing `app.json` plugins — compiles the native app. That needs
**CocoaPods** (`pod --version`; if missing, ask the user before
`brew install cocoapods`). `ios/` is generated (Continuous Native Generation,
gitignored) — never edit it by hand.

Run this with `run_in_background: true` — it builds (several minutes the first
time), installs to the booted sim, then stays up as the Metro server:

```bash
cd /Users/jon/Development/code/timeline/mobile
npx expo run:ios -d "iPhone 17 Pro" > /tmp/expo-run.log 2>&1
```

Later runs with no native changes can skip the compile and just start Metro
for the already-installed dev build:

```bash
cd /Users/jon/Development/code/timeline/mobile
npx expo start --dev-client --ios > /tmp/expo-run.log 2>&1
```

Wait for the first bundle (no error), then it's live:

```bash
for i in $(seq 1 300); do grep -qi "Bundled" /tmp/expo-run.log && break; grep -qiE "error:|CommandError|BUILD FAILED" /tmp/expo-run.log && break; sleep 2; done
tail -30 /tmp/expo-run.log
```

Success looks like `iOS Bundled NNNNms node_modules/expo-router/entry.js`.

## 4. Verify on screen — screenshot and LOOK

```bash
xcrun simctl io booted screenshot /tmp/sim-shot.png
```

Then Read `/tmp/sim-shot.png`. A blank/Expo-splash frame that never advances is
a failure — check `/tmp/expo-run.log` for a red-box error.

- A **session token persists in the iOS Keychain**, so the app often launches
  already past login, straight into the Timeline (or wherever it last was).
- If it's on the login screen, login needs the **email-code flow**. To sign in
  without the email (local Docker only, never prod), seed a known test code
  first — the backend's resend throttle then skips the real email:

  ```bash
  cd /Users/jon/Development/code/timeline && docker compose exec -T backend python - <<'EOF'
  import asyncio, os
  from datetime import datetime, timedelta, timezone
  from auth import hash_login_code
  from database import auth_codes_collection
  email = os.environ["ALLOWED_EMAIL"].split(",")[0].strip().lower()
  async def main():
      now = datetime.now(timezone.utc)
      await auth_codes_collection.replace_one({"email": email}, {"email": email, "code_hash": hash_login_code("424242"), "expires_at": now + timedelta(minutes=10), "attempts": 0, "created_at": now}, upsert=True)
  asyncio.run(main())
  EOF
  ```

  Then enter that email in the app, tap "Send me a code", and enter `424242`.
  The code is single-use (consumed on sign-in).
- Simulator input lags: after `text`, take a second screenshot before tapping
  submit, or the tap can fire on a half-typed value. With a hardware keyboard
  connected the on-screen keyboard stays hidden — use the simulator tool's
  `set_keyboard show` to test keyboard avoidance.

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
pkill -f "expo (start|run)" 2>/dev/null; lsof -ti tcp:8081 2>/dev/null | xargs kill 2>/dev/null
```

(The backgrounded `expo` task will report a non-zero exit when killed —
that's expected, not a failure.)

## Sanity check (no sim needed)

To just confirm the mobile code typechecks without launching anything:

```bash
cd /Users/jon/Development/code/timeline/mobile && npm run typecheck && npx expo-doctor
```
