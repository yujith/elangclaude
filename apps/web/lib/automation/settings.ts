// AutomationSettings access (ADR-0024).
//
// Single global row (id = "global"); absence means everything off — the
// safe default for a kill switch. Reads happen in two trust contexts:
// the CRON_SECRET-authed cron route (system job, raw prisma — same
// posture as retention.ts) and SuperAdmin pages/actions which have
// already passed requireRole("SuperAdmin").

import { prisma } from "@elc/db/client";

export const AUTOMATION_SETTINGS_ID = "global";

export type AutomationSettingsState = {
  generation_enabled: boolean;
  auto_publish_enabled: boolean;
};

export async function getAutomationSettings(): Promise<AutomationSettingsState> {
  const row = await prisma.automationSettings.findUnique({
    where: { id: AUTOMATION_SETTINGS_ID },
    select: { generation_enabled: true, auto_publish_enabled: true },
  });
  return {
    generation_enabled: row?.generation_enabled ?? false,
    auto_publish_enabled: row?.auto_publish_enabled ?? false,
  };
}
