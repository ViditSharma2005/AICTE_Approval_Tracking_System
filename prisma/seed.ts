/**
 * Seed script — engineers a demo narrative, not random rows.
 *
 *   npm run db:seed        (or `npm run db:reset` to wipe and reseed)
 *
 * Everything is deterministic (seeded PRNG), and all timestamps are expressed in
 * "days" through the demo-aware time helpers, so the same dataset behaves
 * identically in real-time mode and in DEMO_MODE time compression.
 *
 * At the end it runs a real scheduler tick, so the escalations, reminders and
 * expiry alerts you see on first login are produced by the actual engine.
 */

import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { addDays, daysBetween, DEMO_MODE } from "../src/lib/time";
import { toJson } from "../src/lib/json";
import { audit } from "../src/lib/audit";
import { runSchedulerTick } from "../src/lib/scheduler";
import { recomputeTrustScore, TRUST_DELTAS } from "../src/lib/trust";
import { extractDocumentData, encodeSummary } from "../src/lib/ocr";
import { issueMagicLink, magicLinkPath } from "../src/lib/magic";
import { templateSlas, templateStages } from "../src/lib/workflow";
import type { StageKey } from "../src/lib/constants";

const PASSWORD = "demo123";
const now = () => new Date();

// deterministic pseudo-randomness -------------------------------------------
let seed = 20260226;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

// ---------------------------------------------------------------------------

const REGIONS = [
  { name: "Northern Region", code: "NR" },
  { name: "Southern Region", code: "SR" },
  { name: "Eastern Region", code: "ER" },
  { name: "Western Region", code: "WR" },
];

const INSTITUTIONS = [
  { name: "St. Mary's Institute of Technology", city: "Ghaziabad", state: "Uttar Pradesh", type: "EXISTING", region: "NR", lat: 28.6692, lng: 77.4538 },
  { name: "Delhi Institute of Engineering & Technology", city: "New Delhi", state: "Delhi", type: "EXISTING", region: "NR", lat: 28.6139, lng: 77.209 },
  { name: "Himalayan Institute of Technology", city: "Dehradun", state: "Uttarakhand", type: "NEW", region: "NR", lat: 30.3165, lng: 78.0322 },
  { name: "Western College of Engineering", city: "Pune", state: "Maharashtra", type: "EXISTING", region: "WR", lat: 18.5204, lng: 73.8567 },
  { name: "Sapphire Institute of Management", city: "Mumbai", state: "Maharashtra", type: "EXISTING", region: "WR", lat: 19.076, lng: 72.8777 },
  { name: "Deccan Technical Campus", city: "Nashik", state: "Maharashtra", type: "NEW", region: "WR", lat: 19.9975, lng: 73.7898 },
  { name: "Southern Institute of Technology", city: "Coimbatore", state: "Tamil Nadu", type: "EXISTING", region: "SR", lat: 11.0168, lng: 76.9558 },
  { name: "Coromandel Engineering College", city: "Chennai", state: "Tamil Nadu", type: "EXISTING", region: "SR", lat: 13.0827, lng: 80.2707 },
  { name: "Nilgiri Institute of Science", city: "Bengaluru", state: "Karnataka", type: "NEW", region: "SR", lat: 12.9716, lng: 77.5946 },
  { name: "Eastern Technical University", city: "Kolkata", state: "West Bengal", type: "EXISTING", region: "ER", lat: 22.5726, lng: 88.3639 },
  { name: "Brahmaputra Institute of Technology", city: "Guwahati", state: "Assam", type: "EXISTING", region: "ER", lat: 26.1445, lng: 91.7362 },
  { name: "Utkal College of Engineering", city: "Bhubaneswar", state: "Odisha", type: "NEW", region: "ER", lat: 20.2961, lng: 85.8245 },
];

const USERS: {
  email: string;
  name: string;
  role: string;
  designation: string;
  region?: string;
  institution?: number;
}[] = [
  // Institutions
  { email: "college@stmarys.edu", name: "Dr. Anita Sharma", role: "INSTITUTION", designation: "Principal", institution: 0 },
  { email: "principal@wce.ac.in", name: "Prof. Rajesh Iyer", role: "INSTITUTION", designation: "Principal", institution: 3 },
  { email: "director@sit.edu.in", name: "Dr. Meenakshi Rao", role: "INSTITUTION", designation: "Director", institution: 6 },
  { email: "registrar@easterntech.ac.in", name: "Shri Tapas Ghosh", role: "INSTITUTION", designation: "Registrar", institution: 9 },

  // Scrutiny officers (note: two in the West to make the workload imbalance visible)
  { email: "scrutiny.north@aicte.gov.in", name: "Smt. Kavita Nair", role: "SCRUTINY_OFFICER", designation: "Scrutiny Officer", region: "NR" },
  { email: "scrutiny.west@aicte.gov.in", name: "Shri Anil Deshpande", role: "SCRUTINY_OFFICER", designation: "Scrutiny Officer", region: "WR" },
  { email: "scrutiny.west2@aicte.gov.in", name: "Smt. Farah Qureshi", role: "SCRUTINY_OFFICER", designation: "Scrutiny Officer", region: "WR" },
  { email: "scrutiny.south@aicte.gov.in", name: "Shri Venkatesh Pillai", role: "SCRUTINY_OFFICER", designation: "Scrutiny Officer", region: "SR" },
  { email: "scrutiny.east@aicte.gov.in", name: "Smt. Ruma Bhattacharya", role: "SCRUTINY_OFFICER", designation: "Scrutiny Officer", region: "ER" },

  // EVC
  { email: "evc.north@aicte.gov.in", name: "Shri Sanjay Mehta", role: "EVC_COORDINATOR", designation: "EVC Coordinator", region: "NR" },
  { email: "evc.west@aicte.gov.in", name: "Dr. Priya Kulkarni", role: "EVC_COORDINATOR", designation: "EVC Coordinator", region: "WR" },
  { email: "expert1@aicte.gov.in", name: "Dr. Arvind Menon", role: "EVC_MEMBER", designation: "Expert Member", region: "NR" },
  { email: "expert2@aicte.gov.in", name: "Prof. Sneha Joshi", role: "EVC_MEMBER", designation: "Expert Member", region: "WR" },
  { email: "expert3@aicte.gov.in", name: "Dr. Imran Sheikh", role: "EVC_MEMBER", designation: "Expert Member", region: "SR" },

  // Committee
  { email: "committee@aicte.gov.in", name: "Prof. Vikas Bhandari", role: "COMMITTEE_MEMBER", designation: "Member, Standing Appellate Committee", region: "NR" },
  { email: "committee.west@aicte.gov.in", name: "Prof. Neha Gaikwad", role: "COMMITTEE_MEMBER", designation: "Member, Standing Hearing Committee", region: "WR" },

  // Decision
  { email: "authority@aicte.gov.in", name: "Shri Rakesh Bhatnagar", role: "COMPETENT_AUTHORITY", designation: "Competent Authority (Member Secretary)" },

  // Compliance
  { email: "compliance.north@aicte.gov.in", name: "Smt. Sunita Rawat", role: "COMPLIANCE_OFFICER", designation: "Compliance Officer", region: "NR" },
  { email: "compliance.west@aicte.gov.in", name: "Shri Mahesh Patil", role: "COMPLIANCE_OFFICER", designation: "Compliance Officer", region: "WR" },

  // Supervisory
  { email: "regional.north@aicte.gov.in", name: "Shri Devendra Singh", role: "REGIONAL_OFFICER", designation: "Regional Officer", region: "NR" },
  { email: "regional.west@aicte.gov.in", name: "Smt. Ashwini Kale", role: "REGIONAL_OFFICER", designation: "Regional Officer", region: "WR" },
  { email: "bureau@aicte.gov.in", name: "Shri Manoj Trivedi", role: "BUREAU_OFFICER", designation: "Officer, Approval Bureau" },

  // Administration
  { email: "policy@aicte.gov.in", name: "Smt. Lakshmi Subramanian", role: "POLICY_ADMIN", designation: "Policy Administrator" },
  { email: "admin@aicte.gov.in", name: "Shri Vikram Sethi", role: "SYSTEM_ADMIN", designation: "System Administrator" },
];

// --- Feature 4: empanelled expert pool -------------------------------------
const EXPERTS: {
  name: string;
  designation: "PROFESSOR_LEVEL" | "ASSOCIATE_PROF" | "ARCHITECT_CIVIL";
  city: string;
  state: string;
  lat: number;
  lng: number;
  conflictStates?: string[];
  busy?: [number, number]; // [startOffsetDays, endOffsetDays] from today
  maxPerMonth?: number;
  user?: string;
}[] = [
  { name: "Dr. Arvind Menon", designation: "PROFESSOR_LEVEL", city: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, user: "expert1@aicte.gov.in" },
  { name: "Prof. Sneha Joshi", designation: "PROFESSOR_LEVEL", city: "Mumbai", state: "Maharashtra", lat: 19.076, lng: 72.8777, busy: [2, 6], user: "expert2@aicte.gov.in" },
  { name: "Dr. Imran Sheikh", designation: "ASSOCIATE_PROF", city: "Nashik", state: "Maharashtra", lat: 19.9975, lng: 73.7898 },
  { name: "Er. Vikram Gadgil", designation: "ARCHITECT_CIVIL", city: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, maxPerMonth: 6 },
  { name: "Prof. Meera Krishnan", designation: "PROFESSOR_LEVEL", city: "Bengaluru", state: "Karnataka", lat: 12.9716, lng: 77.5946 },
  { name: "Dr. Ranganath Hegde", designation: "ASSOCIATE_PROF", city: "Mysuru", state: "Karnataka", lat: 12.2958, lng: 76.6394 },
  { name: "Er. Lakshmi Narayan", designation: "ARCHITECT_CIVIL", city: "Bengaluru", state: "Karnataka", lat: 12.9716, lng: 77.5946 },
  { name: "Dr. Kavitha Subramanian", designation: "PROFESSOR_LEVEL", city: "Coimbatore", state: "Tamil Nadu", lat: 11.0168, lng: 76.9558 },
  { name: "Prof. Dinesh Babu", designation: "ASSOCIATE_PROF", city: "Chennai", state: "Tamil Nadu", lat: 13.0827, lng: 80.2707, conflictStates: ["Karnataka"] },
  { name: "Dr. Sunita Raghunathan", designation: "PROFESSOR_LEVEL", city: "Ghaziabad", state: "Uttar Pradesh", lat: 28.6692, lng: 77.4538 },
  { name: "Prof. Amitabh Tandon", designation: "PROFESSOR_LEVEL", city: "New Delhi", state: "Delhi", lat: 28.6139, lng: 77.209, busy: [1, 4] },
  { name: "Er. Partha Sarathi Das", designation: "ARCHITECT_CIVIL", city: "Kolkata", state: "West Bengal", lat: 22.5726, lng: 88.3639 },
];


const TEMPLATES = [
  {
    key: "ROUTE_NEW_INSTITUTION",
    name: "New Institution — full route (scrutiny → EVC → committee → decision)",
    version: 1,
    status: "PUBLISHED",
    stages: ["SCRUTINY", "EVC", "COMMITTEE", "DECISION"],
    sla: { SCRUTINY: 7, EVC: 21, COMMITTEE: 14, DECISION: 10 },
    appTypes: ["NEW_INSTITUTION"],
    instTypes: ["NEW"],
    note: "Baseline route under APH 2026.1",
    publishedDaysAgo: 40,
  },
  {
    key: "ROUTE_RENEWAL",
    name: "Renewal of Approval — scrutiny only",
    version: 1,
    status: "PUBLISHED",
    stages: ["SCRUTINY", "DECISION"],
    sla: { SCRUTINY: 7, DECISION: 10 },
    appTypes: ["RENEWAL"],
    instTypes: ["EXISTING"],
    note: "Scrutiny-only route; no inspection for like-for-like renewals",
    publishedDaysAgo: 40,
  },
  {
    key: "ROUTE_EXTENSION",
    name: "Extension / New Course — scrutiny → EVC → decision",
    version: 1,
    status: "PUBLISHED",
    stages: ["SCRUTINY", "EVC", "DECISION"],
    sla: { SCRUTINY: 7, EVC: 21, DECISION: 10 },
    appTypes: ["EXTENSION_INTAKE", "NEW_COURSE"],
    instTypes: [],
    note: "Committee referral only where deficiencies are contested",
    publishedDaysAgo: 40,
  },
  {
    key: "ROUTE_NEW_INSTITUTION",
    name: "New Institution — compressed timelines (APH 2026.2)",
    version: 2,
    status: "DRAFT",
    stages: ["SCRUTINY", "EVC", "COMMITTEE", "DECISION"],
    sla: { SCRUTINY: 5, EVC: 14, COMMITTEE: 10, DECISION: 7 },
    appTypes: ["NEW_INSTITUTION"],
    instTypes: ["NEW"],
    note: "Compressed scrutiny and inspection timelines — ready to simulate and publish",
  },
];

type AppSpec = {
  inst: number;
  type: "NEW_INSTITUTION" | "RENEWAL" | "EXTENSION_INTAKE" | "NEW_COURSE";
  stage: StageKey;
  ageDays: number;
  dueOffsetDays: number | null; // days from now; negative = overdue. null for decided cases
  status?: "APPROVED" | "CONDITIONALLY_APPROVED" | "REJECTED" | "AWAITING_INSTITUTION";
  decidedDaysAgo?: number;
  decisionNote?: string;
  evc?: { status: "QUEUED" | "SCHEDULED" | "COMPLETED" | "OVERDUE"; scheduleOffset?: number; recommendation?: "SATISFACTORY" | "DEFICIENT"; report?: string };
};

const APPLICATIONS: AppSpec[] = [
  // ---- Northern Region -----------------------------------------------------
  { inst: 0, type: "RENEWAL", stage: "SCRUTINY", ageDays: 4, dueOffsetDays: 3 },
  { inst: 0, type: "EXTENSION_INTAKE", stage: "EVC", ageDays: 22, dueOffsetDays: -2, evc: { status: "SCHEDULED", scheduleOffset: -5 } },
  { inst: 0, type: "NEW_COURSE", stage: "DECISION", ageDays: 34, dueOffsetDays: -6, evc: { status: "COMPLETED", scheduleOffset: -18, recommendation: "SATISFACTORY", report: "Laboratories for the AI/ML programme are functional. Two additional faculty recruited as per norms. Library holdings adequate." } },

  { inst: 1, type: "RENEWAL", stage: "SCRUTINY", ageDays: 2, dueOffsetDays: 5 },
  { inst: 1, type: "EXTENSION_INTAKE", stage: "EVC", ageDays: 18, dueOffsetDays: 3, evc: { status: "SCHEDULED", scheduleOffset: 2 } },
  { inst: 1, type: "RENEWAL", stage: "COMPLETED", ageDays: 26, dueOffsetDays: null, status: "APPROVED", decidedDaysAgo: 12, decisionNote: "Approval renewed for AY 2026-27. Intake retained at 120." },

  { inst: 2, type: "NEW_INSTITUTION", stage: "SCRUTINY", ageDays: 6, dueOffsetDays: 1 },
  { inst: 2, type: "NEW_INSTITUTION", stage: "INSTITUTION_RESPONSE", ageDays: 25, dueOffsetDays: 6, status: "AWAITING_INSTITUTION" },
  { inst: 2, type: "NEW_INSTITUTION", stage: "COMMITTEE", ageDays: 40, dueOffsetDays: -9, evc: { status: "COMPLETED", scheduleOffset: -22, recommendation: "SATISFACTORY", report: "Campus infrastructure substantially complete. Built-up area verified at 12,400 sq m against a requirement of 12,000 sq m." } },

  // ---- Western Region ------------------------------------------------------
  { inst: 3, type: "RENEWAL", stage: "SCRUTINY", ageDays: 9, dueOffsetDays: -1 },
  { inst: 3, type: "EXTENSION_INTAKE", stage: "EVC", ageDays: 15, dueOffsetDays: 2, evc: { status: "SCHEDULED", scheduleOffset: 1 } },
  { inst: 3, type: "NEW_COURSE", stage: "DECISION", ageDays: 20, dueOffsetDays: 4, evc: { status: "COMPLETED", scheduleOffset: -6, recommendation: "SATISFACTORY", report: "Robotics laboratory commissioned. Industry MoU produced for student internships." } },
  { inst: 3, type: "RENEWAL", stage: "COMPLETED", ageDays: 60, dueOffsetDays: null, status: "CONDITIONALLY_APPROVED", decidedDaysAgo: 30, decisionNote: "Conditional approval. Renewed lease deed and fire clearance to be submitted within the stipulated period." },

  { inst: 4, type: "RENEWAL", stage: "SCRUTINY", ageDays: 30, dueOffsetDays: -12 },
  { inst: 4, type: "EXTENSION_INTAKE", stage: "DECISION", ageDays: 26, dueOffsetDays: 1, evc: { status: "COMPLETED", scheduleOffset: -8, recommendation: "DEFICIENT", report: "Workshop area short of the norm by 180 sq m. Institution has been advised to augment before intake is increased." } },

  { inst: 5, type: "NEW_INSTITUTION", stage: "EVC", ageDays: 12, dueOffsetDays: 5, evc: { status: "QUEUED" } },
  { inst: 5, type: "NEW_INSTITUTION", stage: "SCRUTINY", ageDays: 3, dueOffsetDays: 4 },

  // ---- Southern Region -----------------------------------------------------
  { inst: 6, type: "RENEWAL", stage: "SCRUTINY", ageDays: 5, dueOffsetDays: 2 },
  { inst: 6, type: "EXTENSION_INTAKE", stage: "EVC", ageDays: 24, dueOffsetDays: -4, evc: { status: "OVERDUE", scheduleOffset: -9 } },
  { inst: 6, type: "NEW_COURSE", stage: "COMPLETED", ageDays: 45, dueOffsetDays: null, status: "REJECTED", decidedDaysAgo: 20, decisionNote: "Rejected: cadre ratio of 1:20 not met for the proposed programme; faculty strength short by six.", evc: { status: "COMPLETED", scheduleOffset: -30, recommendation: "DEFICIENT", report: "Faculty strength verified at 14 against a requirement of 20 for the proposed intake." } },

  { inst: 7, type: "RENEWAL", stage: "DECISION", ageDays: 11, dueOffsetDays: 6 },
  { inst: 7, type: "EXTENSION_INTAKE", stage: "SCRUTINY", ageDays: 16, dueOffsetDays: -3 },

  { inst: 8, type: "NEW_INSTITUTION", stage: "SCRUTINY", ageDays: 1, dueOffsetDays: 6 },
  { inst: 8, type: "NEW_INSTITUTION", stage: "EVC", ageDays: 19, dueOffsetDays: 1, evc: { status: "COMPLETED", scheduleOffset: -4, recommendation: "SATISFACTORY", report: "All four floors of the academic block complete. Hostel for 300 students ready." } },

  // ---- Eastern Region ------------------------------------------------------
  { inst: 9, type: "RENEWAL", stage: "COMPLETED", ageDays: 22, dueOffsetDays: null, status: "APPROVED", decidedDaysAgo: 5, decisionNote: "Approval renewed for AY 2026-27 without conditions." },
  { inst: 9, type: "EXTENSION_INTAKE", stage: "EVC", ageDays: 8, dueOffsetDays: 7, evc: { status: "QUEUED" } },
  { inst: 9, type: "NEW_COURSE", stage: "SCRUTINY", ageDays: 14, dueOffsetDays: 0 },

  { inst: 10, type: "RENEWAL", stage: "SCRUTINY", ageDays: 21, dueOffsetDays: -7 },
  { inst: 10, type: "EXTENSION_INTAKE", stage: "COMPLETED", ageDays: 90, dueOffsetDays: null, status: "CONDITIONALLY_APPROVED", decidedDaysAgo: 45, decisionNote: "Conditional approval subject to submission of fire clearance, augmented faculty and the revised building plan.", evc: { status: "COMPLETED", scheduleOffset: -50, recommendation: "SATISFACTORY", report: "Core infrastructure found adequate. Conditions imposed on fire clearance and faculty augmentation." } },

  { inst: 11, type: "NEW_INSTITUTION", stage: "SCRUTINY", ageDays: 7, dueOffsetDays: 2 },
  { inst: 11, type: "NEW_INSTITUTION", stage: "COMMITTEE", ageDays: 33, dueOffsetDays: 5, evc: { status: "COMPLETED", scheduleOffset: -12, recommendation: "SATISFACTORY", report: "Land documents verified. Title deed registered in the name of the trust." } },
  { inst: 11, type: "NEW_INSTITUTION", stage: "INSTITUTION_RESPONSE", ageDays: 28, dueOffsetDays: -2, status: "AWAITING_INSTITUTION" },
];

const DOCUMENTS = [
  { inst: 0, type: "LEASE_DEED", file: "st-marys-lease-2026.pdf", expiresInDays: 12 },
  { inst: 0, type: "FIRE_SAFETY_CERTIFICATE", file: "st-marys-fire-noc-2026.pdf", expiresInDays: 200 },
  { inst: 0, type: "LAND_CERTIFICATE", file: "st-marys-land-deed.pdf", expiresInDays: -5 },
  { inst: 1, type: "FIRE_SAFETY_CERTIFICATE", file: "diet-fire-noc-2026.pdf", expiresInDays: 150 },
  { inst: 2, type: "LAND_CERTIFICATE", file: "himalayan-land-register.pdf", expiresInDays: 120 },
  { inst: 3, type: "LEASE_DEED", file: "wce-lease-2026.pdf", expiresInDays: 45 },
  { inst: 3, type: "BUILDING_PLAN_APPROVAL", file: "wce-building-plan.pdf", expiresInDays: 8 },
  { inst: 4, type: "LEASE_DEED", file: "sapphire-lease-2026.pdf", expiresInDays: 3 },
  { inst: 5, type: "LAND_CERTIFICATE", file: "deccan-land-certificate.pdf", expiresInDays: 30 },
  { inst: 6, type: "FIRE_SAFETY_CERTIFICATE", file: "sit-fire-noc-2025.pdf", expiresInDays: -1 },
  { inst: 6, type: "AFFILIATION_CERTIFICATE", file: "sit-affiliation-2026.pdf", expiresInDays: 90 },
  { inst: 7, type: "AFFILIATION_CERTIFICATE", file: "coromandel-affiliation.pdf", expiresInDays: 300 },
  { inst: 8, type: "LEASE_DEED", file: "nilgiri-lease-2026.pdf", expiresInDays: 15 },
  { inst: 9, type: "LEASE_DEED", file: "eastern-tech-lease.pdf", expiresInDays: 60 },
  { inst: 9, type: "FACULTY_DECLARATION", file: "eastern-tech-faculty-2026.pdf", expiresInDays: 5 },
  { inst: 10, type: "FIRE_SAFETY_CERTIFICATE", file: "brahmaputra-fire-noc.pdf", expiresInDays: 25 },
  { inst: 11, type: "LAND_CERTIFICATE", file: "utkal-land-deed.pdf", expiresInDays: 75 },
];

const PROGRAM_NAMES: Record<string, string[]> = {
  NEW_INSTITUTION: ["B.Tech — Computer Science & Engineering", "B.Tech — Electronics & Communication", "MBA — General Management"],
  RENEWAL: ["Renewal of Approval (EoA) AY 2026-27"],
  EXTENSION_INTAKE: ["Increase in intake — B.Tech Mechanical Engineering", "Increase in intake — B.Tech Civil Engineering"],
  NEW_COURSE: ["B.Tech — Artificial Intelligence & Machine Learning", "B.Tech — Robotics & Automation"],
};

// ===========================================================================

async function main() {
  console.log("Seeding AICTE Approval & Compliance Command Centre…\n");

  // wipe -------------------------------------------------------------------
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  // Feature 4/6/8 tables are not reachable through the cascade from Institution
  // or Application, so they are cleared explicitly.
  await db.letter.deleteMany();
  await db.task.deleteMany();
  await db.magicLink.deleteMany();
  await db.expert.deleteMany();
  await db.escalation.deleteMany();
  await db.complianceSubmission.deleteMany();
  await db.undertaking.deleteMany();
  await db.evcVisit.deleteMany();
  await db.stageTransition.deleteMany();
  await db.application.deleteMany();
  await db.document.deleteMany();
  await db.routeTemplate.deleteMany();
  await db.user.deleteMany();
  await db.institution.deleteMany();
  await db.region.deleteMany();

  // regions ------------------------------------------------------------------
  const regionIds: Record<string, string> = {};
  for (const r of REGIONS) {
    const rec = await db.region.create({ data: r });
    regionIds[r.code] = rec.id;
  }
  console.log(`✓ ${REGIONS.length} regions`);

  // institutions -------------------------------------------------------------
  const institutionIds: string[] = [];
  for (let i = 0; i < INSTITUTIONS.length; i++) {
    const spec = INSTITUTIONS[i];
    const rec = await db.institution.create({
      data: {
        name: spec.name,
        aisheCode: `U-${String(1000 + i * 37).padStart(4, "0")}-${spec.region}`,
        type: spec.type,
        city: spec.city,
        state: spec.state,
        latitude: spec.lat,
        longitude: spec.lng,
        regionId: regionIds[spec.region],
      },
    });
    institutionIds[i] = rec.id;
  }
  console.log(`✓ ${INSTITUTIONS.length} institutions`);

  // users --------------------------------------------------------------------
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const userIds: Record<string, string> = {};
  for (const u of USERS) {
    const rec = await db.user.create({
      data: {
        email: u.email,
        name: u.name,
        role: u.role,
        designation: u.designation,
        passwordHash,
        regionId: u.region ? regionIds[u.region] : null,
        institutionId: u.institution !== undefined ? institutionIds[u.institution] : null,
      },
    });
    userIds[u.email] = rec.id;
  }
  console.log(`✓ ${USERS.length} users (password: ${PASSWORD})`);

  // experts (Feature 4) -------------------------------------------------------
  for (const e of EXPERTS) {
    await db.expert.create({
      data: {
        name: e.name,
        designation: e.designation,
        city: e.city,
        state: e.state,
        latitude: e.lat,
        longitude: e.lng,
        conflictStates: toJson(e.conflictStates ?? []),
        busyRanges: e.busy ? toJson([{ from: addDays(now(), e.busy[0]).toISOString(), to: addDays(now(), e.busy[1]).toISOString() }]) : toJson([]),
        maxPerMonth: e.maxPerMonth ?? 4,
        userId: e.user ? (userIds[e.user] ?? null) : null,
      },
    });
  }
  console.log(`✓ ${EXPERTS.length} empanelled experts across ${new Set(EXPERTS.map((e) => e.state)).size} states`);

  // Feature 5 — a couple of deliberately different workload caps, so the
  // capacity bar and the "at capacity" path are visible on first login.
  const CAPS: Record<string, number> = {
    "scrutiny.west2@aicte.gov.in": 3,
    "scrutiny.north@aicte.gov.in": 6,
  };
  for (const [email, cap] of Object.entries(CAPS)) {
    if (userIds[email]) await db.user.update({ where: { id: userIds[email] }, data: { maxActiveCases: cap } });
  }
  console.log(`✓ workload caps set for ${Object.keys(CAPS).length} officers`);

  // route templates ----------------------------------------------------------
  const templateIds: Record<string, string> = {};
  for (const t of TEMPLATES) {
    const rec = await db.routeTemplate.create({
      data: {
        key: t.key,
        name: t.name,
        version: t.version,
        status: t.status,
        stages: toJson(t.stages),
        slaDays: toJson(t.sla),
        appTypes: toJson(t.appTypes),
        institutionTypes: toJson(t.instTypes),
        changeNote: t.note,
        publishedAt: t.status === "PUBLISHED" ? addDays(now(), -(t.publishedDaysAgo ?? 30)) : null,
        publishedBy: t.status === "PUBLISHED" ? "Smt. Lakshmi Subramanian" : null,
      },
    });
    templateIds[`${t.key}#${t.version}`] = rec.id;
    if (t.status === "PUBLISHED") {
      await audit("Smt. Lakshmi Subramanian", "RULE_PUBLISHED", "RouteTemplate", rec.id, {
        key: t.key,
        version: t.version,
        stages: t.stages,
        slaDays: t.sla,
      });
    }
  }
  console.log(`✓ ${TEMPLATES.length} rule versions (3 published, 1 draft ready to simulate)`);

  // applications -------------------------------------------------------------
  const templates = await db.routeTemplate.findMany();
  const pickTemplate = (type: string, instType: string) => {
    const published = templates.filter((t) => t.status === "PUBLISHED");
    return (
      published.find((t) => {
        const types: string[] = JSON.parse(t.appTypes);
        const inst: string[] = JSON.parse(t.institutionTypes || "[]");
        return types.includes(type) && (inst.length === 0 || inst.includes(instType));
      }) ?? published[0]
    );
  };

  const officerFor = (regionCode: string, index: number): string | null => {
    if (regionCode === "WR") return index % 7 === 3 ? userIds["scrutiny.west2@aicte.gov.in"] : userIds["scrutiny.west@aicte.gov.in"];
    const map: Record<string, string> = {
      NR: "scrutiny.north@aicte.gov.in",
      SR: "scrutiny.south@aicte.gov.in",
      ER: "scrutiny.east@aicte.gov.in",
    };
    return userIds[map[regionCode]] ?? null;
  };

  let refSeq = 0;
  const createdApps: { id: string; refNumber: string; spec: AppSpec; institutionId: string }[] = [];

  for (let i = 0; i < APPLICATIONS.length; i++) {
    const spec = APPLICATIONS[i];
    const inst = INSTITUTIONS[spec.inst];
    const institutionId = institutionIds[spec.inst];
    const regionId = regionIds[inst.region];

    const template = pickTemplate(spec.type, inst.type);
    const stages = templateStages(template);
    const slas = templateSlas(template);

    const decided = !!spec.status;
    const submittedAt = addDays(now(), -spec.ageDays);
    const decidedAt = decided ? addDays(now(), -(spec.decidedDaysAgo ?? 5)) : null;

    refSeq += 1;
    const refNumber = `AICTE-${now().getFullYear()}-${inst.region}-${String(refSeq).padStart(4, "0")}`;

    // how long has it been sitting in the current stage?
    const stageIdx = Math.max(0, stages.indexOf(spec.stage === "INSTITUTION_RESPONSE" ? "SCRUTINY" : spec.stage));
    const steps = stageIdx + (spec.stage === "INSTITUTION_RESPONSE" ? 1 : 0) + 1;
    const stageEnteredAt = addDays(submittedAt, (spec.ageDays / (steps + 1)) * steps);

    const app = await db.application.create({
      data: {
        refNumber,
        type: spec.type,
        status: spec.status ?? (spec.stage === "INSTITUTION_RESPONSE" ? "AWAITING_INSTITUTION" : "IN_PROGRESS"),
        currentStage: spec.stage,
        stageEnteredAt,
        dueAt: decided || spec.dueOffsetDays === null ? null : addDays(now(), spec.dueOffsetDays),
        escalationLevel: 0,
        remindedTiers: toJson([]),
        routeSnapshot: toJson(stages),
        slaSnapshot: toJson(slas),
        routeKey: template.key,
        routeVersion: template.version,
        routeTemplateId: template.id,
        institutionId,
        regionId,
        assignedToId: officerFor(inst.region, i),
        programName: pick(PROGRAM_NAMES[spec.type]),
        intake: spec.type === "RENEWAL" ? 0 : [60, 90, 120, 180][Math.floor(rnd() * 4)],
        submittedAt,
        decidedAt,
        decisionNote: spec.decisionNote ?? null,
      },
    });

    // ---- synthetic but coherent movement history
    let cursor = submittedAt;
    const gapDays = spec.ageDays / (steps + 2);

    await db.stageTransition.create({
      data: {
        applicationId: app.id,
        fromStage: null,
        toStage: stages[0],
        action: "SUBMIT",
        actorName: USERS.find((u) => u.institution === spec.inst)?.name ?? "Institution User",
        actorRole: "INSTITUTION",
        reason: `Application submitted under ${template.name} (v${template.version}).`,
        createdAt: cursor,
      },
    });
    await audit("Institution User", "SUBMIT", "Application", app.id, { refNumber, route: template.key });

    for (let s = 0; s < stageIdx; s++) {
      cursor = addDays(cursor, gapDays);
      await db.stageTransition.create({
        data: {
          applicationId: app.id,
          fromStage: stages[s],
          toStage: stages[s + 1],
          action: "APPROVE_STAGE",
          actorName: officerNameFor(regionId, stages[s]),
          actorRole: "SCRUTINY_OFFICER",
          reason: null,
          createdAt: cursor,
        },
      });
      await audit(officerNameFor(regionId, stages[s]), "APPROVE_STAGE", "Application", app.id, {
        from: stages[s],
        to: stages[s + 1],
      });
    }

    if (spec.stage === "INSTITUTION_RESPONSE") {
      cursor = addDays(cursor, gapDays);
      const deficiency =
        spec.inst % 2 === 0
          ? "Land ownership certificate is not registered in the name of the trust. Submit the registered deed."
          : "Built-up area certificate signed by a registered architect is missing. Upload the certified plan.";
      await db.stageTransition.create({
        data: {
          applicationId: app.id,
          fromStage: "SCRUTINY",
          toStage: "INSTITUTION_RESPONSE",
          action: "REVERT",
          actorName: officerNameFor(regionId, "SCRUTINY"),
          actorRole: "SCRUTINY_OFFICER",
          reason: deficiency,
          createdAt: cursor,
        },
      });
      await audit(officerNameFor(regionId, "SCRUTINY"), "REVERT", "Application", app.id, { reason: deficiency });

      await db.undertaking.create({
        data: {
          title:
            spec.inst % 2 === 0
              ? "Submit registered land ownership certificate"
              : "Upload architect-certified built-up area plan",
          description: deficiency,
          phase: "PRE",
          dueAt: spec.dueOffsetDays === null ? addDays(now(), 15) : addDays(now(), spec.dueOffsetDays),
          status: "PENDING",
          institutionId,
          applicationId: app.id,
        },
      });
    }

    if (decided) {
      cursor = decidedAt ?? cursor;
      await db.stageTransition.create({
        data: {
          applicationId: app.id,
          fromStage: "DECISION",
          toStage: "COMPLETED",
          action: spec.status === "APPROVED" ? "APPROVE" : spec.status === "CONDITIONALLY_APPROVED" ? "CONDITIONAL_APPROVE" : "REJECT",
          actorName: "Shri Rakesh Bhatnagar",
          actorRole: "COMPETENT_AUTHORITY",
          reason: spec.decisionNote ?? null,
          createdAt: cursor,
        },
      });
      await audit("Shri Rakesh Bhatnagar", spec.status === "APPROVED" ? "APPROVE" : spec.status === "CONDITIONALLY_APPROVED" ? "CONDITIONAL_APPROVE" : "REJECT", "Application", app.id, {
        refNumber,
        note: spec.decisionNote ?? null,
      });
    }

    // ---- EVC visit
    if (spec.evc) {
      const evcDue = spec.dueOffsetDays === null ? addDays(now(), 21) : addDays(now(), spec.dueOffsetDays);
      await db.evcVisit.create({
        data: {
          applicationId: app.id,
          status: spec.evc.status,
          scheduledFor: spec.evc.scheduleOffset !== undefined ? addDays(now(), spec.evc.scheduleOffset) : null,
          dueAt: evcDue,
          members: toJson(
            spec.evc.status === "QUEUED"
              ? []
              : [
                  pick(["Dr. Arvind Menon", "Prof. Sneha Joshi", "Dr. Imran Sheikh"]),
                  pick(["Dr. Arvind Menon", "Prof. Sneha Joshi", "Dr. Imran Sheikh"]),
                ].filter((v, i, a) => a.indexOf(v) === i),
          ),
          reportText: spec.evc.report ?? null,
          recommendation: spec.evc.recommendation ?? null,
          completedAt: spec.evc.status === "COMPLETED" ? addDays(now(), -1) : null,
          createdAt: addDays(stageEnteredAt, 1),
        },
      });
    }

    createdApps.push({ id: app.id, refNumber, spec, institutionId });
  }
  console.log(`✓ ${APPLICATIONS.length} applications with full movement history`);

  // post-approval undertakings ----------------------------------------------
  const conditionalApps = createdApps.filter((a) => a.spec.status === "CONDITIONALLY_APPROVED");

  for (const app of conditionalApps) {
    const baseDays = app.spec.decidedDaysAgo ?? 30;
    const rows: { title: string; description: string; offset: number; status?: string; withProof?: boolean }[] = [
      {
        title: "Submit renewed fire safety clearance",
        description: "Upload the fire NOC renewed by the competent state authority for the current academic year.",
        offset: -3,
        status: "OVERDUE",
      },
      {
        title: "Submit renewed lease deed",
        description: "Registered lease deed valid for at least five years from the date of approval.",
        offset: 12,
        status: "SUBMITTED",
        withProof: true,
      },
      {
        title: "Augment faculty to the prescribed cadre ratio",
        description: "Appoint four additional professors and submit the faculty declaration with appointment letters.",
        offset: 40,
      },
    ];

    for (const r of rows) {
      const u = await db.undertaking.create({
        data: {
          title: r.title,
          description: r.description,
          phase: "POST",
          dueAt: addDays(now(), r.offset),
          status: r.status ?? "PENDING",
          institutionId: app.institutionId,
          applicationId: app.id,
          verifiedAt: r.status === "VERIFIED" ? addDays(now(), -2) : null,
          verifiedBy: r.status === "VERIFIED" ? "Shri Mahesh Patil" : null,
          createdAt: addDays(now(), -baseDays),
        },
      });

      if (r.withProof) {
        await db.complianceSubmission.create({
          data: {
            undertakingId: u.id,
            fileName: "lease-deed-renewed-2027.pdf",
            note: "Renewed lease deed registered with the sub-registrar.",
            status: "SUBMITTED",
            submittedBy: "Institution User",
            submittedAt: addDays(now(), -1),
          },
        });
      }
    }
  }

  // one verified undertaking so the compliance dashboard is not all red
  const firstConditional = conditionalApps[0];
  if (firstConditional) {
    const u = await db.undertaking.create({
      data: {
        title: "Submit faculty declaration for AY 2026-27",
        description: "Upload the faculty declaration countersigned by the principal with appointment letters.",
        phase: "POST",
        dueAt: addDays(now(), -20),
        status: "VERIFIED",
        institutionId: firstConditional.institutionId,
        applicationId: firstConditional.id,
        verifiedAt: addDays(now(), -25),
        verifiedBy: "Smt. Sunita Rawat",
        createdAt: addDays(now(), -45),
      },
    });
    await db.complianceSubmission.create({
      data: {
        undertakingId: u.id,
        fileName: "faculty-declaration-2026-27.pdf",
        status: "VERIFIED",
        submittedBy: "Institution User",
        submittedAt: addDays(now(), -26),
        verifiedBy: "Smt. Sunita Rawat",
        verifiedAt: addDays(now(), -25),
      },
    });
  }

  // a standalone compliance obligation (not tied to any application)
  await db.undertaking.create({
    data: {
      title: "Submit annual affiliation certificate",
      description: "Upload the university affiliation certificate for the current academic year.",
      phase: "POST",
      dueAt: addDays(now(), 45),
      status: "PENDING",
      institutionId: institutionIds[0],
    },
  });

  const undertakingCount = await db.undertaking.count();
  console.log(`✓ ${undertakingCount} undertakings (pre-approval deficiencies + post-approval conditions)`);

  // documents -----------------------------------------------------------------
  // Feature 2/3: every registered document is read once, and the machine reading
  // is stored alongside the date the institution entered.
  const createdDocs = await Promise.all(
    DOCUMENTS.map((d) =>
      db.document.create({
        data: {
          type: d.type,
          fileName: d.file,
          expiresAt: addDays(now(), d.expiresInDays),
          status: "VALID",
          alertedTiers: toJson([]),
          institutionId: institutionIds[d.inst],
        },
      }),
    ),
  );

  await Promise.all(
    createdDocs.map(async (doc) => {
      const extraction = await extractDocumentData(doc.fileName, doc.type);
      await db.document.update({
        where: { id: doc.id },
        data: {
          enteredDate: doc.expiresAt,
          ocrExtractedDate: extraction.expiryDate,
          ocrConfidence: extraction.confidence,
          aiSummary: encodeSummary(extraction),
        },
      });
    }),
  );

  // One document is engineered with a genuine mismatch so the conflict workflow
  // (officer confirmation) is visible on first login.
  const lease = createdDocs.find((d) => d.type === "LEASE_DEED");
  if (lease) {
    const ocrDate = addDays(new Date(lease.expiresAt), 19);
    await db.document.update({
      where: { id: lease.id },
      data: {
        enteredDate: lease.expiresAt,
        ocrExtractedDate: ocrDate,
        ocrConfidence: 0.91,
        dateConflict: true,
        officerConfirmed: false,
        aiSummary: encodeSummary({
          documentType: "Lease Deed",
          expiryDate: ocrDate,
          confidence: 0.91,
          summary:
            "Registered lease deed executed between the institution and the lessor. The printed validity end date reads 19 days later than the date entered in the portal, so the compliance officer must confirm which date is correct before the expiry countdown is trusted.",
          keyDates: [
            { label: "Date of execution", date: addDays(new Date(lease.expiresAt), -346).toISOString().slice(0, 10) },
            { label: "Validity ends (as printed)", date: ocrDate.toISOString().slice(0, 10) },
          ],
          engine: "MOCK",
        }),
      },
    });
  }
  console.log(`✓ ${DOCUMENTS.length} documents on the expiry register (1 date conflict)`);

  // run the real engine once so escalations/alerts are genuine ---------------
  console.log("\nRunning the deadline engine over the seeded data…");
  await runSchedulerTick();

  // Feature 6 — one pre-generated magic link so the public response page is
  // reachable straight after seeding (no waiting for a reminder to fire).
  {
    const target = await db.undertaking.findFirst({
      where: { institutionId: institutionIds[0], status: "PENDING" },
      select: { id: true, title: true },
    });
    if (target) {
      const link = await issueMagicLink({
        purpose: "UNDERTAKING_RESPONSE",
        entityId: target.id,
        institutionId: institutionIds[0],
      });
      console.log(`\u2713 magic link (72h, single use): ${magicLinkPath(link.token)}`);
      console.log(`    → ${target.title}`);
    }
  }

  // trust score events (Feature 1) -------------------------------------------
  // Written directly against the event log, then the cached score is derived
  // from them — exactly what the running system does.
  const TRUST_PLAN: { inst: number; event: keyof typeof TRUST_DELTAS; note: string }[] = [
    { inst: 0, event: "DEFICIENCY_ITEM", note: "Land ownership certificate not self-attested" },
    { inst: 0, event: "COMPLIANCE_ON_TIME", note: "Fire-safety NOC verified before the deadline" },
    { inst: 1, event: "LOR", note: "AICTE-2026-0007 rejected — intake sought beyond approved capacity" },
    { inst: 1, event: "DEFICIENCY_ITEM", note: "Faculty:student ratio computation missing" },
    { inst: 1, event: "APPEAL_UPHELD", note: "Appeal against the deficiency call was accepted on review" },
    { inst: 3, event: "UNDERTAKING_OVERDUE", note: "Built-up area certificate — 3 days past the compliance date" },
    { inst: 3, event: "DEFICIENCY_ITEM", note: "Approved building plan not uploaded" },
    { inst: 5, event: "LOR", note: "AICTE-2026-0013 rejected — land documents incomplete" },
    { inst: 5, event: "DOC_EXPIRED", note: "Building safety certificate lapsed without renewal" },
    { inst: 5, event: "DEFICIENCY_ITEM", note: "Land documents incomplete" },
    { inst: 5, event: "DEFICIENCY_ITEM", note: "Financial guarantee format incorrect" },
    { inst: 8, event: "LOR", note: "AICTE-2026-0021 rejected — shortfall in built-up area" },
    { inst: 8, event: "LOR", note: "Second application rejected on the same ground" },
    { inst: 8, event: "UNDERTAKING_OVERDUE", note: "Land lease registration proof never submitted" },
    { inst: 8, event: "DEFICIENCY_ITEM", note: "Built-up area shortfall not remedied on re-submission" },
    { inst: 8, event: "DOC_EXPIRED", note: "Building plan approval lapsed" },
    { inst: 10, event: "UNDERTAKING_OVERDUE", note: "Faculty appointment compliance — 12 days overdue" },
    { inst: 10, event: "DOC_EXPIRED", note: "Consent to Establish expired" },
  ];
  for (const t of TRUST_PLAN) {
    await db.trustScoreEvent.create({
      data: {
        institutionId: institutionIds[t.inst],
        event: t.event,
        delta: TRUST_DELTAS[t.event],
        note: t.note,
        createdAt: addDays(now(), -1 * (1 + TRUST_PLAN.indexOf(t) % 9)),
      },
    });
  }
  for (const id of institutionIds) await recomputeTrustScore(id);
  const trustRows = await db.institution.findMany({ select: { name: true, trustScore: true }, orderBy: { trustScore: "asc" } });
  console.log(`\u2713 trust scores: ${trustRows.slice(0, 4).map((r) => `${r.trustScore} (${r.name.split(" ")[0]})`).join(", ")} \u2026`);

  const [esc, notif, docs, overdue] = await Promise.all([
    db.escalation.count(),
    db.notification.count(),
    db.document.count({ where: { status: { in: ["EXPIRING_SOON", "EXPIRED"] } } }),
    db.application.count({ where: { dueAt: { lt: now() }, status: { in: ["IN_PROGRESS", "AWAITING_INSTITUTION"] } } }),
  ]);

  console.log(`✓ ${esc} escalation(s) raised by the engine`);
  console.log(`✓ ${notif} notification(s) delivered`);
  console.log(`✓ ${overdue} application(s) already past SLA`);
  console.log(`✓ ${docs} document(s) flagged as expiring or expired`);

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("  Sign in with any account below — password:", PASSWORD);
  console.log("─────────────────────────────────────────────────────────────");
  const highlights = [
    ["college@stmarys.edu", "Institution (Northern)"],
    ["scrutiny.west@aicte.gov.in", "Scrutiny officer — heavy workload"],
    ["scrutiny.north@aicte.gov.in", "Scrutiny officer"],
    ["evc.west@aicte.gov.in", "EVC coordinator"],
    ["committee@aicte.gov.in", "Committee member"],
    ["authority@aicte.gov.in", "Competent authority (decisions)"],
    ["compliance.west@aicte.gov.in", "Compliance officer"],
    ["regional.west@aicte.gov.in", "Regional officer"],
    ["bureau@aicte.gov.in", "Bureau officer (national view)"],
    ["policy@aicte.gov.in", "Policy administrator (rule engine)"],
    ["admin@aicte.gov.in", "System administrator"],
  ];
  for (const [email, label] of highlights) console.log(`  ${email.padEnd(32)} ${label}`);
  console.log("─────────────────────────────────────────────────────────────\n");
  console.log(DEMO_MODE ? "  DEMO_MODE is ON — 1 day = compressed time.\n" : "  DEMO_MODE is OFF — real 24-hour days.\n");
}

function officerNameFor(regionId: string, stage: string): string {
  if (stage === "EVC") return "Shri Sanjay Mehta";
  if (stage === "COMMITTEE") return "Prof. Vikas Bhandari";
  if (stage === "DECISION") return "Shri Rakesh Bhatnagar";
  return "Smt. Kavita Nair";
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
