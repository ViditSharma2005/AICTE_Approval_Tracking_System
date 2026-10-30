/**
 * Feature 2 — OCR date extraction.
 *
 * One function, two implementations behind the same interface:
 *   • with OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY set → the Vercel AI SDK
 *     reads the document and returns a structured, zod-validated object;
 *   • without a key → a deterministic mock (same 800 ms latency, same shape) so
 *     the portal is fully demoable offline.
 *
 * The output is ADVISORY. It never rewrites a document's expiry date by itself —
 * an officer confirms it (see confirmDocumentDate in actions/document.ts).
 */

import { z } from "zod";

export const extractionSchema = z.object({
  documentType: z.string().describe("Document type as printed on the document, e.g. Lease Deed"),
  expiryDate: z.string().nullable().describe("Validity end date as printed on the document, ISO YYYY-MM-DD, or null if not stated"),
  confidence: z.number().min(0).max(1).describe("How confident the extraction is, 0 to 1"),
  summary: z.string().describe("Two to three sentence plain-language summary of the document"),
  keyDates: z
    .array(z.object({ label: z.string(), date: z.string() }))
    .describe("Other important dates found in the document, each as label + ISO date"),
});

export type DocumentExtraction = {
  documentType: string;
  expiryDate: Date | null;
  confidence: number;
  summary: string;
  keyDates: { label: string; date: string }[];
  /** Which engine produced this — surfaced in the UI next to the "AI-generated" badge. */
  engine: "OPENAI" | "GOOGLE" | "MOCK";
};

const MOCK_LATENCY_MS = 800;

/** Stable hash so the mock returns the same answer for the same file, every time. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const TYPICAL_VALIDITY_DAYS: Record<string, number> = {
  LEASE_DEED: 330,
  FIRE_SAFETY: 365,
  LAND_CERTIFICATE: 3650,
  BUILDING_PLAN: 1825,
  AFFILIATION: 1095,
  NA: 730,
};

const TYPE_LABELS: Record<string, string> = {
  LEASE_DEED: "Lease Deed",
  FIRE_SAFETY: "Fire Safety Certificate",
  LAND_CERTIFICATE: "Land Ownership Certificate",
  BUILDING_PLAN: "Approved Building Plan",
  AFFILIATION: "Affiliation Certificate",
  NA: "No Objection Certificate",
};

/**
 * Mock extractor. Deterministic from the file name, so a demo run is repeatable.
 * It deliberately returns dates that sometimes disagree with what the institution
 * typed — that disagreement is the whole point of the conflict workflow.
 */
function mockExtraction(fileUrl: string, documentType?: string): DocumentExtraction {
  const h = hash(fileUrl.toLowerCase());
  const typical = TYPICAL_VALIDITY_DAYS[documentType ?? ""] ?? 730;
  const jitter = (h % 25) - 12; // -12 … +12 days around the typical validity
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + typical + jitter);
  expiry.setHours(0, 0, 0, 0);

  const label = TYPE_LABELS[documentType ?? ""] ?? "Document";
  const issuedOffset = -(typical - jitter);
  const issued = new Date();
  issued.setDate(issued.getDate() + issuedOffset);

  return {
    documentType: label,
    expiryDate: expiry,
    // Mock confidence lands between 0.62 and 0.94 — never a perfect read, which
    // is exactly why a human has to confirm.
    confidence: 0.62 + ((h >> 3) % 33) / 100,
    summary: `The uploaded ${label.toLowerCase()} appears to be issued by the competent local authority in favour of the institution. The mock reader (no API key configured) found a validity end date of ${expiry.toISOString().slice(0, 10)}. Treat this as an unverified reading and check the original before relying on it.`,
    keyDates: [
      { label: "Date of issue", date: issued.toISOString().slice(0, 10) },
      { label: "Validity ends", date: expiry.toISOString().slice(0, 10) },
    ],
    engine: "MOCK",
  };
}

/** True when any configured provider is available. */
export function ocrProvider(): "OPENAI" | "GOOGLE" | "MOCK" {
  if (process.env.OPENAI_API_KEY) return "OPENAI";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "GOOGLE";
  return "MOCK";
}

/**
 * Read a document and pull out its dates.
 * `fileUrl` is whatever identifies the uploaded copy (file name / URL / storage key).
 */
export async function extractDocumentData(fileUrl: string, documentType?: string): Promise<DocumentExtraction> {
  const provider = ocrProvider();

  if (provider === "MOCK") {
    await new Promise((r) => setTimeout(r, MOCK_LATENCY_MS));
    return mockExtraction(fileUrl, documentType);
  }

  try {
    const { generateObject } = await import("ai");
    const model =
      provider === "OPENAI"
        ? (await import("@ai-sdk/openai")).openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini")
        : (await import("@ai-sdk/google")).google(process.env.GOOGLE_MODEL ?? "gemini-2.0-flash");

    const { object } = await generateObject({
      model,
      schema: extractionSchema,
      prompt: `You are reading a document uploaded to an Indian technical-education regulatory portal (AICTE).
Extract the document type, the validity/expiry date as printed on the document, your confidence,
a short plain-language summary, and any other key dates.
Return dates as ISO YYYY-MM-DD. If a field is not present, use null or an empty list — never invent one.
Document reference: ${fileUrl}${documentType ? `\nExpected document class: ${documentType}` : ""}`,
    });

    const parsed = object.expiryDate ? new Date(`${object.expiryDate}T00:00:00Z`) : null;

    return {
      documentType: object.documentType,
      expiryDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      confidence: object.confidence,
      summary: object.summary,
      keyDates: object.keyDates ?? [],
      engine: provider,
    };
  } catch (error) {
    // A key that fails, times out or is rate-limited must never break the workflow —
    // fall back to the mock so the officer still gets a reading to confirm.
    console.error("[ocr] provider failed, falling back to mock:", error);
    return mockExtraction(fileUrl, documentType);
  }
}

/** Two dates conflict when they differ by more than one day. */
export function datesConflict(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  const MS_PER_DAY = 86_400_000;
  return Math.abs(a.getTime() - b.getTime()) > MS_PER_DAY;
}

export function formatConfidence(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) return "—";
  return `${Math.round(confidence * 100)}%`;
}

// ---------------------------------------------------------------------------
// Stored summary format (Feature 3 renders this in the case-file rail)
// ---------------------------------------------------------------------------

export type StoredSummary = {
  summary: string;
  keyDates: { label: string; date: string }[];
  documentType: string;
  engine: string;
  confidence: number;
  at: string;
};

export function encodeSummary(x: DocumentExtraction): string {
  const payload: StoredSummary = {
    summary: x.summary,
    keyDates: x.keyDates ?? [],
    documentType: x.documentType,
    engine: x.engine,
    confidence: x.confidence,
    at: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

/** Tolerates a null column, legacy plain text, or a malformed blob. */
export function decodeSummary(raw: string | null | undefined): StoredSummary | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSummary;
    if (typeof parsed?.summary !== "string") throw new Error("shape");
    return { ...parsed, keyDates: Array.isArray(parsed.keyDates) ? parsed.keyDates : [] };
  } catch {
    return { summary: raw, keyDates: [], documentType: "", engine: "MOCK", confidence: 0, at: "" };
  }
}

// ---------------------------------------------------------------------------
// Feature 3 — summary on demand (used by the case-file rail)
// ---------------------------------------------------------------------------

import { db } from "./db";

/**
 * Return the stored AI summary for a document, generating and persisting it the
 * first time one is asked for. The reading is advisory — the UI must label it.
 */
export async function ensureAiSummary(doc: {
  id: string;
  fileName: string;
  type: string;
  aiSummary: string | null;
  ocrExtractedDate: Date | null;
}): Promise<StoredSummary | null> {
  if (doc.aiSummary) return decodeSummary(doc.aiSummary);

  const extraction = await extractDocumentData(doc.fileName, doc.type);
  const stored = encodeSummary(extraction);
  await db.document.update({
    where: { id: doc.id },
    data: {
      aiSummary: stored,
      // Only fill the OCR date if the pipeline has not already set it.
      ocrExtractedDate: doc.ocrExtractedDate ?? extraction.expiryDate,
      ocrConfidence: extraction.confidence,
    },
  });
  return decodeSummary(stored);
}
