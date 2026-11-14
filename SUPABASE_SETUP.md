# Supabase setup — Anime waifu

Project: `kzagpsiqmpxohpwjlmuo` (Singapore). No Vercel deployment is required.

## Deployed

- Profiles and companion preferences, owned by the authenticated user.
- Conversations and messages with indexed ownership constraints and cascade deletion.
- Row-level security on all app tables; anonymous access is denied.
- Atomic chat limits: 20 requests/minute and 100/day per account, stored in a private schema. Only the server role can consume quota.
- `companion-chat`: validates the bearer session with Supabase Auth, limits payload/history/output sizes, calls Gemini server-side, and saves only the current user's messages.
- `auth-complete`: a public static email-confirmation landing page.

The chat gateway setting `verify_jwt=false` is intentional: the function performs its own authentication with `/auth/v1/user` before any database or provider operation. This also allows CORS preflight and modern signing keys. It is not an unauthenticated chat API.

## Finish provider configuration

1. In **Edge Functions → Secrets**, set `GEMINI_API_KEY` and `GEMINI_MODEL` (the exact model ID supported by your Google account, without a `models/` prefix). Never put the private key in extension code or Git. The backend uses Google's Interactions API through a pinned server SDK; requests are not stored as Google Interactions (`store:false`). Model availability/billing depends on the provider account.
2. Create a Google OAuth **Web application** client in Google Cloud. Its authorized callback URI is `https://kzagpsiqmpxohpwjlmuo.supabase.co/auth/v1/callback`. Configure the consent screen and test users as required by Google.
3. In **Supabase Authentication → Sign-in providers → Google**, enable the provider and enter that client ID/secret. Keep the client secret there.
4. In **Authentication → URL Configuration**, allow:
   - `https://kzagpsiqmpxohpwjlmuo.supabase.co/functions/v1/auth-complete`
   - Your extension's exact `chrome.identity.getRedirectURL('supabase')` URL. For the unpacked project at the current development path this is `https://damdpmphkjmbipobpnkcfmgdlhnhlgii.chromiumapp.org/supabase`. Verify the extension ID in Chrome before saving; a Store release or different unpacked path can have a different ID.
5. Set the Site URL to an appropriate account landing page (the `auth-complete` URL above works for this initial setup). Keep email confirmation enabled.
6. Configure custom SMTP for production email confirmation/delivery. Supabase's default sender is restricted and is not a production email service. Do not disable confirmation merely to bypass email setup.

## Extension

Reload the extension and refresh existing tabs. Open **Account** for email/password signup/login, Google PKCE login, explicit save/load of preferences, chat, sign-out and chat-history deletion. New passwords must have at least 12 characters. Sync is manual to avoid silently overwriting local preferences; browser positions, hidden domains and custom model files stay local.

Sessions and PKCE verifiers live in extension-origin IndexedDB, not page-accessible storage. Cloud operations accept requests only from the extension popup. Only the public project URL and publishable key are shipped. Auth dependencies are bundled locally for Manifest V3; there is no remote JavaScript loading. The small auth bundle is registered at worker startup because Chrome disallows loading previously unregistered worker scripts after installation.

## Development and validation

`npm ci`, `npm run build:auth`, and `npm run test:cloud`. SQL migrations were created with the Supabase CLI and applied to the hosted project. Database transaction tests used temporary users/rows and rolled back: profile/message isolation, denied cross-user writes, conversation ownership, client quota denial and the 20-request quota boundary passed. HTTP tests confirm unauthenticated/invalid-session chat requests and anonymous data access are denied. Security advisors reported no findings after setup; indexes cover the chat history and ownership paths.

The actual unpacked extension loaded its Account UI and validated signup inputs without sending test emails. A complete signup/Google login and paid Gemini round trip still require the configuration above and a real user test. No private provider credentials were supplied or tested during setup.

References: [Supabase Google login](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [function secrets](https://supabase.com/docs/guides/functions/secrets), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Gemini text generation](https://aistudio.google.com/docs/text-generation).
