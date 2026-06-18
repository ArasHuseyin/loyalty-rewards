# Help center for Loyalty Rewards

## Common setup issues

- Missing shop parameter: open the app from Shopify admin.
- Billing inactive: Choose the recurring subscription test plan in /billing before using paid features.
- If setup is blocked: Open the app from Shopify admin so the embedded App Bridge session is established.
- If setup is blocked: Complete the admin dashboard setup and save settings before testing storefront or webhook behavior.
- Webhook issue: check /status and AppApprove deployment logs; every webhook must verify HMAC before processing.

## Feature FAQ

### admin-ui

Review the embedded admin dashboard, update settings, and verify saved values persist after reload. If this does not work, check /status and deployment logs before contacting support.

### webhook-handlers

Trigger each webhook topic listed below and confirm HMAC verification plus handler success in logs. If this does not work, check /status and deployment logs before contacting support.

### customer-facing-ui

Open the customer-facing route or storefront block in an incognito storefront session. If this does not work, check /status and deployment logs before contacting support.

## Billing FAQ

Choose the recurring subscription test plan in /billing before using paid features.

## Support

Contact the support email configured in SUPPORT_EMAIL and include your shop domain, setup step, selected surface (embedded-admin), and a short screen recording.
