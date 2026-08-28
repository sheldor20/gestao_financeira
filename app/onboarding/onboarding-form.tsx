"use client";

import { FormEvent, useState } from "react";
import { Copy, UserRoundPlus, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PersonId } from "@/lib/finance-domain";

export function OnboardingForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [person, setPerson] = useState<PersonId>("kim");
  const [name, setName] = useState("Kim");
  const [invite, setInvite] = useState("");
  const [generatedInvite, setGeneratedInvite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function choosePerson(value: PersonId) {
    setPerson(value);
    setName(value === "kim" ? "Kim" : "Alexandre");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createSupabaseBrowserClient();

    if (mode === "join") {
      const { error: joinError } = await supabase.rpc(
        "join_finance_household",
        {
          invite_code_input: invite,
          person_key_input: person,
          display_name_input: name,
        },
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

    const { data: code, error: inviteError } = await supabase.rpc(
      "create_household_invite",
      { household_id_input: householdId },
    );
    if (inviteError) {
      setError(inviteError.message);
      setLoading(false);
      return;
    }
    setGeneratedInvite(String(code));
    setLoading(false);
  }

  if (generatedInvite) {
    return (
      <main className="auth-page">
        <section className="auth-card onboarding-card">
          <div className="brand-mark">2</div>
          <h1>Espaço criado</h1>
          <p>Envie este código somente para a outra pessoa do casal.</p>
          <div className="invite-code">
            <strong>{generatedInvite}</strong>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(generatedInvite)}
              aria-label="Copiar código"
            >
              <Copy size={18} />
            </button>
          </div>
          <button
            className="primary-button auth-submit"
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
          >
            Entrar no painel
          </button>
        </section>
      </main>
    );
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
        <h1>Quem é você?</h1>
        <div className="onboarding-modes">
          <button
            type="button"
            className={mode === "create" ? "active" : ""}
            onClick={() => setMode("create")}
          >
            <UsersRound size={20} /> Criar espaço
          </button>
          <button
            type="button"
            className={mode === "join" ? "active" : ""}
            onClick={() => setMode("join")}
          >
            <UserRoundPlus size={20} /> Usar convite
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Pessoa</span>
            <select value={person} onChange={(event) => choosePerson(event.target.value as PersonId)}>
              <option value="kim">Kim</option>
              <option value="alexandre">Alexandre</option>
            </select>
          </label>
          <label>
            <span>Nome exibido</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          {mode === "join" && (
            <label>
              <span>Código do convite</span>
              <input
                value={invite}
                onChange={(event) => setInvite(event.target.value.toUpperCase())}
                required
                maxLength={12}
              />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? "Aguarde…" : mode === "create" ? "Criar espaço seguro" : "Entrar no espaço"}
          </button>
        </form>
      </section>
    </main>
  );
}
