# Connections

In Settings → Connectors, select Gmail, Google Calendar, Google Drive, Google Docs and/or Google Sheets, then click **Connect with Google**. Sign in in the system browser and approve only the permissions you want. The account appears after the token exchange and identity check succeed. Reconnect repeats that flow; Cancel sign-in stops the pending attempt. Old accounts without saved scope metadata are labeled unverified rather than claiming every service works.

One time, create a Google Cloud OAuth client of type **Desktop app**, enable the selected APIs, configure the consent screen and add your test account if the app is in Testing. Under App credentials, import the downloaded JSON or enter its ID and secret. Tokens/secrets are encrypted on this Mac and never returned to the renderer. An app in Testing can expire access after seven days; school/work administrators may restrict consent. Relay does not bundle a shared, verified Google app identity.

**Check connection** makes read-only requests to Gmail profile, primary-calendar event metadata and Drive file metadata. It reports each separately; it does not read message bodies or edit content. Docs and Sheets authorization are shown separately because an actual spreadsheet must be selected to test file access. Google Drive is currently read-only; Gmail sends, Calendar creates, Docs appends and Sheets appends use Relay's existing approval gates.

OAuth uses a loopback listener on 127.0.0.1, random state and PKCE, a timeout and a cancel control. A mismatched callback cannot complete or abort the legitimate sign-in. The browser's callback page tells you to return to Relay; it does not claim success before credentials are verified. Local/private mode prevents starting sign-in or connection checks.

Disconnect removes the local account and attempts to revoke its Google refresh token. If revocation fails, Relay reports that you may need to remove access in your Google account. Replacing app credentials with connected accounts asks before removing those local connections.

Tests use fake browsers/providers and isolated local data. Real consent, API enablement, school administrator restrictions and account capabilities still require the user's registered app and sign-in. No messages are sent, events created or personal files changed during tests.

## Notion

Create a public Notion connection in its developer portal and register `http://127.0.0.1:18790/notion/cb` exactly as its redirect URI. In Relay’s Notion App credentials, save the OAuth client ID and secret once. Then click **Connect with Notion**, sign in, and choose pages to share. If the provider rejects the local redirect for your app configuration, use the existing integration-token option while adjusting that registration; a hosted callback is not silently substituted.

Notion access/refresh tokens are encrypted, rotated on refresh and never sent to the renderer. Token renewal is shared between concurrent requests and cancelled if the connection changed. Existing internal integration tokens remain supported under Advanced. Check connection reads only the bot/workspace identity; actual page access depends on pages selected/shared and app capabilities. Disconnect removes local access but does not claim to revoke the provider’s grant: remove Relay in Notion too if you want to revoke it there.

Selecting local/private mode cancels pending browser sign-ins and removes cloud connector tools. A completed callback after cancellation cannot save a new connection. Real Notion public-app registration, browser consent and granted page access remain unverified without the user’s app credentials.

## School / Blackbaud

Under School, save the HTTPS `myschoolapp.com/lms-assignment/assignment-center/student` link, then click **Connect school**. Relay opens or activates that assignment center in Firefox. Sign in using the school's own login there, with the Relay Firefox extension connected. Passwords are not collected by Relay, and no school API/admin privileges are assumed.

**Check connection** verifies only that the matching page can be read. **Show assignments** (or “check my assignments”) uses the selected model without tools to extract visible incomplete assignments, accepting only literal titles and dates from the source. The card links to the school page and identifies the check time. It does not claim that filters, pagination, or unloaded assignments were checked. Briefings and Plan today reuse the same check. Missing login/browser/page, invalid extraction, cancellation, provider changes and timeouts are reported instead of being treated as an empty list. Page text is not sent after an abandoned browser read finishes late.

Real Blackbaud completeness and sign-in remain for the user's school account to verify. Tests use fixture pages and do not submit or edit school work.

## Google Docs actions

Enable the Google Docs API in the same Cloud project, select Google Docs and reconnect to grant its Documents scope. `doc_read` reads bounded document text and lists tab IDs. `doc_append` shows an approval preview and appends to a selected tab, using a required revision when provided by Google. A multi-tab document requires an explicit tab choice; unknown tabs and invalid IDs are rejected before writing. Existing content is not replaced or deleted. A real document read/write has not been tested; tests use fake APIs and make no external modifications.
