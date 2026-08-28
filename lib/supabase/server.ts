import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnvironment } from "./env";

export async function createSupabaseServerClient() {
  const environment = getSupabaseEnvironment();
  if (!environment) {
    throw new Error("Supabase não configurado.");
  }

  const cookieStore = await cookies();
  return createServerClient(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot always mutate cookies. Session refresh is
          // handled by the browser client after the page is rendered.
        }
      },
    },
  });
}
