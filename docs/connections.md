# Connections

In Settings → Connectors, select Gmail, Google Calendar, Google Drive and/or Google Sheets, then click **Connect with Google**. Sign in in the system browser and approve only the permissions you want. The account appears after the token exchange and identity check succeed. Reconnect repeats that flow; Cancel sign-in stops the pending attempt. Old accounts without saved scope metadata are labeled unverified rather than claiming every service works.

One time, create a Google Cloud OAuth client of type **Desktop app**, enable the selected APIs, configure the consent screen and add your test account if the app is in Testing. Under App credentials, import the downloaded JSON or enter its ID and secret. Tokens/secrets are encrypted on this Mac and never returned to the renderer. An app in Testing can expire access after seven days; school/work administrators may restrict consent. Relay does not bundle a shared, verified Google app identity.

**Check connection** makes read-only requests to Gmail profile, primary-calendar event metadata and Drive file metadata. It reports each separately; it does not read message bodies or edit content. Sheets authorization is shown separately because an actual spreadsheet must be selected to test file access. Google Drive is currently read-only; Gmail sends, Calendar creates and Sheets appends use Relay's existing approval gates.

OAuth uses a loopback listener on 127.0.0.1, random state and PKCE, a timeout and a cancel control. A mismatched callback cannot complete or abort the legitimate sign-in. The browser's callback page tells you to return to Relay; it does not claim success before credentials are verified. Local/private mode prevents starting sign-in or connection checks.

Disconnect removes the local account and attempts to revoke its Google refresh token. If revocation fails, Relay reports that you may need to remove access in your Google account. Replacing app credentials with connected accounts asks before removing those local connections.

Tests use fake browsers/providers and isolated local data. Real consent, API enablement, school administrator restrictions and account capabilities still require the user's registered app and sign-in. No messages are sent, events created or personal files changed during tests.
