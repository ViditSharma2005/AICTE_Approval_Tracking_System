/**
 * The deadline engine — "Track → Remind → Escalate".
 *
 * Runs as a *lazy tick*: instead of a background worker, `ensureTick()` is
 * called on every authenticated page render (and every 5s by the Demo Ticker
 * during demos). It is fully idempotent: reminder tiers already fired are
 * recorded, so a case is never notified twice for the same threshold.
 */

import { db } from "./db";
import { daysBetween } from "./time";
import { notifyInstitution, notifyRole, notifyUser } from "./notify";
import { audit } from "./audit";
import { parseNumberArray, toJson } from "./json";
import { recordTrustEvent } from "./trust";
import { expireDocument } from "./documents";
import { issueMagicLink, magicLinkPath } from "./magic";
import { DOC_ALERT_TIERS, ESCALATION_LADDER, UNDERTAKING_REMINDER_TIERS } from "./constants";

const APP_REMINDER_TIERS = [2, 0]; // days before SLA expiry
const UNDERTAKING_ESCALATE_AFTER = 0; // days overdue -> level 1
const UNDERTAKING_ESCALATE_L2_AFTER = 5; // days overdue -> level 2
const UNDERTAKING_NON_COMPLIANT_AFTER = 3; // Feature 8: days overdue -> flag + suspension recommendation

let lastTickAt = 0;
let inFlight: Promise<void> | null = null;

/** Throttled entry point used by page renders. */
export async function ensureTick(): Promise<void> {
  const minGap = process.env.DEMO_MODE === "true" ? 3_000 : 60_000;
  const now = Date.now();
  if (inFlight) return inFlight;
  if (now - lastTickAt < minGap) return;

  inFlight = runSchedulerTick()
    .catch((err) => {
      console.error("[scheduler] tick failed:", err);
    })
    .finally(() => {
      lastTickAt = Date.now();
      inFlight = null;
    });
  return inFlight;
}

export async function runSchedulerTick(): Promise<void> {
  // Sequential to keep SQLite happy (no concurrent writers).
  await tickApplications();
  await tickEvc();
  await tickUndertakings();
  await tickDocuments();
}

// ---------------------------------------------------------------------------
// 1. Applications — SLA reminders + escalation ladder
// ---------------------------------------------------------------------------

async function tickApplications() {
  const now = new Date();
  const open = await db.application.findMany({
    where: { status: { in: ["IN_PROGRESS", "AWAITING_INSTITUTION"] } },
    include: { institution: { select: { name: true } } },
  });

  for (const app of open) {
    const ownerRole = stageOwnerRole(app.currentStage);

    // --- reminders before the SLA expires
    if (app.dueAt) {
      const daysLeft = Math.ceil(daysBetween(now, app.dueAt));
      const fired = parseNumberArray(app.remindedTiers);

      for (const tier of APP_REMINDER_TIERS) {
        if (daysLeft <= tier && !fired.includes(tier) && daysLeft >= 0) {
          await notifyRole(ownerRole, {
            type: "SLA_REMINDER",
            title: `${app.refNumber} — SLA due ${daysLeft === 0 ? "today" : `in ${daysLeft} day(s)`}`,
            body: `Stage "${stageLabelOf(app.currentStage)}" at ${app.institution.name}.`,
            link: `/applications/${app.id}`,
          }, app.regionId);
          if (app.assignedToId) {
            await notifyUser(app.assignedToId, {
              type: "SLA_REMINDER",
              title: `${app.refNumber} — SLA due ${daysLeft === 0 ? "today" : `in ${daysLeft} day(s)`}`,
              body: `Stage "${stageLabelOf(app.currentStage)}" at ${app.institution.name}.`,
              link: `/applications/${app.id}`,
            });
          }
          await db.application.update({
            where: { id: app.id },
            data: { remindedTiers: toJson([...fired, tier]) },
          });
        }
      }
    }

    // --- escalation ladder once overdue
    if (!app.dueAt || app.dueAt.getTime() > now.getTime()) continue;

    const daysOver = Math.floor(daysBetween(app.dueAt, now));
    let target = 0;
    for (const rung of ESCALATION_LADDER) if (daysOver >= rung.afterDays) target = rung.level;
    if (target === 0 || app.escalationLevel >= target) continue;

    const rung = ESCALATION_LADDER.find((r) => r.level === target)!;

    await db.$transaction([
      db.application.update({ where: { id: app.id }, data: { escalationLevel: target } }),
      db.escalation.create({
        data: {
          entityType: "APPLICATION",
          entityId: app.id,
          level: target,
          toRole: rung.toRole,
          reason: `${app.refNumber} is ${daysOver} day(s) overdue at stage "${stageLabelOf(app.currentStage)}" (${app.institution.name}).`,
        },
      }),
    ]);

    await notifyRole(rung.toRole, {
      type: "ESCALATION",
      title: `Escalation L${target}: ${app.refNumber}`,
      body: `${daysOver} day(s) overdue at ${stageLabelOf(app.currentStage)} — ${app.institution.name}.`,
      link: `/applications/${app.id}`,
    }, app.regionId);

    await audit("SYSTEM", "ESCALATED", "Application", app.id, { level: target, daysOver, refNumber: app.refNumber });
  }
}

// ---------------------------------------------------------------------------
// 2. EVC visits — queued too long -> overdue + escalate
// ---------------------------------------------------------------------------

async function tickEvc() {
  const now = new Date();
  const pending = await db.evcVisit.findMany({
    where: { status: { in: ["QUEUED", "SCHEDULED"] } },
    include: { application: { select: { id: true, refNumber: true, regionId: true, institution: { select: { name: true } } } } },
  });

  for (const evc of pending) {
    if (!evc.dueAt || evc.dueAt.getTime() > now.getTime()) continue;

    await db.evcVisit.update({ where: { id: evc.id }, data: { status: "OVERDUE" } });

    await db.escalation.create({
      data: {
        entityType: "EVC",
        entityId: evc.id,
        level: 1,
        toRole: "REGIONAL_OFFICER",
        reason: `EVC visit for ${evc.application.refNumber} (${evc.application.institution.name}) was not completed within the prescribed timeline.`,
      },
    });

    await notifyRole("REGIONAL_OFFICER", {
      type: "ESCALATION",
      title: `EVC overdue: ${evc.application.refNumber}`,
      body: `${evc.application.institution.name} — inspection not completed in time.`,
      link: `/applications/${evc.application.id}`,
    }, evc.application.regionId);

    await notifyRole("EVC_COORDINATOR", {
      type: "EVC_OVERDUE",
      title: `EVC overdue: ${evc.application.refNumber}`,
      body: "Schedule or complete the visit immediately; the case has been escalated to the Regional Officer.",
      link: `/evc`,
    }, evc.application.regionId);

    await audit("SYSTEM", "EVC_OVERDUE", "EvcVisit", evc.id, { refNumber: evc.application.refNumber });
  }
}

// ---------------------------------------------------------------------------
// 3. Undertakings (deficiencies + post-approval conditions)
// ---------------------------------------------------------------------------

async function tickUndertakings() {
  const now = new Date();
  const open = await db.undertaking.findMany({
    where: { status: { in: ["PENDING", "SUBMITTED", "OVERDUE", "ESCALATED"] } },
    include: { institution: { select: { id: true, name: true, regionId: true } } },
  });

  for (const u of open) {
    const daysLeft = Math.ceil(daysBetween(now, u.dueAt));
    const fired = parseNumberArray(u.remindedTiers);

    // reminders before due
    for (const tier of UNDERTAKING_REMINDER_TIERS) {
      if (daysLeft <= tier && daysLeft >= 0 && !fired.includes(tier) && u.status === "PENDING") {
        // Feature 6 — every reminder carries a single-use, 72-hour link so the
        // institution can respond without hunting for a login.
        const magic = await issueMagicLink({
          purpose: "UNDERTAKING_RESPONSE",
          entityId: u.id,
          institutionId: u.institutionId,
        });
        await notifyInstitution(u.institutionId, {
          type: "UNDERTAKING_REMINDER",
          title: `Compliance due ${tier === 0 ? "today" : `in ${tier} day(s)`}: ${u.title}`,
          body: `${u.description}\n\nRespond directly (no login needed, valid 72 hours): ${magicLinkPath(magic.token)}`,
          link: `/institution/respond/${u.id}`,
        });
        await db.undertaking.update({
          where: { id: u.id },
          data: { remindedTiers: toJson([...fired, tier]) },
        });
      }
    }

    // overdue + escalation
    if (daysLeft < 0) {
      const daysOver = Math.abs(daysLeft);

      if (u.status !== "OVERDUE" && u.status !== "ESCALATED") {
        await db.undertaking.update({ where: { id: u.id }, data: { status: "OVERDUE" } });
        await db.escalation.create({
          data: {
            entityType: "UNDERTAKING",
            entityId: u.id,
            level: 1,
            toRole: "REGIONAL_OFFICER",
            reason: `Undertaking "${u.title}" is ${daysOver} day(s) overdue — ${u.institution.name}.`,
          },
        });
        await notifyRole("REGIONAL_OFFICER", {
          type: "ESCALATION",
          title: `Undertaking overdue: ${u.title}`,
          body: `${u.institution.name} — ${daysOver} day(s) past the compliance deadline.`,
          link: `/undertakings`,
        }, u.institution.regionId);
        await notifyInstitution(u.institutionId, {
          type: "UNDERTAKING_OVERDUE",
          title: `Overdue: ${u.title}`,
          body: `This compliance item was due ${daysOver} day(s) ago and has been escalated to the Regional Officer.`,
          link: `/institution/respond/${u.id}`,
        });
        await audit("SYSTEM", "UNDERTAKING_OVERDUE", "Undertaking", u.id, { title: u.title, daysOver });
        await recordTrustEvent({
          institutionId: u.institutionId,
          applicationId: u.applicationId,
          event: "UNDERTAKING_OVERDUE",
          note: `"${u.title}" went ${daysOver} day(s) overdue`,
        });
        continue;
      }

      if (u.status === "OVERDUE" && daysOver >= UNDERTAKING_ESCALATE_L2_AFTER) {
        const already = await db.escalation.findFirst({
          where: { entityType: "UNDERTAKING", entityId: u.id, level: 2 },
        });
        if (!already) {
          await db.undertaking.update({ where: { id: u.id }, data: { status: "ESCALATED" } });
          await db.escalation.create({
            data: {
              entityType: "UNDERTAKING",
              entityId: u.id,
              level: 2,
              toRole: "BUREAU_OFFICER",
              reason: `Undertaking "${u.title}" remains unresolved ${daysOver} days past deadline — ${u.institution.name}.`,
            },
          });
          await notifyRole("BUREAU_OFFICER", {
            type: "ESCALATION",
            title: `Escalation L2: ${u.title}`,
            body: `${u.institution.name} — ${daysOver} days overdue. Recommend action under APH non-compliance provisions.`,
            link: `/undertakings`,
          });
          await audit("SYSTEM", "UNDERTAKING_ESCALATED", "Undertaking", u.id, { title: u.title, daysOver });
        }
      }

      // ---- Feature 8: flag non-compliance and ask a human about suspension ----
      // NON_COMPLIANT is a VISIBILITY FLAG, not a penalty: it changes nothing
      // about the institution's ability to work. Suspension is only ever the
      // result of the Competent Authority approving the recommendation below.
      if (daysOver >= UNDERTAKING_NON_COMPLIANT_AFTER) {
        const inst = await db.institution.findUnique({
          where: { id: u.institutionId },
          select: { id: true, name: true, status: true, regionId: true },
        });

        if (inst && inst.status === "ACTIVE") {
          await db.institution.update({ where: { id: inst.id }, data: { status: "NON_COMPLIANT" } });
          await audit("SYSTEM", "INSTITUTION_NON_COMPLIANT", "Institution", inst.id, {
            undertaking: u.title,
            daysOver,
            note: "Visibility flag only — not a suspension.",
          });
        }

        const existing = await db.task.findFirst({
          where: { type: "SUSPENSION_RECOMMENDATION", entityType: "UNDERTAKING", entityId: u.id },
        });
        if (!existing) {
          await db.task.create({
            data: {
              type: "SUSPENSION_RECOMMENDATION",
              title: `Suspension recommendation — ${inst?.name ?? u.institution.name}`,
              body: `Undertaking "${u.title}" has been overdue for ${daysOver} day(s). The institution is flagged NON-COMPLIANT. ` +
                `Consider whether approval should be suspended under the APH non-compliance provisions. Approving below is the only way an institution is suspended.`,
              entityType: "UNDERTAKING",
              entityId: u.id,
              institutionId: u.institutionId,
              toRole: "COMPETENT_AUTHORITY",
            },
          });
          await notifyRole("COMPETENT_AUTHORITY", {
            type: "SUSPENSION_RECOMMENDATION",
            title: `Recommendation: consider suspension — ${inst?.name ?? u.institution.name}`,
            body: `"${u.title}" is ${daysOver} day(s) overdue. Review and approve or reject the recommendation on the Escalations page.`,
            link: "/escalations",
          });
          await audit("SYSTEM", "SUSPENSION_RECOMMENDATION_RAISED", "Undertaking", u.id, {
            institution: inst?.name ?? null,
            daysOver,
            note: "Recommendation only — the Competent Authority decides.",
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Documents — tiered expiry alerts (90 / 60 / 30 / 7 / 0)
// ---------------------------------------------------------------------------

async function tickDocuments() {
  const now = new Date();
  const docs = await db.document.findMany({
    where: { status: { in: ["VALID", "EXPIRING_SOON"] } },
    include: { institution: { select: { id: true, name: true, regionId: true } } },
  });

  for (const doc of docs) {
    const daysLeft = Math.ceil(daysBetween(now, doc.expiresAt));
    const fired = parseNumberArray(doc.alertedTiers);

    if (daysLeft < 0) {
      await expireDocument(doc.id);
      continue;
    }

    for (const tier of DOC_ALERT_TIERS) {
      if (daysLeft <= tier && !fired.includes(tier)) {
        await db.document.update({
          where: { id: doc.id },
          data: { status: "EXPIRING_SOON", alertedTiers: toJson([...fired, tier]) },
        });
        await notifyInstitution(doc.institutionId, {
          type: "DOC_EXPIRY",
          title: `${doc.type.replace(/_/g, " ")} expires ${daysLeft === 0 ? "today" : `in ${daysLeft} day(s)`}`,
          body: "Please upload the renewed document before the validity lapses.",
          link: `/documents`,
        });
        if (tier <= 30) {
          await notifyRole("COMPLIANCE_OFFICER", {
            type: "DOC_EXPIRY",
            title: `${doc.institution.name}: ${doc.type.replace(/_/g, " ")} expires in ${daysLeft} day(s)`,
            body: "Monitor this institution for renewal before the document lapses.",
            link: `/documents`,
          }, doc.institution.regionId);
        }
        break; // one new tier per tick keeps notifications readable
      }
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function stageOwnerRole(stage: string): string {
  const map: Record<string, string> = {
    SCRUTINY: "SCRUTINY_OFFICER",
    RE_SCRUTINY: "SCRUTINY_OFFICER",
    INSTITUTION_RESPONSE: "INSTITUTION",
    EVC: "EVC_COORDINATOR",
    COMMITTEE: "COMMITTEE_MEMBER",
    DECISION: "COMPETENT_AUTHORITY",
  };
  return map[stage] ?? "REGIONAL_OFFICER";
}

function stageLabelOf(stage: string): string {
  const map: Record<string, string> = {
    SCRUTINY: "Scrutiny",
    RE_SCRUTINY: "Re-Scrutiny",
    INSTITUTION_RESPONSE: "Awaiting Institution Reply",
    EVC: "Expert Visit Committee",
    COMMITTEE: "Committee Review",
    DECISION: "Final Decision",
    COMPLETED: "Completed",
  };
  return map[stage] ?? stage;
}
