import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LinksFunction,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  AppProvider,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FormLayout,
  InlineGrid,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import type { Env } from "../../load-context";
import { authenticate, isValidShop } from "~/lib/shopify.server";
import { loadOfflineSession } from "~/lib/session-storage.server";
import { shopifyAdmin } from "~/lib/shopify-api.server";
import { captureSetupStep } from "~/lib/merchant-qa.server";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadStats,
  pointsToCurrencyValue,
  saveSettings,
} from "~/lib/loyalty.server";

// Polaris stylesheet — scoped to this route via the `links` export so we
// don't pull it into every page in the app.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
];

// Embedded-admin loader. Per the app convention we DO NOT call
// authenticate.admin here — the very first GET from Shopify Admin has no
// Authorization header. Instead we read the offline session that
// /auth/callback persisted at install time, and bounce to OAuth if it's
// missing.
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context.cloudflare?.env ?? {}) as Env;
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop || !isValidShop(shop)) {
    throw new Response("Missing or invalid ?shop", { status: 400 });
  }
  const session = await loadOfflineSession(context, shop);
  if (!session) {
    throw redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  }

  // Shop display name + currency for nicer copy. The Admin API call goes
  // through the shopifyAdmin wrapper (captureApiError + retries). If it
  // fails we degrade to the raw domain rather than blocking the dashboard.
  let shopName = shop;
  let currencyCode = "USD";
  try {
    const api = shopifyAdmin({ env, session, shop });
    const data = await api.graphql<{
      shop: { name: string; currencyCode: string };
    }>(`{ shop { name currencyCode } }`);
    if (data?.shop?.name) shopName = data.shop.name;
    if (data?.shop?.currencyCode) currencyCode = data.shop.currencyCode;
  } catch {
    // captureApiError already fired inside shopifyAdmin.
  }

  const [settings, stats] = await Promise.all([
    loadSettings(env, shop),
    loadStats(env, shop),
  ]);

  return json({
    shop,
    shopName,
    currencyCode,
    settings,
    stats,
    apiKey: env.SHOPIFY_API_KEY ?? "",
    // Computed server-side: loyalty.server is a server-only module, so the
    // client component can't call its helpers — pass the value through.
    sampleRedeemValue: pointsToCurrencyValue(settings, 1000),
  });
}

// Settings form submit. This is an action invoked by App Bridge's
// authenticated fetch, so authenticate.admin (Bearer JWT) is the right
// auth path here.
export async function action({ request, context }: ActionFunctionArgs) {
  const { shop } = await authenticate.admin(request, context);
  const env = (context.cloudflare?.env ?? {}) as Env;
  const form = await request.formData();

  const programName =
    String(form.get("programName") ?? "").trim() || DEFAULT_SETTINGS.programName;
  const enabled = String(form.get("enabled") ?? "") === "true";
  const pointsPerDollar = clampNumber(
    form.get("pointsPerDollar"),
    DEFAULT_SETTINGS.pointsPerDollar,
    0,
    1000,
  );
  const redeemPointsPerCurrencyUnit = clampNumber(
    form.get("redeemPointsPerCurrencyUnit"),
    DEFAULT_SETTINGS.redeemPointsPerCurrencyUnit,
    1,
    100000,
  );
  const minRedeemPoints = clampNumber(
    form.get("minRedeemPoints"),
    DEFAULT_SETTINGS.minRedeemPoints,
    0,
    1000000,
  );

  const saved = await saveSettings(env, shop, {
    enabled,
    programName,
    pointsPerDollar,
    redeemPointsPerCurrencyUnit,
    minRedeemPoints,
  });

  // HARD requirement (CLAUDE.md): fire a setup-step at each merchant-facing
  // milestone so the AppApprove QA timeline records when settings are saved.
  await captureSetupStep(env, "loyalty_settings_saved", {
    shop,
    enabled: String(saved.enabled),
    pointsPerDollar: String(saved.pointsPerDollar),
  });

  return json({ ok: true as const, settings: saved });
}

function clampNumber(
  value: FormDataEntryValue | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: "Loyalty Rewards" },
  // App Bridge reads this meta tag to bootstrap the embedded app.
  { name: "shopify-api-key", content: data?.apiKey ?? "" },
];

export default function LoyaltyDashboard() {
  const { shopName, currencyCode, settings, stats, sampleRedeemValue } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(settings.enabled);
  const [programName, setProgramName] = useState(settings.programName);
  const [pointsPerDollar, setPointsPerDollar] = useState(
    String(settings.pointsPerDollar),
  );
  const [redeemRate, setRedeemRate] = useState(
    String(settings.redeemPointsPerCurrencyUnit),
  );
  const [minRedeem, setMinRedeem] = useState(String(settings.minRedeemPoints));

  const money = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(value);
  const number = (value: number) =>
    new Intl.NumberFormat(undefined).format(value);

  // Illustrative redemption value of a sample 1,000-point balance
  // (computed in the loader — see note there).
  const sampleValue = sampleRedeemValue;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page
        title="Loyalty Rewards"
        subtitle={`Earn points on every purchase, redeem at checkout — ${shopName}`}
      >
        <Layout>
          {actionData?.ok ? (
            <Layout.Section>
              <Banner tone="success" title="Settings saved">
                <p>Your loyalty program settings are live.</p>
              </Banner>
            </Layout.Section>
          ) : null}

          {!settings.enabled ? (
            <Layout.Section>
              <Banner tone="warning" title="Program is paused">
                <p>
                  Customers are not earning points right now. Enable the
                  program below to start rewarding purchases.
                </p>
              </Banner>
            </Layout.Section>
          ) : null}

          {/* Status overview */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Status overview
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                  <StatTile
                    label="Program"
                    value={settings.enabled ? "Active" : "Paused"}
                    badge={settings.enabled ? "success" : "warning"}
                  />
                  <StatTile label="Members" value={number(stats.members)} />
                  <StatTile
                    label="Points issued"
                    value={number(stats.totalPointsIssued)}
                  />
                  <StatTile
                    label="Earn rate"
                    value={`${number(settings.pointsPerDollar)} pt / ${money(1)}`}
                  />
                </InlineGrid>
                <Divider />
                <Text as="p" tone="subdued" variant="bodySm">
                  Redemption rate: {number(settings.redeemPointsPerCurrencyUnit)}{" "}
                  points = {money(1)}. A 1,000-point balance is worth{" "}
                  {money(sampleValue)} at checkout (minimum{" "}
                  {number(settings.minRedeemPoints)} points to redeem).
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Settings panel */}
          <Layout.Section>
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Program settings
                  </Text>

                  {/* Unchecked checkboxes don't submit a value, so mirror the
                      enabled state into a hidden field that always posts. */}
                  <input
                    type="hidden"
                    name="enabled"
                    value={enabled ? "true" : "false"}
                  />

                  <Checkbox
                    label="Enable loyalty program"
                    helpText="When on, customers earn points on every purchase."
                    checked={enabled}
                    onChange={setEnabled}
                  />

                  <FormLayout>
                    <TextField
                      label="Program name"
                      name="programName"
                      value={programName}
                      onChange={setProgramName}
                      autoComplete="off"
                      helpText="Shown on the customer-facing rewards page."
                    />

                    <FormLayout.Group>
                      <TextField
                        label={`Points earned per ${money(1)} spent`}
                        name="pointsPerDollar"
                        type="number"
                        min={0}
                        value={pointsPerDollar}
                        onChange={setPointsPerDollar}
                        autoComplete="off"
                        suffix="points"
                      />
                      <TextField
                        label={`Points to redeem ${money(1)}`}
                        name="redeemPointsPerCurrencyUnit"
                        type="number"
                        min={1}
                        value={redeemRate}
                        onChange={setRedeemRate}
                        autoComplete="off"
                        suffix="points"
                      />
                    </FormLayout.Group>

                    <TextField
                      label="Minimum points to redeem"
                      name="minRedeemPoints"
                      type="number"
                      min={0}
                      value={minRedeem}
                      onChange={setMinRedeem}
                      autoComplete="off"
                      suffix="points"
                      helpText="Customers must reach this balance before redeeming at checkout."
                    />
                  </FormLayout>

                  <Box>
                    <Button submit variant="primary" loading={saving}>
                      Save settings
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

function StatTile({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: "success" | "warning";
}) {
  return (
    <Box
      background="bg-surface-secondary"
      borderRadius="300"
      padding="400"
      minHeight="100%"
    >
      <BlockStack gap="100">
        <Text as="span" tone="subdued" variant="bodySm">
          {label}
        </Text>
        {badge ? (
          <Badge tone={badge}>{value}</Badge>
        ) : (
          <Text as="span" variant="headingLg">
            {value}
          </Text>
        )}
      </BlockStack>
    </Box>
  );
}
