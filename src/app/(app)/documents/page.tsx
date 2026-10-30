import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Card, CardHeader, EmptyState, TD, TH, THead, TR, Table } from "@/components/ui";
import { DocChip, DocStatusPill, SlaChip } from "@/components/case";
import { ActionForm } from "@/components/forms";
import { addDocument, renewDocument, verifyDocumentRenewal, confirmDocumentDate } from "@/app/actions/document";
import { formatConfidence } from "@/lib/ocr";
import { DOC_TYPE_LABELS, DOC_TYPES } from "@/lib/constants";
import { AlertTriangle, FileWarning } from "lucide-react";
import { fmtDate } from "@/lib/time";
import { TrustBadge } from "@/components/trust-badge";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (user.role === "INSTITUTION") where.institutionId = user.institutionId ?? "__none__";
  else if (!["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)) {
    where.institution = { regionId: user.regionId ?? "__none__" };
  }

  const [documents, institutions] = await Promise.all([
    db.document.findMany({
      where,
      include: { institution: { select: { id: true, name: true, city: true, trustScore: true } } },
      orderBy: { expiresAt: "asc" },
    }),
    db.institution.findMany({
      where:
        user.role === "INSTITUTION"
          ? { id: user.institutionId ?? "__none__" }
          : ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
            ? {}
            : { regionId: user.regionId ?? "__none__" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const expired = documents.filter((d) => d.status === "EXPIRED").length;
  const expiring = documents.filter((d) => d.status === "EXPIRING_SOON").length;
  const renewals = documents.filter((d) => d.status === "RENEWAL_SUBMITTED").length;

  const canVerify = ["COMPLIANCE_OFFICER", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role);
  const canAdd = ["INSTITUTION", "COMPLIANCE_OFFICER", "SYSTEM_ADMIN"].includes(user.role);

  return (
    <div>
      <PageHeader
        title="Document expiry register"
        subtitle="Alerts fire at 90, 60, 30, 7 and 0 days before validity lapses — and escalate if a document expires unrenewed"
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Valid", value: documents.filter((d) => d.status === "VALID").length, tone: "green" as const },
          { label: "Expiring soon", value: expiring, tone: "amber" as const },
          { label: "Renewal submitted", value: renewals, tone: "blue" as const },
          { label: "Expired", value: expired, tone: "red" as const },
        ].map((s) => (
          <Card key={s.label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{s.label}</p>
            <p className="mt-1 text-2xl font-bold text-ink tnum">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Registered documents" subtitle="Sorted by soonest expiry" />
        </div>

        {documents.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Document</TH>
                <TH>Institution</TH>
                <TH>Current copy</TH>
                <TH>Valid till</TH>
                <TH>Status</TH>
                <TH>Renewal</TH>
              </TR>
            </THead>
            <tbody>
              {documents.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium">{DOC_TYPE_LABELS[d.type] ?? d.type.replace(/_/g, " ")}</TD>
                  <TD className="max-w-[200px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{d.institution.name}</span><TrustBadge institutionId={d.institution.id} score={d.institution.trustScore} name={d.institution.name} /></span></TD>
                  <TD>
                    <DocChip fileName={d.fileName} />
                  </TD>
                  <TD className="tnum text-xs">
                    {fmtDate(d.expiresAt)}
                    <p className="mt-0.5">
                      <SlaChip dueAt={d.expiresAt} />
                    </p>
                    {d.ocrExtractedDate ? (
                      <p className="mt-1 text-[11px] text-ink-soft">
                        Entered: <span className="font-medium text-ink">{fmtDate(d.enteredDate ?? d.expiresAt)}</span>
                        {" | "}
                        OCR: <span className="font-medium text-ink">{fmtDate(d.ocrExtractedDate)}</span>{" "}
                        <span className="text-ink-faint">({formatConfidence(d.ocrConfidence)})</span>
                      </p>
                    ) : null}
                    {d.dateConflict ? (
                      <p className="mt-1 inline-flex items-start gap-1 rounded-lg bg-amber-50 px-1.5 py-1 text-[11px] font-medium leading-snug text-amber-800 ring-1 ring-inset ring-amber-200">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        The date read from the document differs from the date entered in the portal
                      </p>
                    ) : null}
                    {d.officerConfirmed && !d.dateConflict && d.ocrExtractedDate ? (
                      <p className="mt-1 text-[11px] text-emerald-700">Date confirmed by {d.verifiedBy ?? "officer"}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <DocStatusPill status={d.status} />
                  </TD>
                  <TD>
                    {d.status === "RENEWAL_SUBMITTED" ? (
                      <div className="space-y-1">
                        <DocChip fileName={d.renewalUrl} />
                        {d.renewalNote ? <p className="text-[11px] text-ink-faint">{d.renewalNote}</p> : null}
                      </div>
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    )}

                    {(user.role === "INSTITUTION" || user.role === "SYSTEM_ADMIN") && d.status !== "RENEWAL_SUBMITTED" ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-indigo-600 hover:underline">
                          Upload renewed copy
                        </summary>
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <ActionForm
                            action={renewDocument}
                            hidden={{ docId: d.id }}
                            submitLabel="Submit renewal"
                            variant="btn-primary btn-sm"
                            pendingLabel="Uploading…"
                          >
                            <input name="fileName" className="input" placeholder="lease-deed-2027.pdf" required />
                            <input type="date" name="expiresAt" className="input" required />
                            <textarea name="note" className="textarea min-h-[60px]" placeholder="Note for the compliance officer (optional)" />
                          </ActionForm>
                        </div>
                      </details>
                    ) : null}

                    {canVerify && d.dateConflict ? (
                      <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-[11px] font-semibold text-amber-900">Resolve the date mismatch</p>
                        <p className="text-[11px] text-amber-800">
                          Entered {fmtDate(d.enteredDate ?? d.expiresAt)} · read from document {fmtDate(d.ocrExtractedDate)}.
                          AI/OCR output is advisory — confirm only after checking the original.
                        </p>
                        <ActionForm
                          action={confirmDocumentDate}
                          hidden={{ docId: d.id, choice: "ENTERED" }}
                          submitLabel="Confirm entered date"
                          variant="btn-secondary btn-sm"
                          pendingLabel="Confirming…"
                          className="space-y-2"
                        >
                          <input type="hidden" name="note" value="" />
                        </ActionForm>
                        <ActionForm
                          action={confirmDocumentDate}
                          hidden={{ docId: d.id, choice: "OCR" }}
                          submitLabel="Use OCR date instead"
                          variant="btn-secondary btn-sm"
                          pendingLabel="Applying…"
                          confirm="Replace the entered date with the date read from the document?"
                          className="space-y-2"
                        >
                          <input type="hidden" name="note" value="" />
                        </ActionForm>
                      </div>
                    ) : null}

                    {canVerify && d.status === "RENEWAL_SUBMITTED" ? (
                      <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <ActionForm
                          action={verifyDocumentRenewal}
                          hidden={{ docId: d.id, decision: "VERIFIED" }}
                          submitLabel="Verify renewal"
                          variant="btn-success btn-sm"
                          pendingLabel="Verifying…"
                        >
                          <p className="text-[11px] text-ink-soft">
                            Applying this resets the expiry countdown using the date the institution submitted.
                          </p>
                        </ActionForm>
                        <ActionForm
                          action={verifyDocumentRenewal}
                          hidden={{ docId: d.id, decision: "REJECTED" }}
                          submitLabel="Reject"
                          variant="btn-danger btn-sm"
                          pendingLabel="Recording…"
                        >
                          <textarea name="note" className="textarea min-h-[56px]" placeholder="Why is the renewal rejected?" required />
                        </ActionForm>
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<FileWarning className="h-7 w-7" />}
              title="No documents on the register"
              hint="Register your institution's statutory documents so their validity can be watched."
            />
          </div>
        )}
      </Card>

      {canAdd ? (
        <Card className="mt-5">
          <CardHeader title="Register a document" subtitle="Add a statutory document and its validity end date" />
          <ActionForm action={addDocument} submitLabel="Add to register" pendingLabel="Saving…" className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Document type</label>
              <select name="type" className="select" required>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">File name / reference</label>
              <input name="fileName" className="input" placeholder="fire-noc-2026.pdf" required />
            </div>
            <div>
              <label className="label">Valid till</label>
              <input type="date" name="expiresAt" className="input" required />
            </div>
            {institutions.length > 1 || user.role !== "INSTITUTION" ? (
              <div className="sm:col-span-3">
                <label className="label">Institution</label>
                <select name="institutionId" className="select" required>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
