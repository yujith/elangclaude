-- Phase 5 follow-up: token-level AI cost.
--
-- AiCallLog records one row per successful gateway call (chat / realtime
-- mint / TTS / transcribe). QuotaUsage stays the per-user-per-day quota
-- primitive; this table is the money primitive. Pricing lives in
-- packages/ai/src/pricing.ts. Unknown models log with cost_usd = 0 and
-- surface a console.warn.

CREATE TABLE "AiCallLog" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiCallLog_org_id_idx" ON "AiCallLog"("org_id");
CREATE INDEX "AiCallLog_org_id_createdAt_idx" ON "AiCallLog"("org_id", "createdAt");
CREATE INDEX "AiCallLog_org_id_purpose_idx" ON "AiCallLog"("org_id", "purpose");

ALTER TABLE "AiCallLog" ADD CONSTRAINT "AiCallLog_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiCallLog" ADD CONSTRAINT "AiCallLog_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
