-- Add the missing Organization → StripeEventLog FK. The tenancy fuzzer
-- in packages/db/src/tenancy.test.ts requires every model with an
-- `org_id` column to participate in TENANT_SCOPED_MODELS, and the
-- schema-convention pairing for that membership is a relation back to
-- Organization. onDelete: SetNull keeps the audit trail even if a
-- customer Org is later archived — Stripe events outlive customer rows.

ALTER TABLE "StripeEventLog"
    ADD CONSTRAINT "StripeEventLog_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
