"use client";

import { FormEvent, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PersonId } from "@/lib/finance-domain";

export function OnboardingForm({
  person,
  name,
}: {
  person: PersonId;
  name: "Kim" | "Alexandre";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createSupabaseBrowserClient();

    if (person === "alexandre") {
      const { error: joinError } = await supabase.rpc(
        "join_designated_finance_household",
        { display_name_input: name },
      );
      if (joinError) {
        setError(joinError.message);
        setLoading(false);
        return;
      }
      router.replace("/");
      router.refresh();
      return;
    }

    const { data: householdId, error: createError } = await supabase.rpc(
      "bootstrap_finance_household",
      {
        person_key_input: person,
        display_name_input: name,
      },
    );
    if (createError || !householdId) {
      setError(createError?.message ?? "Não foi possível criar o espaço.");
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-card onboarding-card">
        <div className="auth-brand">
          <div className="brand-mark">2</div>
          <div>
            <strong>Dois</strong>
            <span>Configuração do casal</span>
          </div>
        </div>
        <h1>Acesso reconhecido</h1>
        <div className="security-note">
          <ShieldCheck size={18} />
          Você está entrando como {name}
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Pessoa</span>
            <input value={name} readOnly aria-readonly="true" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading
              ? "Aguarde…"
              : person === "kim"
                ? "Abrir espaço do casal"
                : "Entrar no espaço do casal"}
          </button>
        </form>
      </section>
    </main>
  );
}
