# Supabase setup — Anime waifu

Project: `kzagpsiqmpxohpwjlmuo` (Singapore). No Vercel deployment is required.

## Deployed

- Profiles and companion preferences, owned by the authenticated user.
- Conversations and messages with indexed ownership constraints and cascade deletion.
- Row-level security on all app tables; anonymous access is denied.
- Atomic token-issuance limits: 20 starts/minute and 100/day per account, stored in a private schema. Only the server role can consume quota. These are session-start limits, not audio-minute billing limits.
- `companion-voice`: validates the bearer session with Supabase Auth and issues a single-use Gemini token, valid for ten minutes, with a one-minute connection-start window. Model, voice, persona, audio output and context compression are constrained on the server. The model is fixed to `gemini-3.8-live`; Extended Thinking is not used.
- `companion-chat`: retired; authenticated requests return HTTP 410 with an instruction to upgrade. It makes no AI calls.
- `auth-complete`: a public static email-confirmation landing page.

The voice gateway setting `verify_jwt=false` is intentional: the function performs its own authentication with `/auth/v1/user` before any quota or provider operation. This also allows CORS preflight and modern signing keys. It is not an unauthenticated token API.

## Finish provider configuration

1. In **Edge Functions → Secrets**, set **`GEMINI_API_KEY`**. No `GEMINI_MODEL` secret is required: the voice model is fixed in the backend. Any old `GEMINI_MODEL` value is ignored. Enable Gemini API access/billing for `gemini-3.8-live` in the Google project owning the key. Never put the private key in extension code or Git.
2. Create a Google OAuth **Web application** client in Google Cloud. Its authorized callback URI is `https://kzagpsiqmpxohpwjlmuo.supabase.co/auth/v1/callback`. Configure the consent screen and test users as required by Google.
3. In **Supabase Authentication → Sign-in providers → Google**, enable the provider and enter that client ID/secret. Keep the client secret there.
4. In **Authentication → URL Configuration**, allow:
   - `https://kzagpsiqmpxohpwjlmuo.supabase.co/functions/v1/auth-complete`
   - Your extension's exact `chrome.identity.getRedirectURL('supabase')` URL. For the unpacked project at the current development path this is `https://damdpmphkjmbipobpnkcfmgdlhnhlgii.chromiumapp.org/supabase`. Verify the extension ID in Chrome before saving; a Store release or different unpacked path can have a different ID.
5. Set the Site URL to an appropriate account landing page (the `auth-complete` URL above works for this initial setup). Keep email confirmation enabled.
6. Configure custom SMTP for production email confirmation/delivery. Supabase's default sender is restricted and is not a production email service. Do not disable confirmation merely to bypass email setup.

## Extension

Reload the extension and refresh existing tabs. Open **Account** for email/password signup/login, Google PKCE login, explicit save/load of preferences, voice, sign-out and deletion of previous text history. New passwords must have at least 12 characters. Sync is manual to avoid silently overwriting local preferences; browser positions, hidden domains and custom model files stay local.

Choose **Open voice conversation**, then **Start conversation** and allow microphone access. Voice runs in its own extension window so closing the dashboard popup does not end the call. Keep the voice window open. Mute stops microphone transmission; End call, closing the window, or the ten-minute deadline stops capture and playback. Signing out is checked every 30 seconds during a call. Network interruptions end the call with a clear retry action; automatic session resumption is not implemented in this release.

Microphone audio goes directly from the extension to Gemini over a constrained WebSocket, as 16 kHz mono PCM in 20 ms frames. Incoming native PCM speech is played without a transcription/TTS pipeline. Gemini interruption events discard queued playback. Seraphina uses Kore; Crimson uses Aoede. These are prebuilt native voices, not cloned voices. The window shows a speaking indicator; character mouth/lip animation is not yet driven by voice audio.

This extension does not save voice recordings or transcripts. Google's processing/retention terms still apply. Context compression bounds retained audio context; it does not make the API free or establish a hard dollar budget. Before public release, measure actual billed usage and set commercial minute limits/budget controls; the current session-start quota is only an abuse guard.

Voice personalities are selected on the server for each new call. Seraphina is around 25: mature, carefree and confident, teasing like a close friend with understated hints of attraction. Crimson is 24: impulsive, attention-seeking and dramatically affectionate, with brief playful jealousy and mock indignation. Both respect boundaries and real relationships; Crimson accepts a busy user or an ended call without guilt or pressure. Verify their delivery with real voice calls: a compliment, mention of another woman, a request to stop flirting, and "I need to go" should produce distinct but respectful responses. Existing calls keep their original persona until restarted.

Sessions and PKCE verifiers live in extension-origin IndexedDB, not page-accessible storage. Cloud operations accept requests only from the extension popup. Only the public project URL and publishable key are shipped. Auth dependencies are bundled locally for Manifest V3; there is no remote JavaScript loading. The small auth bundle is registered at worker startup because Chrome disallows loading previously unregistered worker scripts after installation.

## Development and validation

`npm ci`, `npm run build:auth`, `npm run test:voice`, and `npm run test:cloud`. Voice contract checks cover rejected auth/anonymous users, oversized payloads, missing configuration, quota exhaustion, fixed model/voice constraints, token expiration, PCM conversion, interruption playback cancellation, mute and end-call microphone cleanup. Live HTTP checks confirm unauthenticated/invalid-session voice requests and anonymous data access are denied. Database ownership and quota checks from the initial setup remain applicable; no schema changes were needed for voice.

The previous unpacked extension Account UI was tested without sending test emails. Voice tests use mocked capture/provider responses; a real microphone-to-Gemini round trip and Google login still require the private configuration above. No private provider credentials were supplied or tested during setup.

References: [Supabase Google login](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [function secrets](https://supabase.com/docs/guides/functions/secrets), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Gemini Live API](https://aistudio.google.com/docs/live-api), [ephemeral tokens](https://aistudio.google.com/docs/live-api/ephemeral-tokens).
