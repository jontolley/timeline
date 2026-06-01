# Hindsite — iOS / mobile app (Expo)

A native React Native client for Hindsite, built with **Expo Router + TypeScript**, reusing the existing FastAPI backend unchanged. This is the scaffold: a complete API client, the token-based auth flow, and minimal Timeline + Chat screens that prove the stack end-to-end.

> Lives on the `ios-app` branch so `main` stays free for production web/backend work.

## What's here

```
mobile/
├── app/                      # Expo Router file-based routes
│   ├── _layout.tsx           # Root layout = auth gate (init + redirect guard)
│   ├── index.tsx             # Splash → redirect by auth status
│   ├── login.tsx             # Email → 6-digit code sign-in
│   └── (tabs)/
│       ├── _layout.tsx       # Bottom tabs (Timeline / Chat)
│       ├── index.tsx         # Timeline list (paginated, pull-to-refresh)
│       └── chat.tsx          # Streaming chat (SSE)
├── src/
│   ├── config.ts             # API base URL resolution
│   ├── theme.ts              # Hindsite color tokens
│   ├── store/auth.ts         # Zustand auth store + SecureStore token
│   └── api/                  # Ported from frontend/src/api/*
│       ├── client.ts         # fetch wrapper w/ Bearer + 401 handling
│       ├── auth.ts           # request-code / exchange-code / me
│       ├── events.ts  threads.ts  people.ts
│       ├── chat.ts           # SSE via expo/fetch streaming
│       ├── uploads.ts        # presign + R2 PUT, EXIF/caption
│       └── types.ts
```

## Setup

```bash
cd mobile
npm install

# Reconcile native module versions to the installed Expo SDK (recommended —
# the versions in package.json target SDK 52 but expo install is authoritative):
npx expo install --fix

# Run it
npx expo start            # then press 'i' for the iOS simulator, or scan the
                          # QR code with Expo Go / a dev build on a device
```

Requires Xcode (for the iOS simulator) or the **Expo Go** app on a physical device.

## Pointing at a backend

Resolution order (see `src/config.ts`): `EXPO_PUBLIC_API_BASE_URL` env → `app.json` `expo.extra.apiBaseUrl` → `https://hindsite.app`.

- **Against production:** nothing to do — defaults to `https://hindsite.app`.
- **Against a local backend** (`docker compose up` on your Mac): copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to your Mac's **LAN IP** (`ipconfig getifaddr en0`), e.g. `http://192.168.1.20:8000`. Don't use `localhost` — on a device/simulator that resolves to the phone, not your Mac.
  - Native requests aren't browser-CORS-enforced, so you do **not** need to touch `CORS_ORIGINS` for the API. (R2 PUT uploads also bypass CORS on native.)
  - For quick UI testing without real email, set `AUTH_DISABLED=true` on the backend — `/me` then returns an authed dev admin and any token works.

## Auth flow

Native uses the email-code endpoints the backend already exposes for API clients (no cookies):

1. `POST /api/auth/request-code { email }` → emails a 6-digit code (always returns 200; the address must be allowlisted in the `users` collection to actually receive one).
2. `POST /api/auth/exchange-code { email, code }` → `{ token, email }`. The token is a 30-day `itsdangerous` session token.
3. Token is stored in the **Keychain via `expo-secure-store`** and sent as `Authorization: Bearer <token>` on every request (`src/api/client.ts`).
4. On launch, `useAuthStore.init()` reads the token and validates it against `GET /api/auth/me`. A 401 anywhere mid-session triggers `signOut()` and bounces to `/login`.

Google sign-in is **not** wired up yet — see roadmap.

## What works vs. what's next

**Working now**

- Email-code sign-in → persisted session → auto-login on relaunch → sign-out.
- Full REST client for events / threads / people / uploads (parity with the web `api/` layer).
- Timeline: paginated list (bidirectional cursor), pull-to-refresh, infinite scroll, thumbnails.
- Chat: live SSE token streaming via `expo/fetch`.
- Photo upload: full + thumbnail resize (`expo-image-manipulator`) → presigned R2 PUT. Server-side EXIF + AI caption helpers.

**Phase 2 (not yet built)**

- **Add/Edit event screen** — wire `uploads.ts` + `expo-image-picker` (already a dep) into a form. The API layer is ready; only UI is missing.
- **Native media thumbnails** for video / audio / PDF. The web app renders these client-side (canvas / Web Audio / pdf.js); native equivalents are `AVAssetImageGenerator`, a waveform render, and `PDFKit`. Until then `uploadMedia` uploads non-photos without a `thumb_key` (backend tolerates it).
- **Native document scan** — replace the web OpenCV-WASM path with VisionKit `VNDocumentCameraViewController` (far better, free on iOS).
- **Google Sign-In** — needs a backend endpoint that takes a Google ID token and returns a JSON session token (the current `/google/callback` is a cookie+302 web flow). Then native Google Sign-In or `expo-auth-session`.
- **Push notifications** ("on this day") — `expo-notifications` + a backend device-token registry.
- Threads/people management, search, filters, event detail with lightbox.

## Notes & gotchas

- **SSE needs `expo/fetch`**, not the global `fetch` — RN's built-in fetch has no streaming body. See `src/api/chat.ts`.
- **`TextDecoder`** is relied on for stream decoding; available in Hermes on SDK 52. If you target an older runtime, polyfill it.
- The token is the only persisted auth state; there's no refresh endpoint, so after 30 days the user re-enters a code. Add silent re-auth later if desired.
