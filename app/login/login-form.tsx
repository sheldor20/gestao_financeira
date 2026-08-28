"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const supabase = createSupabaseBrowserClient();

    if (mode === "signup" && password.length < 10) {
      setError("Use uma senha com pelo menos 10 caracteres.");
      setLoading(false);
      return;
    }

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          });

    if (result.error) {
      setError(
        mode === "login"
          ? "E-mail ou senha inválidos."
          : result.error.message,
      );
      setLoading(false);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Confira seu e-mail para confirmar o acesso.");
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">2</div>
          <div>
            <strong>Dois</strong>
            <span>Finanças em conjunto</span>
          </div>
        </div>
        <div className="security-note">
          <ShieldCheck size={18} />
          Dados privados e separados por família
        </div>
        <h1>{mode === "login" ? "Entrar" : "Criar acesso"}</h1>
        <p>
          {mode === "login"
            ? "Use seu e-mail e sua senha para acessar o espaço do casal."
            : "Cada pessoa usa seu próprio acesso. Depois vocês entram no mesmo espaço."}
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>E-mail</span>
            <div className="field-with-icon">
              <Mail size={18} />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          </label>
          <label>
            <span>Senha</span>
            <div className="field-with-icon">
              <LockKeyhole size={18} />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === "signup" ? 10 : undefined}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-success">{message}</p>}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading
              ? "Aguarde…"
              : mode === "login"
                ? "Entrar com segurança"
                : "Criar meu acesso"}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode((current) => (current === "login" ? "signup" : "login"));
            setError("");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "Primeiro acesso? Criar conta"
            : "Já tenho acesso"}
        </button>
      </section>
    </main>
  );
}
