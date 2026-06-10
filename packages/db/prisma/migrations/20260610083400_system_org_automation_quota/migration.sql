-- Data migration (ADR-0024): the system org is the quota bucket for
-- scheduled content automation. Seeded dev DBs get this via seed.ts;
-- production only runs migrations, so bump it here too.
UPDATE "Organization" SET "quota_daily" = 2000 WHERE "id" = 'system' AND "quota_daily" = 0;
