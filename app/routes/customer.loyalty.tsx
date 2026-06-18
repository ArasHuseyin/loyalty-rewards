import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/cloudflare";
import { Form, useLoaderData } from "@remix-run/react";

import type { Env } from "../../load-context";
import { authenticate } from "~/lib/shopify.server";
import { getBalance, loadSettings, pointsToCurrencyValue } from "~/lib/loyalty.server";

// Customer-facing rewards page — deliberately OUTSIDE the embedded admin
// surface. No admin JWT / App Bridge here; authenticate.public only
// validates the ?shop query param. A storefront link or the customer-
// account UI extension points shoppers here with ?shop=...&customer_id=...
// so they can see how the program works and check their balance.
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context.cloudflare?.env ?? {}) as Env;
  const { shop } = authenticate.public(request, context);
  const url = new URL(request.url);
  const customerId = (url.searchParams.get("customer_id") ?? "").trim();

  const settings = await loadSettings(env, shop);
  let balance: number | null = null;
  let redeemValue = 0;
  let canRedeem = false;
  if (customerId) {
    balance = await getBalance(env, shop, customerId);
    redeemValue = pointsToCurrencyValue(settings, balance);
    canRedeem = balance >= settings.minRedeemPoints;
  }

  return json({
    shop,
    customerId,
    balance,
    redeemValue,
    canRedeem,
    settings: {
      programName: settings.programName,
      enabled: settings.enabled,
      pointsPerDollar: settings.pointsPerDollar,
      redeemPointsPerCurrencyUnit: settings.redeemPointsPerCurrencyUnit,
      minRedeemPoints: settings.minRedeemPoints,
    },
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.settings.programName ?? "Loyalty Rewards" },
  {
    name: "description",
    content: "Check your loyalty points balance and learn how to earn and redeem rewards.",
  },
];

export default function CustomerLoyalty() {
  const { shop, customerId, balance, redeemValue, canRedeem, settings } =
    useLoaderData<typeof loader>();
  const num = (n: number) => new Intl.NumberFormat(undefined).format(n);
  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        minHeight: "100vh",
        background: "linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%)",
        padding: "2rem 1rem",
        color: "#1a1a1a",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <header style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.75rem", fontWeight: 600 }}>
            {settings.programName}
          </h1>
          <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
            Rewards at {shop}
          </p>
        </header>

        {!settings.enabled ? (
          <div
            style={{
              background: "#fff4e5",
              border: "1px solid #ffd8a8",
              borderRadius: 10,
              padding: "0.9rem 1.1rem",
              marginBottom: "1.25rem",
              fontSize: "0.9rem",
            }}
          >
            This rewards program is currently paused. Check back soon!
          </div>
        ) : null}

        {/* Balance card — only shown once a customer id has been provided. */}
        {balance !== null ? (
          <section
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "1.5rem",
              marginBottom: "1.25rem",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <p style={{ margin: "0 0 0.25rem", color: "#666", fontSize: "0.85rem" }}>
              Your points balance
            </p>
            <p style={{ margin: "0 0 0.5rem", fontSize: "2.5rem", fontWeight: 700, color: "#008060" }}>
              {num(balance)}
            </p>
            <p style={{ margin: 0, fontSize: "0.95rem", color: "#444" }}>
              Worth <strong>{money(redeemValue)}</strong> at checkout.
            </p>
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", color: canRedeem ? "#008060" : "#999" }}>
              {canRedeem
                ? "You have enough points to redeem on your next order."
                : `Earn ${num(Math.max(0, settings.minRedeemPoints - balance))} more points to start redeeming.`}
            </p>
          </section>
        ) : null}

        {/* Balance lookup — GET form so the result is shareable/bookmarkable. */}
        <section
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: "1.5rem",
            marginBottom: "1.25rem",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem", fontWeight: 600 }}>
            Check your balance
          </h2>
          <Form method="get" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <input type="hidden" name="shop" value={shop} />
            <label htmlFor="customer_id" style={{ fontSize: "0.85rem", fontWeight: 500, color: "#333" }}>
              Customer ID
            </label>
            <input
              id="customer_id"
              name="customer_id"
              type="text"
              defaultValue={customerId}
              placeholder="e.g. 1234567890"
              required
              style={{
                padding: "0.65rem 0.8rem",
                fontSize: "0.95rem",
                border: "1px solid #d0d0d0",
                borderRadius: 6,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "0.7rem",
                fontSize: "0.95rem",
                fontWeight: 500,
                color: "#fff",
                background: "#008060",
                border: 0,
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              View points
            </button>
          </Form>
        </section>

        {/* How it works */}
        <section
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: "1.5rem",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem", fontWeight: 600 }}>
            How it works
          </h2>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#444", fontSize: "0.92rem", lineHeight: 1.7 }}>
            <li>
              Earn <strong>{num(settings.pointsPerDollar)}</strong> point
              {settings.pointsPerDollar === 1 ? "" : "s"} for every{" "}
              {money(1)} you spend.
            </li>
            <li>
              Redeem <strong>{num(settings.redeemPointsPerCurrencyUnit)}</strong>{" "}
              points for {money(1)} off at checkout.
            </li>
            <li>
              Start redeeming once you reach{" "}
              <strong>{num(settings.minRedeemPoints)}</strong> points.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
