"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

export default function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (signup && password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${signup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup ? { username, email, password, confirmPassword } : { identifier, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not sign in.");

      setTransitioning(true);
      const transitionDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200;
      window.setTimeout(() => window.location.assign("/"), transitionDelay);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the request.");
      setSubmitting(false);
    }
  }

  return (
    <main className={`auth-shell ${transitioning ? "auth-shell-leaving" : ""}`}>
      <div className="auth-layout">
        <section className="auth-showcase" aria-label="GradFund Finder overview">
          <Link href="/login" className="brand auth-showcase-brand">
            <span className="brand-mark"><span aria-hidden="true">GF</span></span>
            <span className="brand-name">GradFund Finder</span>
          </Link>
          <div className="auth-showcase-content">
            <div className="auth-showcase-kicker"><span /> A clearer path to graduate study</div>
            <h2>Find the work<br />that moves you <span>forward.</span></h2>
            <p>Bring funded opportunities, research leads, and the next steps of your application into one focused workspace.</p>
            <div className="auth-showcase-highlights">
              <div><span className="auth-highlight-icon">01</span><span><strong>Explore with focus</strong><small>Search a growing academic opportunity database.</small></span></div>
              <div><span className="auth-highlight-icon">02</span><span><strong>Keep your work together</strong><small>Save opportunities and prepare outreach drafts.</small></span></div>
            </div>
          </div>
          <div className="auth-showcase-orbit auth-showcase-orbit-one" aria-hidden="true" />
          <div className="auth-showcase-orbit auth-showcase-orbit-two" aria-hidden="true" />
          <div className="auth-showcase-caption">A thoughtful start to your next chapter.</div>
        </section>

        <section className="auth-card">
          <div className="auth-mobile-brand">
            <span className="brand-mark"><span aria-hidden="true">GF</span></span>
            <span className="brand-name">GradFund Finder</span>
          </div>
          <div className="auth-card-topline">{signup ? "GET STARTED" : "YOUR WORKSPACE"}</div>
          <h1>{signup ? "Create your account" : "Welcome back"}</h1>
          <p className="auth-copy">{signup ? "Set up your personal space for graduate opportunities and outreach." : "Sign in to pick up where your graduate search left off."}</p>
          <form className="auth-form" onSubmit={submit}>
            {signup ? (
              <>
                <label htmlFor="auth-username">Username</label>
                <input id="auth-username" className="input input-bordered" autoComplete="username" minLength={3} maxLength={30} required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. talha.research" />
                <div className="auth-hint">3-30 letters, numbers, dots, underscores, or hyphens.</div>
                <label htmlFor="auth-email">Email address</label>
                <input id="auth-email" className="input input-bordered" type="email" autoComplete="email" maxLength={320} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              </>
            ) : (
              <>
                <label htmlFor="auth-identifier">Username or email</label>
                <input id="auth-identifier" className="input input-bordered" autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Your username or email" />
              </>
            )}
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" className="input input-bordered" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 10 : undefined} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={signup ? "At least 10 characters" : "Enter your password"} />
            {signup && (
              <>
                <label htmlFor="auth-confirm-password">Confirm password</label>
                <input id="auth-confirm-password" className="input input-bordered" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your password again" aria-invalid={Boolean(confirmPassword && password !== confirmPassword)} />
                <div className={`auth-hint ${confirmPassword && password !== confirmPassword ? "auth-hint-error" : ""}`}>
                  {confirmPassword && password !== confirmPassword ? "Passwords do not match yet." : "Use at least 10 characters."}
                </div>
              </>
            )}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button button-primary auth-submit" disabled={submitting || transitioning}>
              {submitting ? <><span className="auth-button-spinner" aria-hidden="true" />{transitioning ? "Opening your workspace..." : "Checking your account..."}</> : signup ? "Create account" : "Log in"}
            </button>
          </form>
          <div className="auth-switch">
            {signup ? "Already have an account? " : "New to GradFund Finder? "}
            <Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Create an account"}</Link>
          </div>
          <div className="auth-privacy"><span aria-hidden="true">●</span> Your drafts and Gmail connection stay private to your account.</div>
        </section>
      </div>

      <div className="auth-footnote">Discover broadly. Build your next step with confidence.</div>
      {transitioning && (
        <div className="auth-transition" role="status" aria-live="polite">
          <div className="auth-transition-mark"><span>GF</span></div>
          <div className="auth-transition-title">{signup ? "Your workspace is ready" : "Welcome back"}</div>
          <div className="auth-transition-copy">Opening your opportunities...</div>
          <div className="auth-transition-progress"><span /></div>
        </div>
      )}
    </main>
  );
}
