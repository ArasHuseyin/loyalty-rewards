import type { WebhookHandler } from "~/lib/appapprove-config";
import type { Env } from "../../load-context";
import {
  computePointsForOrder,
  earnPoints,
  loadSettings,
} from "~/lib/loyalty.server";

// orders/create — the heart of "earn points on every purchase". Shopify
// POSTs here when a new order is created; the webhook router
// (app/lib/webhook-router.server.ts) has already verified the HMAC
// signature before this handler runs, so we only deal with the parsed
// payload. We credit the order's customer with points based on the shop's
// configured earn rate.
//
// Subscribed to in shopify.app.toml + appapprove.config.ts. Requires the
// read_orders scope (already in [access_scopes]).
interface OrderCreatePayload {
  id: number;
  customer?: { id: number } | null;
  // Money fields arrive as decimal strings (e.g. "42.50"). We prefer the
  // subtotal (pre-tax, pre-shipping) so points track product spend.
  subtotal_price?: string;
  current_subtotal_price?: string;
  total_price?: string;
  currency?: string;
}

const handler: WebhookHandler = async ({ shop, payload, context }) => {
  const env = (context.cloudflare?.env ?? {}) as Env;
  const order = payload as OrderCreatePayload;

  const customerId = order.customer?.id;
  if (!customerId) {
    // Guest checkout — no customer record to credit. Ack with 200 so
    // Shopify doesn't retry a webhook we intentionally skipped.
    return new Response("OK (no customer)", { status: 200 });
  }

  const settings = await loadSettings(env, shop);
  const amount = Number(
    order.subtotal_price ??
      order.current_subtotal_price ??
      order.total_price ??
      "0",
  );
  const points = computePointsForOrder(settings, amount);
  await earnPoints(env, shop, String(customerId), points);

  return new Response("OK", { status: 200 });
};

export default handler;
