// Public surface for `@elc/db`. Keep this file thin.
//
// `.claude/rules/architecture.md` says no barrel files in performance-sensitive
// packages. This file is the deliberate exception: it re-exports only the two
// helpers and a handful of types — no `export * from "./client"` glob — so the
// rule's intent (avoid pulling in the world to read one symbol) holds.

export { withOrg, withSuperAdminContext, RoleRequiredError, TENANT_SCOPED_MODELS } from "./tenancy";
export type { OrgContext } from "./tenancy";
export { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
export { firstNameFrom } from "./display-name";
export { planRetire, planReopen, planDelete } from "./content-lifecycle";
export type {
  TestStatusName,
  TransitionDecision,
  DeleteDecision,
} from "./content-lifecycle";

export {
  isScheduleDue,
  isValidTimeZone,
  localDateKey,
  localDateTimeToUtc,
  localParts,
} from "./automation-schedule";
export type {
  DueCheckSchedule,
  LocalParts,
} from "./automation-schedule";

export { getLearnerDashboard } from "./learner-dashboard";
export type {
  LearnerDashboardData,
  SectionKey,
  SectionStat,
  ResumeAttempt,
  ResumeMockSession,
  RecentAttempt,
} from "./learner-dashboard";

export { updateMyIeltsTrack, hasInProgressWork } from "./profile";
export type { UpdateTrackFailureReason, UpdateTrackResult } from "./profile";

export {
  recordConsent,
  recordConsents,
  ensureConsentRecorded,
  getMyConsents,
  hasGrantedConsent,
} from "./consent";
export type { ConsentInput, ConsentSnapshot } from "./consent";

export {
  buildUserDataExport,
  createDataRightsRequest,
  listMyDataRightsRequests,
  requestErasure,
  cancelErasure,
  rectifyMyName,
  setAgeAssurance,
  recordGuardianConsent,
} from "./data-rights";
export type { UserDataExport } from "./data-rights";

export {
  DEFAULT_RECORDING_RETENTION_DAYS,
  ERASURE_GRACE_PERIOD_HOURS,
  purgeExpiredRecordings,
  processPendingErasures,
} from "./retention";
export type {
  DeleteObjectFn,
  PurgeRecordingsResult,
  ErasureResult,
} from "./retention";

export {
  INTERNAL_PLAN_SLUG,
  FREE_PLAN_SLUG,
  listPlansAsSuperAdmin,
  getPlanByIdAsSuperAdmin,
  getPlanBySlugAsSuperAdmin,
  createPlanAsSuperAdmin,
  updatePlanAsSuperAdmin,
  archivePlanAsSuperAdmin,
  reactivatePlanAsSuperAdmin,
  listPlansForCustomer,
  getActivePlanByIdForCustomer,
  getActivePlanBySlugForCustomer,
} from "./plans";
export type {
  PlanFailureReason,
  PlanResult,
  PlanCreateInput,
  PlanUpdateInput,
} from "./plans";

export {
  activateFreePlanForOrg,
  ensureStripeCustomerIdForOrg,
} from "./onboarding";
export type {
  OnboardingFailureReason,
  ActivateFreeResult,
  EnsureCustomerResult,
  CreateStripeCustomerFn,
} from "./onboarding";

export { provisionSelfServeOrg } from "./self-serve";
export type {
  SelfServeFailureReason,
  SelfServeProvisionResult,
  SelfServeProvisionInput,
  SelfServeProvisionOptions,
  CreateClerkOrgFn,
  CreateClerkOrgMembershipFn,
  DeleteClerkOrgFn,
} from "./self-serve";

export {
  getOrgBillingSnapshot,
  subscriptionStatusLabel,
  orgStatusLabel,
  PORTAL_ELIGIBLE_STATUSES,
} from "./billing";
export type {
  OrgBillingSnapshot,
  OrgBillingPlan,
} from "./billing";

export { syncPlanToStripe, decimalToCents } from "./plan-sync";
export type {
  PlanSyncResult,
  PlanSyncStripeClient,
  PlanSyncProductsAPI,
  PlanSyncPricesAPI,
  PlanSyncProduct,
  PlanSyncPrice,
} from "./plan-sync";

export {
  dispatchStripeEvent,
  applyCheckoutSessionCompleted,
  applyCustomerSubscriptionUpserted,
  applyCustomerSubscriptionDeleted,
  applyInvoicePaymentFailed,
  applyTrialWillEnd,
  mapSubscriptionStatus,
} from "./stripe-events";
export type {
  StripeEventEnvelope,
  StripeEventOutcome,
  StripeSubscriptionEvent,
  StripeCheckoutSessionEvent,
  StripeInvoiceEvent,
} from "./stripe-events";

export {
  CLERK_NEW_ORG_DEFAULTS,
  applyClerkUserUpsert,
  applyClerkUserDeleted,
  applyClerkOrgUpsert,
  applyClerkOrgDeleted,
  applyClerkMembershipUpsert,
  applyClerkMembershipDeleted,
  mapClerkRole,
  pickPrimaryEmail,
  joinName,
} from "./clerk-sync";
export type {
  ClerkUserPayload,
  ClerkOrgPayload,
  ClerkMembershipPayload,
  ClerkEmailAddress,
} from "./clerk-sync";

export {
  Prisma,
  type Role,
  type Track,
  type Section,
  type AttemptStatus,
  type TestStatus,
  type GraderKind,
  type OrgStatus,
  type SubscriptionStatus,
  type ProvisionedVia,
  type DataControllerModel,
  type DataResidencyRegion,
  type AgeAssurance,
  type ConsentType,
  type DataRightType,
  type DataRightStatus,
  type ConsentRecord,
  type DataRightsRequest,
  type Organization,
  type User,
  type Test,
  type Question,
  type Attempt,
  type Answer,
  type Grade,
  type Recording,
  type QuotaUsage,
  type ActivityLog,
  type Plan,
  type StripeEventLog,
} from "@prisma/client";
