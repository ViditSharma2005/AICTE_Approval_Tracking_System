/**
 * Feature 7 — deterministic fallback answers.
 *
 * With no OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY the assistant still
 * works: the question is matched against these rules and answered from the same
 * read-only tools. Nothing here invents a date, a rule or a deadline.
 */

export type DemoQa = {
  id: string;
  match: RegExp;
  tool: string;
  args?: (q: string) => Record<string, unknown>;
  intro: string;
  /** Used when the primary tool has nothing to go on. */
  fallbackTool?: string;
};

export const DEMO_QA: DemoQa[] = [
  {
    id: "explain",
    match: /\b(explain|what does .* mean|how do i (comply|fix)|what is required|evidence)\b/i,
    tool: "explainDeficiency",
    fallbackTool: "getUndertakings",
    args: (q) => {
      // Strip the instruction words and use the rest as a title hint.
      const cleaned = q
        .replace(/\b(explain|please|me|the|about|what does|mean|how do i comply|what is required|evidence for|this|deficiency|undertaking)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { title: cleaned.length > 3 ? cleaned : undefined };
    },
    intro: "Here is what this item asks for and the evidence that will satisfy it:",
  },
  {
    id: "status",
    match: /\b(status|where|stage\w*|progress|stuck)\b/i,
    tool: "listPendingCases",
    args: () => ({ limit: 10 }),
    intro: "Here are the cases currently in progress that you can see:",
  },
  {
    id: "pending",
    match: /\b(pending|queue\w*|backlog|awaiting|assigned to me)\b/i,
    tool: "listPendingCases",
    args: () => ({ limit: 10 }),
    intro: "This is your live queue, earliest deadline first:",
  },
  {
    id: "documents",
    match: /\b(document\w*|expir\w*|renew\w*|lapse\w*|noc|lease)\b/i,
    tool: "getExpiringDocuments",
    args: () => ({ withinDays: 90 }),
    intro: "Documents on the expiry register due within 90 days:",
  },
  {
    id: "undertakings",
    match: /\b(undertaking\w*|condition\w*|compliance|deficien\w*)\b/i,
    tool: "getUndertakings",
    args: () => ({}),
    intro: "Open undertakings and deficiencies in your scope:",
  },
  {
    id: "trust",
    match: /\b(trust|standing|score)\b/i,
    tool: "getTrustScore",
    args: (q) => {
      const m = /(?:for|of)\s+([A-Z][A-Za-z.'&\s]{2,40}?)(?:\?|$|,|\.)/.exec(q);
      return { institutionName: m ? m[1].trim() : undefined };
    },
    intro: "Compliance trust score (advisory — it never triggers an action by itself):",
  },
  {
    id: "audit",
    match: /\b(audit\w*|who (did|changed|approved)|history|trail)\b/i,
    tool: "searchAuditLog",
    args: () => ({ limit: 10 }),
    intro: "Most recent entries in the tamper-evident audit log:",
  },
];

export function matchDemoQa(question: string): DemoQa | null {
  return DEMO_QA.find((q) => q.match.test(question)) ?? null;
}

export const CHAT_GUARDRAILS = `You are the AICTE Approval & Compliance Portal assistant.

Hard rules you must never break:
1. Answer ONLY from the data returned by your tools. If a tool returns nothing,
   say "I don't have that information." — never invent a date, deadline, clause,
   reference number, officer name or rule.
2. You are READ-ONLY. You cannot approve, reject, suspend, escalate or change
   anything, and you must never claim that you have. If asked to act, say the
   action must be taken by the authorised officer and point them to the screen.
3. Every answer about a deficiency, rule or Appeal Process Handbook clause must
   end with: "This is AI assistance; official interpretation rests with AICTE."
4. End your answer with the source links the tool returned, as a short list.
5. Be brief and plain: officers read this on a phone between meetings.`;

export const ROLE_SUGGESTIONS: Record<string, string[]> = {
  INSTITUTION: [
    "What is the status of my application?",
    "Which of my documents expire soon?",
    "Explain the deficiency raised against me",
    "What is my compliance trust score?",
  ],
  SCRUTINY_OFFICER: [
    "What is in my queue right now?",
    "Which cases are closest to their SLA?",
    "Show me the undertakings awaiting verification",
    "Summarise the trust score of this institution",
  ],
  EVC_COORDINATOR: ["Which inspections are queued?", "When is this visit scheduled?", "What is pending in my region?"],
  COMPLIANCE_OFFICER: ["Which documents expire in 90 days?", "Which undertakings are overdue?", "What is awaiting my verification?"],
  REGIONAL_OFFICER: ["What is escalated to me?", "Which officers are at capacity?", "Show the audit trail for this case"],
  COMMITTEE_MEMBER: ["What is awaiting committee review?", "Summarise this case file"],
  COMPETENT_AUTHORITY: ["Which cases are ready for decision?", "What was the EVC recommendation?"],
  BUREAU_OFFICER: ["How many cases are pending nationally?", "Which regions are behind?"],
  POLICY_ADMIN: ["Which documents expire soon?", "What changed in the audit log recently?"],
  SYSTEM_ADMIN: ["What is in the audit log?", "Which officers are at capacity?"],
};

export function suggestionsFor(role: string): string[] {
  return ROLE_SUGGESTIONS[role] ?? [
    "What is pending for me?",
    "Which documents expire soon?",
    "Explain this deficiency",
  ];
}
