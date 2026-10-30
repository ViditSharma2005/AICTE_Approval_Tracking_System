/**
 * Single source of truth for every controlled vocabulary in the system.
 * SQLite has no enums, so these constants ARE the schema's enums.
 */

export const ROLES = [
  "INSTITUTION",
  "SCRUTINY_OFFICER",
  "EVC_COORDINATOR",
  "EVC_MEMBER",
  "COMMITTEE_MEMBER",
  "COMPETENT_AUTHORITY",
  "COMPLIANCE_OFFICER",
  "REGIONAL_OFFICER",
  "BUREAU_OFFICER",
  "POLICY_ADMIN",
  "SYSTEM_ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  INSTITUTION: "Institution User",
  SCRUTINY_OFFICER: "Scrutiny Officer",
  EVC_COORDINATOR: "EVC Coordinator",
  EVC_MEMBER: "EVC Member",
  COMMITTEE_MEMBER: "Committee Member (SAC/SHC)",
  COMPETENT_AUTHORITY: "Competent Authority",
  COMPLIANCE_OFFICER: "Compliance Officer",
  REGIONAL_OFFICER: "Regional Officer",
  BUREAU_OFFICER: "Bureau Officer (Approval Bureau)",
  POLICY_ADMIN: "Policy Administrator",
  SYSTEM_ADMIN: "System Administrator",
};

/** Roles that see every region. */
export const NATIONAL_ROLES: Role[] = ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"];

// ---------------------------------------------------------------------------
// Workflow stages
// ---------------------------------------------------------------------------

export const STAGES = {
  SCRUTINY: {
    label: "Scrutiny",
    short: "Scrutiny",
    owner: "SCRUTINY_OFFICER",
    description: "Documentary verification of the application against APH provisions.",
  },
  INSTITUTION_RESPONSE: {
    label: "Awaiting Institution Reply",
    short: "Institution Reply",
    owner: "INSTITUTION",
    description: "Deficiency raised. The institution must respond within the stipulated time.",
  },
  RE_SCRUTINY: {
    label: "Re-Scrutiny",
    short: "Re-Scrutiny",
    owner: "SCRUTINY_OFFICER",
    description: "Officer verifies the institution's reply to the deficiency.",
  },
  EVC: {
    label: "Expert Visit Committee",
    short: "EVC",
    owner: "EVC_COORDINATOR",
    description: "Physical / virtual inspection of infrastructure, faculty and facilities.",
  },
  COMMITTEE: {
    label: "Committee Review (SAC/SHC)",
    short: "Committee",
    owner: "COMMITTEE_MEMBER",
    description: "Standing Committee appraisal and recommendation.",
  },
  DECISION: {
    label: "Final Decision",
    short: "Decision",
    owner: "COMPETENT_AUTHORITY",
    description: "Statutory decision: approve, conditionally approve or reject.",
  },
  COMPLETED: {
    label: "Completed",
    short: "Completed",
    owner: null,
    description: "Application disposed of. Compliance conditions continue to be tracked.",
  },
} as const;

export type StageKey = keyof typeof STAGES;
export const STAGE_KEYS = Object.keys(STAGES) as StageKey[];

/** Stages from which an officer may raise a deficiency / revert to the institution. */
export const REVERTABLE_STAGES: StageKey[] = ["SCRUTINY", "RE_SCRUTINY", "EVC", "COMMITTEE"];

// ---------------------------------------------------------------------------
// Application statuses
// ---------------------------------------------------------------------------

export const APP_STATUS = {
  IN_PROGRESS: { label: "In Progress", tone: "blue" as const },
  AWAITING_INSTITUTION: { label: "Awaiting Institution", tone: "amber" as const },
  APPROVED: { label: "Approved", tone: "green" as const },
  CONDITIONALLY_APPROVED: { label: "Conditionally Approved", tone: "violet" as const },
  REJECTED: { label: "Rejected", tone: "red" as const },
} as const;
export type AppStatus = keyof typeof APP_STATUS;

// ---------------------------------------------------------------------------
// Application types
// ---------------------------------------------------------------------------

export const APP_TYPES = {
  NEW_INSTITUTION: "New Institution (LOI / Approval)",
  RENEWAL: "Renewal of Approval (EoA)",
  EXTENSION_INTAKE: "Extension / Increase in Intake",
  NEW_COURSE: "Introduction of New Course",
} as const;
export type AppType = keyof typeof APP_TYPES;

export const INSTITUTION_TYPES = { NEW: "New", EXISTING: "Existing" } as const;

// ---------------------------------------------------------------------------
// Document register
// ---------------------------------------------------------------------------

export const DOC_TYPES = [
  "LEASE_DEED",
  "FIRE_SAFETY_CERTIFICATE",
  "LAND_CERTIFICATE",
  "BUILDING_PLAN_APPROVAL",
  "AFFILIATION_CERTIFICATE",
  "FACULTY_DECLARATION",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<string, string> = {
  LEASE_DEED: "Lease Deed",
  FIRE_SAFETY_CERTIFICATE: "Fire Safety Certificate",
  LAND_CERTIFICATE: "Land Ownership Certificate",
  BUILDING_PLAN_APPROVAL: "Building Plan Approval",
  AFFILIATION_CERTIFICATE: "University Affiliation Certificate",
  FACULTY_DECLARATION: "Faculty Declaration",
};

export const DOC_STATUS = {
  VALID: { label: "Valid", tone: "green" as const },
  EXPIRING_SOON: { label: "Expiring Soon", tone: "amber" as const },
  RENEWAL_SUBMITTED: { label: "Renewal Submitted", tone: "blue" as const },
  EXPIRED: { label: "Expired", tone: "red" as const },
} as const;

export const UNDERTAKING_STATUS = {
  PENDING: { label: "Pending", tone: "blue" as const },
  SUBMITTED: { label: "Awaiting Verification", tone: "indigo" as const },
  VERIFIED: { label: "Verified", tone: "green" as const },
  OVERDUE: { label: "Overdue", tone: "red" as const },
  ESCALATED: { label: "Escalated", tone: "red" as const },
} as const;

export const EVC_STATUS = {
  QUEUED: { label: "Queued", tone: "slate" as const },
  SCHEDULED: { label: "Scheduled", tone: "blue" as const },
  COMPLETED: { label: "Completed", tone: "green" as const },
  OVERDUE: { label: "Overdue", tone: "red" as const },
} as const;

export const ESCALATION_STATUS = { OPEN: "OPEN", RESOLVED: "RESOLVED" } as const;

// ---------------------------------------------------------------------------
// Deadline policy
// ---------------------------------------------------------------------------

/** Escalation ladder for applications: days overdue -> level -> role notified. */
export const ESCALATION_LADDER = [
  { level: 1, afterDays: 0, toRole: "REGIONAL_OFFICER" as Role, label: "Regional Officer" },
  { level: 2, afterDays: 3, toRole: "BUREAU_OFFICER" as Role, label: "Bureau Officer" },
  { level: 3, afterDays: 7, toRole: "BUREAU_OFFICER" as Role, label: "Approval Bureau Head" },
];

/** Reminder tiers (days before due) for undertakings. */
export const UNDERTAKING_REMINDER_TIERS = [7, 2, 0];

/** Alert tiers (days before expiry) for documents. */
export const DOC_ALERT_TIERS = [90, 60, 30, 7, 0];

/** Ageing buckets used across dashboards and reports. */
export const AGEING_BUCKETS = [
  { key: "0-7", label: "0–7 days", min: 0, max: 7, color: "#22C55E" },
  { key: "8-15", label: "8–15 days", min: 8, max: 15, color: "#84CC16" },
  { key: "16-30", label: "16–30 days", min: 16, max: 30, color: "#F59E0B" },
  { key: "30+", label: "> 30 days", min: 31, max: 1e9, color: "#EF4444" },
] as const;

export const DEFAULT_PASSWORD = "demo123";
