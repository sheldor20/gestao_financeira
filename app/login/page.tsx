import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function LoginPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark">2</div>
          <h1>Conexão pendente</h1>
          <p>
            Configure a URL e a chave publicável do Supabase no ambiente da
            aplicação. Nenhum segredo deve ser colocado no GitHub.
          </p>
        </section>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return <LoginForm />;
}
