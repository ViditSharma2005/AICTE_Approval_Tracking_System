import { streamText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { getUser } from "@/lib/session";
import {
  explainDeficiency,
  getApplicationStatus,
  getExpiringDocuments,
  getTrustScore,
  getUndertakings,
  listPendingCases,
  searchAuditLog,
} from "@/lib/chat-tools";
import { CHAT_GUARDRAILS, matchDemoQa } from "@/lib/chat-fallback";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ChatBody = {
  messages?: { role: string; content: string }[];
  context?: { entityType?: string; entityId?: string; label?: string; detail?: string } | null;
};

function provider(): "OPENAI" | "GOOGLE" | null {
  if (process.env.OPENAI_API_KEY) return "OPENAI";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "GOOGLE";
  return null;
}

const tools = {
  getApplicationStatus: tool({
    description: "Look up one application by reference number and report its stage, SLA and assignment.",
    inputSchema: z.object({ refNumber: z.string().describe("Full or partial application reference, e.g. AICTE-2026-NR-0042") }),
    execute: getApplicationStatus,
  }),
  listPendingCases: tool({
    description: "List the applications currently in progress that the caller is allowed to see.",
    inputSchema: z.object({ limit: z.number().optional() }),
    execute: listPendingCases,
  }),
  getExpiringDocuments: tool({
    description: "Find statutory documents expiring within a number of days.",
    inputSchema: z.object({ withinDays: z.number().optional() }),
    execute: getExpiringDocuments,
  }),
  getUndertakings: tool({
    description: "List undertakings and deficiencies, optionally filtered by status (PENDING, OVERDUE, SUBMITTED, VERIFIED).",
    inputSchema: z.object({ status: z.string().optional() }),
    execute: getUndertakings,
  }),
  getTrustScore: tool({
    description: "Explain an institution's compliance trust score and the events behind it.",
    inputSchema: z.object({ institutionName: z.string().optional() }),
    execute: getTrustScore,
  }),
  explainDeficiency: tool({
    description: "Explain a deficiency or undertaking in plain language with an evidence checklist.",
    inputSchema: z.object({ undertakingId: z.string().optional(), title: z.string().optional() }),
    execute: explainDeficiency,
  }),
  searchAuditLog: tool({
    description: "Search the tamper-evident audit log (restricted roles only).",
    inputSchema: z.object({ entityType: z.string().optional(), entityId: z.string().optional(), limit: z.number().optional() }),
    execute: searchAuditLog,
  }),
};

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as ChatBody;
  const history = (body.messages ?? []).filter((m) => m.role === "user" || m.role === "assistant");
  const question = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  const contextLine = body.context?.label
    ? `The user is currently viewing ${body.context.entityType ?? "item"} ${body.context.label}${
        body.context.detail ? ` (${body.context.detail})` : ""
      }. Use that context when it is relevant.`
    : "";

  const system = [
    CHAT_GUARDRAILS,
    `You are helping ${user.name}, role ${user.role.replace(/_/g, " ").toLowerCase()}${
      user.regionId ? " with a regional scope" : ""
    }. Their data access is enforced inside every tool — never try to bypass it.`,
    contextLine,
  ]
    .filter(Boolean)
    .join("\n\n");

  const p = provider();

  // ---- no key: deterministic, tool-backed answers -------------------------
  if (!p) {
    const qa = matchDemoQa(question);
    let answer: string;
    if (!qa) {
      answer =
        "I can answer questions about application status, your pending queue, expiring documents, undertakings and deficiencies, trust scores and the audit log. I don't have that information if it falls outside those. (This deployment runs without an AI provider, so I answer from fixed, tool-backed lookups.)";
    } else {
      const args = (qa.args?.(question) ?? {}) as Record<string, unknown>;
      try {
        const call = async (name: string, a: Record<string, unknown>) => {
          const fn = tools[name as keyof typeof tools] as unknown as {
            execute?: (x: unknown) => Promise<{ ok: boolean; data?: unknown; message: string }>;
          };
          return (await fn.execute?.(a)) ?? { ok: false, message: "tool unavailable" };
        };
        let result = await call(qa.tool, args);
        // "Explain X" with no match should still show what is outstanding.
        if (!result.ok && qa.fallbackTool) result = await call(qa.fallbackTool, {});
        if (!result?.ok) {
          answer = `I don't have that information. (${result?.message ?? "no data"})`;
        } else {
          const rows = Array.isArray(result.data) ? result.data : [result.data];
          const rendered = rows
            .slice(0, 12)
            .map((r) =>
              typeof r === "object" && r !== null
                ? Object.entries(r as Record<string, unknown>)
                    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(" · ")
                : String(r),
            )
            .map((line) => `• ${line}`)
            .join("\n");
          answer = `${qa.intro}\n\n${rendered}\n\nThis is AI assistance; official interpretation rests with AICTE.`;
        }
      } catch (e) {
        answer = `I don't have that information. (${(e as Error).message})`;
      }
    }

    // Stream it back in small chunks so the UI behaves identically either way.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const parts = answer.match(/[\s\S]{1,24}/g) ?? [answer];
        let i = 0;
        const tick = setInterval(() => {
          if (i >= parts.length) {
            clearInterval(tick);
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(parts[i++]));
        }, 12);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  // ---- with a key: real streaming model, same read-only tools -------------
  try {
    const model =
      p === "OPENAI"
        ? (await import("@ai-sdk/openai")).openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini")
        : (await import("@ai-sdk/google")).google(process.env.GOOGLE_MODEL ?? "gemini-2.0-flash");

    const messages: ModelMessage[] = [
      { role: "system", content: system },
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    const result = streamText({
      model,
      messages,
      tools,
      stopWhen: stepCountIs(5),
      temperature: 0.2,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("[chat] provider failed:", error);
    return new Response("The assistant is unavailable right now. Please try again.", { status: 503 });
  }
}
