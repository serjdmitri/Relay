# Connect your services to Relay

Relay's **Connectors** page is where you manage Google, Notion, and a compatible HTTPS MCP service such as Composio. Connections in Codex or another app do not automatically connect Relay. When Relay uses a cloud AI provider, information retrieved to answer a request may be sent to that provider. Check the selected provider before asking about sensitive material.

## Gmail, Calendar, Drive, and Sheets

1. Open [Google Cloud Console](https://console.cloud.google.com/), select or create a project, and enable the Gmail API, Google Calendar API, Google Drive API, and Google Sheets API.
2. In Google Auth platform, configure the consent screen. For a personal external app in Testing, add each account you intend to connect under **Audience → Test users**. Configure the requested scopes if Google requires them. A school or workplace administrator may restrict the app or access.
3. Create an OAuth client for a **Desktop app**. In Relay, open **Connectors**, enter its client ID and secret in the Google section, and click **Save**. Do not send the secret in chat.
4. Click **Connect a Google account**, sign in in your browser, and review Google's permissions. Relay currently requests Gmail read and compose, Calendar events, Drive read, and Sheets access together. Connecting does not prove every service is working; try a read-only request such as “What is on my Google calendar this week?”
5. If your external OAuth app remains in Testing, Google may expire its refresh token after seven days; reconnect if necessary. If Drive or Sheets was added after an earlier connection, remove and reconnect the account after enabling those APIs.

Google references: [Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent), [OAuth 2.0 for installed applications and token expiration](https://developers.google.com/identity/protocols/oauth2).

## Notion

In Relay's **Connectors → Notion**, follow the instructions to create an internal integration in Notion, share the pages you want with that integration, and enter its secret in Relay's password field. Do not paste secrets into a conversation. Relay can access only pages the integration is allowed to see.

## Other connected apps

Relay's **Connectors → All your other apps** accepts a compatible HTTPS MCP URL and API key. Configure the service and authorize the specific apps in that service, then enter its URL and key in Relay. Available apps, account requirements, permissions, and pricing depend on the provider. Test with a read-only query before relying on actions.

## macOS permissions and school assignments

Open Relay's **Permissions** page for the permissions required by the features you use. Grant permissions in macOS System Settings only when you are comfortable with them; a successful connection is not proof that every action has been tested. The school briefing uses a configured school URL and a signed-in Firefox tab; your school can restrict automated access.

## Phone remote

Open **Remote** in Relay, create or refresh the pairing code, and follow the on-screen instructions on the phone. If an old Home Screen icon displays a black screen, scan a fresh pairing code and first open its link in Safari. Keep pairing links and codes private.
