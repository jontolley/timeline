# Hindsite — iOS / mobile app (Expo)

A native React Native client for Hindsite, built with **Expo SDK 58 (React Native 0.88) + Expo Router + TypeScript**, reusing the existing FastAPI backend unchanged. This is the scaffold: a complete API client, the token-based auth flow, and minimal Timeline + Chat screens that prove the stack end-to-end.

> Lives on the `ios-app` branch so `main` stays free for production web/backend work.

## What's here

```
mobile/
├── src/
│   ├── app/                  # Expo Router file-based routes
│   │   ├── _layout.tsx       # Root Stack = auth gate (Stack.Protected guards + splash hold)
│   │   ├── login.tsx         # Email → 6-digit code sign-in
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx   # Native tabs (system tab bar, SF Symbols)
│   │   │   ├── index.tsx     # Timeline list (paginated, pull-to-refresh)
│   │   │   └── chat.tsx      # Streaming chat (SSE) + pending-edit / event cards
│   │   └── event/            # new.tsx, [id]/index.tsx (detail), [id]/edit.tsx
│   ├── components/EventForm.tsx  # Shared create/edit form
│   ├── config.ts             # API base URL resolution
│   ├── theme.ts              # Hindsite color tokens
│   ├── store/auth.ts         # Zustand auth store + SecureStore token
│   └── api/                  # Ported from frontend/src/api/*
│       ├── client.ts         # fetch wrapper w/ Bearer + 401 handling
│       ├── auth.ts           # request-code / exchange-code / me
│       ├── events.ts  threads.ts  people.ts
│       ├── chat.ts           # SSE via the (streaming) global fetch
│       ├── uploads.ts        # presign + R2 PUT, EXIF/caption
│       └── types.ts
```

Imports use the `@/` alias for `src/` (see `tsconfig.json`).

## Setup

The app runs as a **development build** (`expo-dev-client`), not in Expo Go —
Expo Go only supports the newest SDK and can't carry the app's own native
config. `ios/` and `android/` are generated on demand (Continuous Native
Generation) and gitignored; configure native behavior via `app.json` plugins,
never by editing `ios/`.

Requires Xcode 26.4+ with an iOS Simulator runtime installed
(`xcodebuild -downloadPlatform iOS` if `xcrun simctl list devices available` is
empty) and CocoaPods (`brew install cocoapods`).

```bash
cd mobile
npm install

# First run, or after adding/upgrading a package with native code:
npx expo run:ios          # compiles + installs the dev build, then starts Metro

# Day-to-day (dev build already installed):
npx expo start --dev-client

npm run typecheck         # tsc --noEmit
npx expo-doctor           # dependency/config health check
```

Always add packages with `npx expo install <pkg>` so versions match the SDK.

## Pointing at a backend

Resolution order (see `src/config.ts`): `EXPO_PUBLIC_API_BASE_URL` env → `app.json` `expo.extra.apiBaseUrl` → `https://hindsite.app`.

- **Against production:** nothing to do — defaults to `https://hindsite.app`.
- **Against a local backend** (`docker compose up` on your Mac): copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to your Mac's **LAN IP** (`ipconfig getifaddr en0`), e.g. `http://192.168.1.20:8000`. Don't use `localhost` — on a device/simulator that resolves to the phone, not your Mac.
- **Release builds for your iPhone bake in whatever `.env` says.** `EXPO_PUBLIC_*` vars are inlined at bundle time, so a `.env` pointed at `localhost` ships a phone app that can't reach any server ("Could not connect to the server" at sign-in). Override it on the command line, which wins over `.env`:
  `EXPO_PUBLIC_API_BASE_URL=https://hindsite.app npx expo run:ios --device <udid> --configuration Release --no-bundler`
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
- Chat: live SSE token streaming, plus the edit-confirm card (Confirm / Choose another / Cancel → `confirm_edit` action) and tappable cards for events chat created or updated (which also refresh the Timeline).
- Photo upload: full + thumbnail resize (`expo-image-manipulator`) → presigned R2 PUT. Server-side EXIF + AI caption helpers.
- **Event detail screen** — `src/app/event/[id]/index.tsx`, a read-only view opened by tapping a timeline card (pushed card with native back swipe). Full-bleed swipeable photo hero with glass Back / Share / Edit buttons, then thread + date, title, description, a grouped card of location (opens Maps) / people / tags / audio / PDF rows, and a thumbnail strip. Photos open a full-screen viewer (`src/components/PhotoViewer.tsx`): swipe between items, pinch or double-tap to zoom, tap to hide the controls; videos/audio/PDFs open externally via `Linking`. "Edit" pushes the form modal; reloads on focus so edits show on return, and bounces back to the timeline if the event was deleted underneath it. Shared (non-owned) events hide Edit/Delete.
- **Add / edit / delete event** — one shared form (`src/components/EventForm.tsx`), rendered by `src/app/event/new.tsx` (create) and `src/app/event/[id]/edit.tsx` (edit, opened from the detail screen). Both present as modals. Title / date (UTC-safe) / description / location name / thread picker + photos. Create holds photos locally and includes them in `createEvent`; edit attaches/removes photos immediately via the dedicated media endpoints (`EventUpdate` has no media field) and guards date/location so an untouched edit never clobbers an existing time or coords. Delete confirms via `Alert`. Shared (non-owned) events open read-only. All paths signal the Timeline to refresh (`src/store/timeline.ts`).

**Phase 2 (not yet built)**

- **Richer event fields** — end-date range, time-of-day, tags, people pills, and a real location picker (the web uses Leaflet; native could use `react-native-maps` or stay name-only). EXIF/caption auto-fill helpers exist in `uploads.ts` but aren't wired into the form yet. The detail screen *renders* tags/people/ranges; the form can't yet *edit* them.
- **Inline media playback on the detail screen** — video/audio/PDF currently open in the system viewer via `Linking`. Native in-app playback would use `expo-video` / `expo-audio` (`expo-av` was removed in SDK 55) + a PDF viewer, plus the client-rendered thumbnails below so non-photo tiles aren't blank.
- **Native media thumbnails** for video / audio / PDF. The web app renders these client-side (canvas / Web Audio / pdf.js); native equivalents are `AVAssetImageGenerator`, a waveform render, and `PDFKit`. Until then `uploadMedia` uploads non-photos without a `thumb_key` (backend tolerates it).
- **Native document scan** — replace the web OpenCV-WASM path with VisionKit `VNDocumentCameraViewController` (far better, free on iOS).
- **Google Sign-In** — needs a backend endpoint that takes a Google ID token and returns a JSON session token (the current `/google/callback` is a cookie+302 web flow). Then native Google Sign-In or `expo-auth-session`.
- **Push notifications** ("on this day") — `expo-notifications` + a backend device-token registry.
- Threads/people management, search, filters, event detail with lightbox.

## Notes & gotchas

- **SSE relies on a streaming `fetch` body.** Since SDK 56 the global `fetch` is `expo/fetch`, which streams; setting `EXPO_PUBLIC_USE_RN_FETCH=1` would swap in RN's non-streaming fetch and break chat. See `src/api/chat.ts`.
- **An offline launch keeps you signed in.** `init()` only drops the stored token when `/me` *answers* `authenticated:false`; a network error or 5xx keeps the token and uses the cached profile. A real 401 on any later request still signs out.
- **Native tabs float over the screen.** On iOS 26 the tab bar overlays tab content, so a tab screen must leave room for it: scroll views use `contentInsetAdjustmentBehavior="automatic"` (Timeline), and fixed bottom UI sits inside a `SafeAreaView` with the `bottom` edge (Chat composer) — inside a tab, the native safe area includes the tab bar.
- **Dates are UTC calendar days.** The form holds UTC-midnight `Date`s; "today" is built from the *local* calendar day, and the date picker renders with `timeZoneName="UTC"`. A bare `new Date()` or a local-time picker shifts the day by one in US time zones.
- **Thread colors are palette keys** (`rose`, `cyan`, …), not CSS colors — always resolve them with `paletteColor()` from `theme.ts` (mirror of `frontend/src/utils/colors.js`).
- **No photo-library permission prompt.** `launchImageLibraryAsync` uses the out-of-process system picker, which needs no permission; don't add `requestMediaLibraryPermissionsAsync` back.
- **Light/dark is a token swap, set by one writer.** Every screen styles from `useTheme()` (`src/theme.ts`, `light` / `dark` palettes) via a `makeStyles(t)` + `useMemo` pair — never hardcode hex. The Account sheet's System / Light / Dark picker (`src/store/appearance.ts`) is the only caller of `Appearance.setColorScheme`, which overrides the native trait so the tab bar, date picker, alerts and `useColorScheme()` all follow; the choice persists across launches. `userInterfaceStyle` is `automatic`, so changing it again needs a native rebuild (`npx expo prebuild -p ios` then `npx expo run:ios`).
- **Liquid Glass controls** (`GlassButton` in `src/components/ui.tsx`) use `expo-glass-effect` and fall back to a translucent fill when `isLiquidGlassAvailable()` is false (pre-iOS 26).
- The token is the only persisted auth state; there's no refresh endpoint, so after 30 days the user re-enters a code. Add silent re-auth later if desired.
