-- Phase 1 of the Stripe self-serve onboarding work (ADR-0017).
--
-- Adds the Plan catalogue, the StripeEventLog idempotency table, and the
-- billing columns on Organization. All new Organization columns are
-- nullable or default-backed so existing rows survive the migration with
-- no app downtime. The data backfill (existing orgs → `internal` plan,
-- subscription_status = Internal) happens in packages/db/prisma/seed.ts,
-- run via `pnpm db:seed`.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PendingPayment', 'Trialing', 'Active', 'PastDue', 'Canceled', 'Incomplete', 'Internal');

-- CreateEnum
CREATE TYPE "ProvisionedVia" AS ENUM ('seeded', 'invite', 'self_serve');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "seat_limit" INTEGER NOT NULL DEFAULT 1,
    "quota_daily" INTEGER NOT NULL DEFAULT 50,
    "quota_monthly" INTEGER NOT NULL DEFAULT 300,
    "amount_monthly_usd" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "stripe_product_id" TEXT,
    "stripe_price_id_monthly" TEXT,
    "stripe_price_id_yearly" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEventLog" (
    "id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_created_at" TIMESTAMP(3) NOT NULL,
    "org_id" TEXT,
    "payload_summary" JSONB,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripe_product_id_key" ON "Plan"("stripe_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripe_price_id_monthly_key" ON "Plan"("stripe_price_id_monthly");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripe_price_id_yearly_key" ON "Plan"("stripe_price_id_yearly");

-- CreateIndex
CREATE INDEX "Plan_is_active_sort_order_idx" ON "Plan"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEventLog_stripe_event_id_key" ON "StripeEventLog"("stripe_event_id");

-- CreateIndex
CREATE INDEX "StripeEventLog_event_type_event_created_at_idx" ON "StripeEventLog"("event_type", "event_created_at");

-- CreateIndex
CREATE INDEX "StripeEventLog_org_id_idx" ON "StripeEventLog"("org_id");

-- AlterTable
ALTER TABLE "Organization"
    ADD COLUMN "plan_id" TEXT,
    ADD COLUMN "stripe_customer_id" TEXT,
    ADD COLUMN "stripe_subscription_id" TEXT,
    ADD COLUMN "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'Internal',
    ADD COLUMN "current_period_end" TIMESTAMP(3),
    ADD COLUMN "trial_end" TIMESTAMP(3),
    ADD COLUMN "billing_owner_user_id" TEXT,
    ADD COLUMN "provisioned_via" "ProvisionedVia" NOT NULL DEFAULT 'seeded';

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripe_customer_id_key" ON "Organization"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripe_subscription_id_key" ON "Organization"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "Organization_plan_id_idx" ON "Organization"("plan_id");

-- CreateIndex
CREATE INDEX "Organization_subscription_status_idx" ON "Organization"("subscription_status");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_billing_owner_user_id_fkey" FOREIGN KEY ("billing_owner_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
