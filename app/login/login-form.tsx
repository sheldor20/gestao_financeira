"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { getAuthorizedUser } from "@/lib/authorized-users";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    if (!getAuthorizedUser(email)) {
      setError("Este e-mail não está autorizado a acessar o portal.");
      setLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setError("E-mail ou senha inválidos.");
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
        <h1>Entrar</h1>
        <p>Acesso exclusivo para Kim e Alexandre.</p>

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
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
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
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? "Aguarde…" : "Entrar com segurança"}
          </button>
        </form>
      </section>
    </main>
  );
}
