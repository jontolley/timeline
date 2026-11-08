# Hindsite — iOS / mobile app (Expo)

A native React Native client for Hindsite, built with **Expo SDK 58 (React Native 0.88) + Expo Router + TypeScript**, reusing the existing FastAPI backend unchanged. This is the scaffold: a complete API client, the token-based auth flow, and minimal Timeline + Chat screens that prove the stack end-to-end.

> Lives on the `ios-app` branch so `main` stays free for production web/backend work.

## What's here

```
mobile/
├── src/
│   ├── app/                  # Expo Router file-based routes
│   │   ├── _layout.tsx       # Root Stack = auth gate (Stack.Protected guards + splash hold)
│   │   ├── login.tsx         # Email → 6-digit code sign-in, or Continue with Google
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx   # Native tabs (system tab bar, SF Symbols)
│   │   │   ├── index.tsx     # Timeline: season-coloured time axis, sticky years, year scrubber
│   │   │   └── chat.tsx      # Streaming chat (SSE) + source / pending-edit / event cards
│   │   ├── search.tsx        # Keyword search (GET /events/search), "#tag" = exact tag
│   │   ├── filters.tsx       # Filters sheet (threads, people, sort) shared by Timeline + Search
│   │   └── event/            # new.tsx, [id]/index.tsx (detail), [id]/edit.tsx
│   ├── components/EventForm.tsx  # Shared create/edit form
│   ├── components/LocationPicker.tsx, PeoplePicker.tsx  # The form's place + people sheets
│   ├── config.ts             # API base URL resolution
│   ├── components/EventCard.tsx  # Timeline cards (photo/video/map/audio/doc/note), CompactRow, MapThumb
│   ├── components/YearScrubber.tsx  # Right-edge year scrubber (drag + haptics)
│   ├── components/VoiceRecorder.tsx  # expo-audio voice-note recorder for the form
│   ├── components/ui.tsx     # Buttons, RowIcon, Avatar, Waveform, Skeleton, EmptyState
│   ├── lib/format.ts         # UTC date / place / media helpers shared by the screens
│   ├── store/filters.ts      # Shared Timeline + Search filters
│   ├── theme.ts              # Harbor palette tokens, fonts (Lato), seasons
│   ├── store/auth.ts         # Zustand auth store + SecureStore token
│   └── api/                  # Ported from frontend/src/api/*
│       ├── client.ts         # fetch wrapper w/ Bearer + 401 handling
│       ├── auth.ts           # request-code / exchange-code / me
│       ├── events.ts  threads.ts  people.ts
│       ├── chat.ts           # SSE via the (streaming) global fetch
│       ├── uploads.ts        # presign + R2 PUT, EXIF/caption
│       └── types.ts
├── modules/hindsite-documents/  # Local Expo module (Swift): document scan, photos → PDF, PDF page count + page-1 thumb
├── modules/hindsite-places/     # Local Expo module (Swift): Apple Maps place search (MapKit) for the Place sheet
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
2. `POST /api/auth/exchange-code { email, code }` → `{ token, email }`. The token is a signed id for a server-side session that lasts while it's used (90 days idle); signing out calls `POST /api/auth/logout` so it dies on the server too.
3. Token is stored in the **Keychain via `expo-secure-store`** and sent as `Authorization: Bearer <token>` on every request (`src/api/client.ts`).
4. On launch, `useAuthStore.init()` reads the token and validates it against `GET /api/auth/me`. A 401 anywhere mid-session triggers `signOut()` and bounces to `/login`.

**Continue with Google** reuses the website's OAuth flow instead of the native Google SDK (so there's no iOS client to set up in Google Cloud Console): `signInWithGoogle()` makes a PKCE verifier/challenge (`expo-crypto`), opens `/api/auth/google/start?client=app&challenge=…` in an `ASWebAuthenticationSession` (`expo-web-browser`'s `openAuthSessionAsync`), and waits for the backend to redirect to `hindsite://auth?code=…` (or `?error=cancelled|failed|unauthorized`). It then swaps the one-time code plus the verifier at `POST /api/auth/google/app-exchange` for the same `{ token, email }` as the email flow. Locally, Google sends the browser back to `http://localhost:3000/api/auth/google/callback`, so the Docker `frontend` (nginx on :3000) has to be running for it to finish.

App Store note: guideline 4.8 expects Sign in with Apple alongside a third-party login like Google before review (it needs the paid developer account).

## What works vs. what's next

**Working now**

- Email-code or Google sign-in → persisted session → auto-login on relaunch → sign-out.
- Full REST client for events / threads / people / uploads (parity with the web `api/` layer).
- Timeline: paginated list (bidirectional cursor), pull-to-refresh, infinite scroll, thumbnails.
- Chat: live SSE token streaming, suggested questions on the empty screen, tappable source cards for the moments an answer drew on (the `sources` SSE event carries `items` — id, title, dates, kind, signed thumbnail — next to the plain `events` titles the web reads), the edit-confirm card, and tappable cards for events chat created or updated (which also refresh the Timeline). Tapping Update re-posts the transcript with a `confirm_edit` action, which the backend applies directly.
- **Search & filters** — `/search` (keyword search over titles, descriptions, places, people and tags; `#word` searches a tag; no results offers Chat) and the `/filters` sheet (threads, people, sort by when it happened / was added). Both read `src/store/filters.ts`, which the Timeline also applies to its list, year counts and cursors (`sortDateOf`).
- **Voice notes** — the form records audio with `expo-audio` (`VoiceRecorder.tsx`, AAC `.m4a` uploaded as `audio/mp4` with its `duration_seconds`); playback still opens the system player.
- Photo upload: full + thumbnail resize (`expo-image-manipulator`) → presigned R2 PUT. Server-side EXIF + AI caption helpers.
- **Event detail screen** — `src/app/event/[id]/index.tsx`, a read-only view opened by tapping a timeline card (pushed card with native back swipe). Full-bleed swipeable photo hero with glass Back / Share / Edit buttons, then thread + date, title, description, a grouped card of location (opens Maps) / people / tags / audio / PDF rows, and a thumbnail strip. Photos and videos open a full-screen viewer (`src/components/PhotoViewer.tsx`): swipe between items, pinch or double-tap to zoom, tap to hide the controls. Videos play in place with `expo-video` (native controls, inset below the Close button) and pause when swiped away. Audio plays inline (`src/lib/useRecordingPlayer.ts`, expo-audio); a PDF opens in `src/app/pdf.tsx`, a full-screen modal with a `react-native-webview` (WKWebView renders PDFs natively; links inside open in Safari). "Edit" pushes the form modal; reloads on focus so edits show on return, and bounces back to the timeline if the event was deleted underneath it. Shared (non-owned) events hide Edit/Delete.
- **Add / edit / delete event** — one shared form (`src/components/EventForm.tsx`), rendered by `src/app/event/new.tsx` (create) and `src/app/event/[id]/edit.tsx` (edit, opened from the detail screen). Both present as modals. Title / description / thread picker, plus:
  - **Date, time and end** — a start date with an optional time-of-day ("Time" switch) and an optional end ("End Date" switch), each edited with inline `@react-native-community/datetimepicker` pickers in UTC (no time = UTC midnight, the web's convention). Turning the time on starts at the current clock time; turning the end on adds an hour (or a day). Moving the start past the end drags the end along; saving with the end before the start is refused.
  - **Location** — opens `src/components/LocationPicker.tsx`, a sheet with an Apple Map (`expo-maps`, no API key; a native module, so adding it needed a rebuild). Search places with Apple Maps search (`searchPlaces` in `src/api/geocode.ts` → the local module `modules/hindsite-places`, MapKit `MKLocalSearch`, debounced like the web), centred on the moment's place or else the phone's last known position. MapKit wants every word to match a name and ranks exact text matches anywhere above nearby ones, so the module merges three passes: the query restricted to ~60 km around the centre, the same without generic words ("restaurant", "cafe"…), then the query anywhere; curly apostrophes are straightened first. OpenStreetMap / Nominatim (viewbox-biased) is the fallback for a build without the module, paste a Google / Apple Maps link (resolved by `POST /api/places/resolve`), or tap the map to drop a pin (reverse-geocoded). The name stays editable, so a pin can be called "Grandma's house". A new moment written from scratch (nothing shared in) starts on where the phone is: `src/lib/currentPlace.ts` asks for when-in-use location permission once (`expo-location`, string in `app.json`), takes a fix from the last 10 minutes or a fresh one within 10s, and reverse-geocodes it, like the web form's `navigator.geolocation` default. Best effort and quiet after a refusal; never replaces a place the user set, never runs on edit or for shared photos / links.
  - **People** — `src/components/PeoplePicker.tsx`, a checklist of the user's people with search; typing a new name offers "Add “Name”", which creates the person (`POST /api/people`, with a palette `color`, which the API requires) and selects them.
  - **Tags** — inline chips; Return or a comma adds one, tapping a chip removes it.
  - **Media** — photos and videos (Add Media; videos come back as recorded, no H.264 transcode), voice notes, and documents. A failed upload shows its reason in the form's error line.
  - **Documents** — "Add a document" (a row in the empty form, a tile in the media strip) offers **Scan with camera** (VisionKit's document camera, which crops and straightens each page; hidden where unsupported, e.g. the simulator), **Combine photos into a PDF** (photo picker with numbered picks = page order) and **Choose a PDF from Files** (`expo-document-picker`). Scans and combined photos are built into one PDF on the phone by `modules/hindsite-documents` (PDFKit: one page per image, long side 792pt, images ≤2000px stored as JPEG 0.85, like the web's combine-to-PDF). Every PDF uploads with its page count and a page-1 JPEG thumbnail (400px), the same `MediaRef` shape the web's pdf.js path produces; its tile shows that page with a document badge. The module is loaded with `requireOptionalNativeModule`, so a build without it just hides the option. The scanner needs `NSCameraUsageDescription`, set through `expo-image-picker`'s `cameraPermission` in `app.json`.

  Create holds photos locally and includes them in `createEvent`; edit attaches/removes photos immediately via the dedicated media endpoints (`EventUpdate` has no media field) and guards date/location so an untouched edit never clobbers an existing time or coords. Delete confirms via `Alert`. Shared (non-owned) events open read-only. All paths signal the Timeline to refresh (`src/store/timeline.ts`).
- **Share to Hindsite** — photos, videos, PDFs, map links and text shared from any app's share sheet open New Moment. The activation rule in `app.json` decides which share sheets list Hindsite; changing it needs a native rebuild. It's an `NSPredicate` string (`SUBQUERY … UTI-CONFORMS-TO …` for `public.image`, `public.movie`, `com.adobe.pdf`, `public.url`, `public.plain-text`) because the dictionary keys can't say "PDFs but not every file" — `supportsFileWithMaxCount` would list Hindsite for Word docs and zips too. `expo-sharing`'s iOS share extension copies media into the App Group (`group.app.hindsite.mobile`) and opens `hindsite://expo-sharing`; `src/app/+native-intent.ts` redirects that to `/event/new?shared=1`, which reads them via `useIncomingShare`:
  - **Photos / videos / PDFs** go to the form as `sharedAssets` (a PDF arrives as a `file` payload; other files are ignored) (resolved payloads with a local `contentUri`), after being **moved out of the App Group container into the app's cache** — uploads use expo-file-system's default *background* URLSession, whose system daemon couldn't read the App Group file on a real iPhone (the simulator doesn't enforce this, so it can't reproduce the failure). Like the web's "Event from photo or video", the first photo or video prefills the date and (reverse-geocoded through Nominatim, `src/api/geocode.ts`) the location — photo EXIF via the backend, video metadata on-device via `src/lib/videoMetadata.ts` (a port of the web parser, reading only the `moov` box through an `expo-file-system` `FileHandle`). No AI caption, and the title keeps focus. The share-sheet copies are deleted when New Moment closes.
  - **A Google / Apple Maps link** (from the Maps share button, as a URL or inside text) becomes `sharedLink`; the form resolves it via `POST /api/places/resolve` (`src/api/places.ts`) and uses that place as the location, overriding any media location. Any other shared text or link goes into the description (`sharedText`). Links and text come from the *raw* `sharedPayloads` — resolving a URL payload makes a network request and the resolved list comes back empty if it fails.

  **Cold launch:** when the share sheet starts the app, `/event/new?shared=1` arrives while the auth gate is still loading and hides that route, so expo-router falls back to the Timeline. `+native-intent.ts` flags the launch (`src/lib/shareLaunch.ts`, only when `initial`) and the root layout opens New Moment once `status` turns `authed`. A dev build can't reproduce this — the dev launcher swallows the launch URL — so test it with a Release build.

  Expo marks the feature experimental: the extension opens the main app rather than presenting its own UI. iOS may strip a video's location when sharing (share sheet → Options → Location).

**Phase 2 (not yet built)**

- **Media auto-fill in the form** — date/time/location prefill is wired only for shared photos and videos (see Share to Hindsite); photos added with Add Media and the AI caption helper (`describePhoto`) aren't used yet.
- **Native audio thumbnails** — video posters (`expo-video-thumbnails`) and PDF page-1 thumbs (`modules/hindsite-documents`) are done; audio still uploads without a `thumb_key` (the web renders a waveform with Web Audio; the backend tolerates its absence).
- **Sign in with Apple** — required next to Google for App Store review (guideline 4.8); needs the paid developer account for the capability.
- **Push notifications** ("on this day") — `expo-notifications` + a backend device-token registry.
- Threads/people management.

## Notes & gotchas

- **SSE relies on a streaming `fetch` body.** Since SDK 56 the global `fetch` is `expo/fetch`, which streams; setting `EXPO_PUBLIC_USE_RN_FETCH=1` would swap in RN's non-streaming fetch and break chat. See `src/api/chat.ts`.
- **An offline launch keeps you signed in.** `init()` only drops the stored token when `/me` *answers* `authenticated:false`; a network error or 5xx keeps the token and uses the cached profile. A real 401 on any later request still signs out.
- **Native tabs float over the screen.** On iOS 26 the tab bar overlays tab content, so a tab screen must leave room for it: scroll views use `contentInsetAdjustmentBehavior="automatic"` (Timeline), and fixed bottom UI sits inside a `SafeAreaView` with the `bottom` edge (Chat composer) — inside a tab, the native safe area includes the tab bar.
- **Dates are UTC calendar days.** The form holds UTC-midnight `Date`s; "today" is built from the *local* calendar day, and the date picker renders with `timeZoneName="UTC"`. A bare `new Date()` or a local-time picker shifts the day by one in US time zones.
- **Thread colors are palette keys** (`rose`, `cyan`, …), not CSS colors — always resolve them with `paletteColor()` from `theme.ts` (mirror of `frontend/src/utils/colors.js`).
- **No photo-library permission prompt.** `launchImageLibraryAsync` uses the out-of-process system picker, which needs no permission; don't add `requestMediaLibraryPermissionsAsync` back.
- **Fonts are one family per weight.** One typeface, Lato (Regular, Italic, Bold), loads from `@expo-google-fonts/lato` in the root layout, which holds the splash until it's ready. Hierarchy comes from size, weight and colour: headlines, labels and buttons are Bold, body and secondary text Regular. Lato has no 500/600/800, so several `font.*` roles share a weight; the role names (`serif`, `heavy`…) are left over from the old Fraunces + Nunito pairing. Use the `font.*` names from `theme.ts` and never add `fontWeight` — iOS would synthesize a fake bold. System UI (tab bar, alerts, action sheets) keeps SF Pro.
- **Light/dark is a token swap, set by one writer.** Every screen styles from `useTheme()` (`src/theme.ts`, `light` / `dark` palettes) via a `makeStyles(t)` + `useMemo` pair — never hardcode hex. The Account sheet's System / Light / Dark picker (`src/store/appearance.ts`) is the only caller of `Appearance.setColorScheme`, which overrides the native trait so the tab bar, date picker, alerts and `useColorScheme()` all follow; the choice persists across launches. `userInterfaceStyle` is `automatic`, so changing it again needs a native rebuild (`npx expo prebuild -p ios` then `npx expo run:ios`).
- **Liquid Glass controls** (`GlassButton` in `src/components/ui.tsx`) use `expo-glass-effect` and fall back to a translucent fill when `isLiquidGlassAvailable()` is false (pre-iOS 26).
- The token is the only persisted auth state; there's no refresh endpoint, so after 30 days the user re-enters a code. Add silent re-auth later if desired.
