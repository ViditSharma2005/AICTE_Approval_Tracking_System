"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions/application";
import { SubmitButton } from "./client";

/**
 * One wrapper for every server-action form: renders hidden fields, children
 * (server-rendered inputs), validation errors and a pending-aware submit button.
 */
export function ActionForm({
  action,
  hidden = {},
  children,
  submitLabel = "Submit",
  pendingLabel,
  className = "space-y-4",
  confirm,
  variant = "btn-primary",
  extra,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  children?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  confirm?: string;
  variant?: string;
  extra?: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      {children}

      {state?.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          Done. This page now reflects the new state.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <SubmitButton className={variant} pendingLabel={pendingLabel} confirm={confirm}>
          {submitLabel}
        </SubmitButton>
        {extra}
      </div>
    </form>
  );
}
