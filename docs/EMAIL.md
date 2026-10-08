# Email notifications

Render Free blocks outbound SMTP ports 25, 465 and 587. Use Brevo's HTTPS
transactional endpoint (`https://api.brevo.com/v3/smtp/email`) on that plan.
SMTP remains available for local development and hosts that permit it.

## Hosted setup

1. Create or use a Brevo account and enable transactional email.
2. Add and verify your sender address in Brevo. For a business domain,
   authenticate its DNS records. Brevo may replace a free-mail sender address
   with its own compliant sender domain; verify the sender shown to recipients.
3. Generate a Brevo **API key**, not an SMTP key.
4. Add these variables to the **Render backend**, not Vercel:

```dotenv
EMAIL_PROVIDER=brevo
BREVO_API_KEY=YOUR_PRIVATE_BREVO_API_KEY
EMAIL_FROM=YOUR_VERIFIED_SENDER_EMAIL
EMAIL_FROM_NAME=Maison Munezero
```

5. Deploy the reviewed backend revision after merging its PR. Existing SMTP
   settings can remain, but `EMAIL_PROVIDER=brevo` selects HTTPS exclusively.
6. Request a fresh verification email from the app and inspect Brevo's
   transactional logs. Provider acceptance is not proof of inbox delivery;
   check delivery status and the spam folder.

Store keys directly in Render; never commit them or paste them into chat.
Check your Brevo account's sending limits and activation status before rollout.
No Render upgrade is required by this integration.

## Queue and retry behavior

All existing notification producers use the same outbox. Every 30 seconds,
while the API is running, the worker processes eligible messages. It marks
`sent_at` only after the provider acknowledges acceptance with a message ID.
HTTP failures, invalid acknowledgements and network errors remain queued,
with retries after 10 minutes and the existing maximum of 10 attempts.
Requests time out after 15 seconds and do not fall back to SMTP.

Logs contain `EMAIL_DELIVERY_FAILED`, provider, code and HTTP status; they
exclude email addresses, bodies, keys and raw provider responses.
401/403 usually require checking the API key, sender verification or account
activation. 429 indicates provider throttling; 5xx/network errors are temporary.

Existing pending messages will retry when their `next_at` is due. Old verification
or reset codes may already be expired: request fresh codes. Free services sleep
when idle, so background notifications can be delayed until the service wakes.

Delivery is at least once: if the provider accepts a request but its response
is lost, a retry can send a duplicate. `sent_at` records acceptance, not final
inbox delivery. This change does not add delivery webhooks or automatic replay
of exhausted messages.

## Local SMTP

Use `EMAIL_PROVIDER=smtp` (the default), `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` as before.
The SMTP connection and socket timeouts are bounded to 15 seconds.

References:
- https://render.com/docs/free
- https://developers.brevo.com/docs/send-a-transactional-email
- https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email

## Email appearance

Every queued notification is delivered as branded HTML plus its original
plain-text fallback, using both Brevo HTTPS and local SMTP. The layout uses
Maison Munezero's forest green, warm ivory, serif heading and atelier signature.
Account verification and password reset emails highlight the full one-time code
and retain the existing expiry and instructions. Codes are excluded from hidden
preview text. User-supplied subjects and messages are HTML-escaped.
No database migration or Brevo template configuration is needed.
