# Connections

In Settings → Connectors, select Gmail, Google Calendar, Google Drive and/or Google Sheets, then click **Connect with Google**. Sign in in the system browser and approve only the permissions you want. The account appears after the token exchange and identity check succeed. Reconnect repeats that flow; Cancel sign-in stops the pending attempt. Old accounts without saved scope metadata are labeled unverified rather than claiming every service works.

One time, create a Google Cloud OAuth client of type **Desktop app**, enable the selected APIs, configure the consent screen and add your test account if the app is in Testing. Under App credentials, import the downloaded JSON or enter its ID and secret. Tokens/secrets are encrypted on this Mac and never returned to the renderer. An app in Testing can expire access after seven days; school/work administrators may restrict consent. Relay does not bundle a shared, verified Google app identity.

**Check connection** makes read-only requests to Gmail profile, primary-calendar event metadata and Drive file metadata. It reports each separately; it does not read message bodies or edit content. Sheets authorization is shown separately because an actual spreadsheet must be selected to test file access. Google Drive is currently read-only; Gmail sends, Calendar creates and Sheets appends use Relay's existing approval gates.

OAuth uses a loopback listener on 127.0.0.1, random state and PKCE, a timeout and a cancel control. A mismatched callback cannot complete or abort the legitimate sign-in. The browser's callback page tells you to return to Relay; it does not claim success before credentials are verified. Local/private mode prevents starting sign-in or connection checks.

Disconnect removes the local account and attempts to revoke its Google refresh token. If revocation fails, Relay reports that you may need to remove access in your Google account. Replacing app credentials with connected accounts asks before removing those local connections.

Tests use fake browsers/providers and isolated local data. Real consent, API enablement, school administrator restrictions and account capabilities still require the user's registered app and sign-in. No messages are sent, events created or personal files changed during tests.

## Notion

Create a public Notion connection in its developer portal and register `http://127.0.0.1:18790/notion/cb` exactly as its redirect URI. In Relay’s Notion App credentials, save the OAuth client ID and secret once. Then click **Connect with Notion**, sign in, and choose pages to share. If the provider rejects the local redirect for your app configuration, use the existing integration-token option while adjusting that registration; a hosted callback is not silently substituted.

Notion access/refresh tokens are encrypted, rotated on refresh and never sent to the renderer. Token renewal is shared between concurrent requests and cancelled if the connection changed. Existing internal integration tokens remain supported under Advanced. Check connection reads only the bot/workspace identity; actual page access depends on pages selected/shared and app capabilities. Disconnect removes local access but does not claim to revoke the provider’s grant: remove Relay in Notion too if you want to revoke it there.

Selecting local/private mode cancels pending browser sign-ins and removes cloud connector tools. A completed callback after cancellation cannot save a new connection. Real Notion public-app registration, browser consent and granted page access remain unverified without the user’s app credentials.
