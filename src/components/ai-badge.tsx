import { Sparkles } from "lucide-react";

/**
 * Every machine-generated artefact in the portal carries this badge.
 * It is a hard rule of the build: AI/OCR output is advisory and must be visibly
 * labelled as such wherever it appears.
 */
export function AiBadge({
  label = "AI-generated",
  tone = "violet",
  className = "",
}: {
  label?: string;
  tone?: "violet" | "amber";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset no-print ${
        tone === "violet"
          ? "bg-violet-50 text-violet-700 ring-violet-200"
          : "bg-amber-50 text-amber-800 ring-amber-200"
      } ${className}`}
      title="Produced automatically — advisory only, requires human confirmation"
    >
      <Sparkles className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
