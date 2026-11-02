# Fitbit / Google Health

Say “show my Fitbit stats” or use Connections → Open Fitbit stats. The sharp, translucent panel is draggable, resizable, supports hand movement and the existing throw/undo controls. It displays seven civil days of steps and daily average heart rate, with a selectable ending date and account. It never pretends this is a live Bluetooth reading. Missing values remain missing, and zero is preserved when Google actually reports zero.

## One-time setup

1. In the Google Cloud project used for Relay's Desktop OAuth client, enable **Google Health API** and configure the consent screen/test users as Google requires. Import/save that client in Relay's existing Google app setup if needed.
2. In Relay → Connections select **Fitbit / Google Health** (off by default), click **Connect with Google**, and sign in using the Google account linked to your Fitbit. Allow the two read-only activity and health-metrics permissions. Other Google services are optional.
3. Sync your Fitbit in its mobile app, then open the stats menu and press Refresh. If Google denies the request, check API enablement, account eligibility and approved permissions; reconnect after changing scopes. Production sharing may require Google's verification. This implementation does not bypass that process.

Sources: [device support](https://developers.google.com/health/data-types), [setup](https://developers.google.com/health/setup), [daily aggregation](https://developers.google.com/health/aggregate-data).

Data comes from Google Health's `google-wearables` source family, which can include other Google/Fitbit wearables linked to the same account. The chart is not guaranteed to be exclusively from one Air. Today's figures may be incomplete. “Retrieved” is the request time, not a claimed device sync time. Sleep, readiness, medical interpretation and live Bluetooth are not implemented.

## Privacy and limits

Read-only scopes; aggregation POSTs do not modify records. Health statistics are fetched only for this menu, kept in memory, and never included in model tools, session notes, memory exports, action logs or speech replies. Google receives authenticated read requests. Authorization uses Relay's existing encrypted credential store. Local/private mode blocks retrieval; changing provider or Google configuration closes the panel and cancels in-flight retrieval. Closing the panel cancels retrieval. Refresh errors never display Google's raw response bodies. No new SDK or background service.

Verified with provider fixtures and native Electron UI: explicit opt-in, dates across DST, zero vs missing, partial permission failure, disconnected/ambiguous accounts, account changes during refresh, narrow layout, Refresh, Connections and close. Actual Fitbit/Google consent and real Air readings require the user's account setup and are not verified by fixture tests.
