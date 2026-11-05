import { useState, type FormEvent } from "react";

interface AuthScreenProps {
  busy: boolean;
  error: string | null;
  onLogin: (username: string, password: string) => Promise<boolean>;
}

export function AuthScreen({ busy, error, onLogin }: AuthScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await onLogin(username, password);
    if (success) setPassword("");
  }

  return (
    <main className="auth-screen">
      <section aria-labelledby="login-title" className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span className="brand-name">
            <strong>Triage Lab</strong>
            <small>AWS SECURITY</small>
          </span>
        </div>
        <div className="auth-heading">
          <p className="eyebrow">LOCAL WORKSPACE</p>
          <h1 id="login-title">Sign in to your workspace</h1>
          <p>Use the local analyst or viewer account configured for this environment.</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              autoFocus
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button login-button" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="auth-note">
          <span className="auth-note-dot" />
          <p>This workspace uses fabricated security events for demonstration.</p>
        </div>
      </section>
    </main>
  );
}
