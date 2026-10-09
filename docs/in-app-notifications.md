# In-app notifications

Signed-in customers and staff have a notification bell in the main app bar on web and Android/iOS. The bell displays an unread count and opens the newest 100 notifications. Tap an order notification to mark it read and open the order. Individual and bulk read controls, manual refresh, and pull-to-refresh are available. Light, dark, and device themes use the existing app theme.

Updates refresh every 30 seconds while the app is in the foreground, when it resumes, and after closing the inbox. These are in-app updates, not OS push notifications. No WhatsApp integration or extra service is required.

| Event | Recipients |
| --- | --- |
| New collection order | Customer; active admin, manager, and sales staff except the person placing it |
| Bespoke quote accepted | Customer; active sales team and assigned designer/tailor except the actor |
| Required payment received | Customer payment receipt; sales team and assigned order staff receive confirmation |
| Production, ready, cancelled, completed | Customer; sales team, assigned designer/tailor, and assigned driver except the actor |
| Driver assigned | Assigned driver |
| Delivery update | Customer and related order team except the driver making the update |
| New design or appointment request | Customer acknowledgement; active admin and manager except the actor |
| Appointment update | Customer and assigned appointment staff; managers also receive customer cancellation alerts |
| Return requested | Customer acknowledgement; active admin, manager, and accountant |
| Return reviewed | Customer |

Existing quotation, fitting, and assignment notifications remain available in the inbox. Existing emails continue; additional staff fan-out is in-app only. Events and notification inserts share a database transaction, so rolled-back changes do not produce alerts. Existing checkout/payment idempotency prevents duplicate alerts on retries.

The API restricts list, unread-count, and read actions to the signed-in user. Order links still use the existing order authorization checks. Migration `003_in_app_notifications.sql` adds nullable order references and an unread index; it does not backfill order links on historical notifications. The standard API startup migration applies it during deployment.
