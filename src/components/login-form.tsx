"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "@/app/actions/auth";
import { Loader2, LogIn } from "lucide-react";

type DemoAccount = { email: string; name: string; roleLabel: string; scope: string; group: string };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full py-2.5" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ accounts }: { accounts: DemoAccount[] }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});
  const [email, setEmail] = useState(accounts[0]?.email ?? "");
  const [password, setPassword] = useState("demo123");

  const grouped = accounts.reduce<Record<string, DemoAccount[]>>((acc, a) => {
    (acc[a.group] ||= []).push(a);
    return acc;
  }, {});

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,1.1fr]">
      {/* Sign-in card */}
      <div className="card card-pad">
        <h2 className="text-base font-semibold text-ink">Officer &amp; Institution Sign-in</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Access is role-scoped. You only ever see what your role is permitted to see.
        </p>

        <form action={formAction} className="mt-5 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {state?.error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {state.error}
            </p>
          ) : null}

          <Submit />
        </form>

        <p className="mt-4 text-center text-[11px] text-ink-faint">
          Prototype credentials — every demo account uses the password <span className="font-mono font-semibold">demo123</span>
        </p>
      </div>

      {/* One-click demo accounts */}
      <div className="card card-pad">
        <h2 className="text-base font-semibold text-ink">Demo accounts</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Click any account to load it into the form — role-based dashboards differ completely.
        </p>

        <div className="mt-4 max-h-[420px] space-y-4 overflow-y-auto pr-1">
          {Object.entries(grouped).map(([group, list]) => (
            <div key={group}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{group}</p>
              <div className="space-y-1.5">
                {list.map((a) => {
                  const active = a.email === email;
                  return (
                    <button
                      key={a.email}
                      type="button"
                      onClick={() => {
                        setEmail(a.email);
                        setPassword("demo123");
                      }}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-ink">{a.name}</p>
                        <p className="truncate font-mono text-[11px] text-indigo-600">{a.email}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] font-medium text-ink-soft">{a.roleLabel}</p>
                        <p className="text-[10px] text-ink-faint">{a.scope}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
