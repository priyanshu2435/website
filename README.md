# PriceMatch

PriceMatch compares live online-store and quick-commerce offers. Shoppers can create an account, verify their email address with a one-time code, and save a product to receive an email when its live price drops.

## Run locally

Requires Node.js 20 or later.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure `SERPAPI_KEY` and SMTP settings.
3. Start the app with `npm start`.
4. Open `http://localhost:3000`.

Search results come only from the live provider. If the provider is unavailable or returns no matches, PriceMatch shows an error or empty result state instead of sample products.

The default SQLite database is stored at `data/pricematch.sqlite`. Keep this file on persistent storage: it holds accounts, email-verification tokens, saved alerts, sessions, and the generated local session-signing key. To use a different location, set `DATABASE_PATH`.

## Email and price alerts

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in the private `.env` file. For Brevo, use `smtp-relay.brevo.com`, port `587`, `SMTP_SECURE=false`, your Brevo SMTP login, and an SMTP key (not an API key). `SMTP_FROM` must be a sender address verified in Brevo; a display name such as `PriceMatch <sender@example.com>` is supported. Port 587 uses STARTTLS; port 465 normally uses `SMTP_SECURE=true`. Use an SMTP account allowed to send from `SMTP_FROM`; an address supplied by a shopper is never used as the sender.

If Brevo returns `525 5.7.1 Unauthorized IP address`, its SMTP security settings are rejecting the server's outbound IP. Allow the server's stable public egress IP in Brevo's authorized-IP settings, or adjust that restriction there, then resend the verification email.

Set `PUBLIC_BASE_URL` to the app's public HTTPS URL before deployment. Locally, keep it aligned with `PORT` (for example, `http://localhost:3000` with `PORT=3000`). Restart the server after changing `.env`; settings are read at startup. New accounts receive a 6-digit one-time verification code which expires after 5 minutes. Email verification is required before a price alert can be created.

The server checks active alerts every six hours. Checks use live Google Shopping data through SerpApi; a price alert cannot be created unless the selected store listing can be verified against a live result. A working SerpApi key and SMTP account are required for alert emails. The first live price is saved as the baseline, and a notification is sent when a later check finds a lower price. Failed email delivery does not advance that alert's price, so the next check can retry.

Each saved alert triggers a live product search every six hours. Monitor usage against the SerpApi plan when multiple alerts are active.

## Deployment

- Set `NODE_ENV=production`, `PUBLIC_BASE_URL` to the site's HTTPS URL, and `SESSION_SECRET` to a strong random value kept in the deployment secret store.
- Set `DATABASE_PATH` to a writable, persistent volume. A local SQLite file is intended for one app instance; use a shared client/server database before scaling to multiple instances.
- Configure `TRUST_PROXY` only when the app is behind the stated number of trusted reverse proxies.
- Provide SMTP and SerpApi credentials through the hosting provider's secret/environment settings; do not commit `.env` or database files.
