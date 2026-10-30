import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="card max-w-md p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-indigo-600">Error 404</p>
        <h1 className="mt-2 text-xl font-bold text-ink">This page does not exist</h1>
        <p className="mt-2 text-sm text-ink-soft">
          The case file or screen you asked for is not available, or it falls outside what your role is permitted to
          see.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/dashboard" className="btn-primary btn-sm">
            Back to dashboard
          </Link>
          <Link href="/login" className="btn-secondary btn-sm">
            Sign in as another user
          </Link>
        </div>
      </div>
    </div>
  );
}
