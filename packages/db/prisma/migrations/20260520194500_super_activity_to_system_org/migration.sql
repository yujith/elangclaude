-- Data-only migration. Pairs with packages/db/src/system-org.ts and the
-- SuperAdmin console (Phase 1 of the SuperAdmin feature). No schema
-- changes; only re-parents historical rows so OrgAdmin activity feeds
-- stop showing SuperAdmin events.

-- 1. Ensure the singleton 'system' Organization exists. Idempotent.
--    Mirrors the upsert in packages/db/prisma/seed.ts; needed here so
--    the data move below has a valid FK target before db:seed runs.
INSERT INTO "Organization" (
  id,
  name,
  seat_limit,
  quota_daily,
  quota_monthly,
  status,
  "createdAt",
  "updatedAt"
)
VALUES (
  'system',
  'eLanguage Center (system)',
  0,
  0,
  0,
  'Archived',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2. Re-parent historical super-level ActivityLog rows under the system org.
--    All actions with these prefixes are super-level by construction
--    (no OrgAdmin or Learner code path writes them):
--      - content.*  : content moderation + generation events
--      - super.*    : org CRUD + future super-admin ops
UPDATE "ActivityLog"
SET org_id = 'system'
WHERE (action LIKE 'content.%' OR action LIKE 'super.%')
  AND org_id <> 'system';
