import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return Response.json({ error: "Sessão expirada." }, { status: 401 });
    }

    const { id: documentId } = await context.params;
    if (!UUID_PATTERN.test(documentId)) {
      return Response.json({ error: "Documento inválido." }, { status: 400 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError || !membership) {
      return Response.json({ error: "Família não encontrada." }, { status: 403 });
    }
    const householdId = String(membership.household_id);

    const { data: document, error: documentError } = await supabase
      .from("financial_documents")
      .select("storage_path")
      .eq("id", documentId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document) {
      return Response.json({ error: "Documento não encontrado." }, { status: 404 });
    }

    const storagePath = String(document.storage_path);
    const { error: storageError } = await supabase.storage
      .from("financial-documents")
      .remove([storagePath]);
    if (storageError) throw storageError;

    const { data, error: deleteError } = await supabase.rpc(
      "delete_financial_document",
      {
        household_id_input: householdId,
        document_id_input: documentId,
      },
    );
    if (deleteError) throw deleteError;

    return Response.json({
      deletedTransactions: Number(data?.deleted_transactions ?? 0),
      deletedInvoices: Number(data?.deleted_invoices ?? 0),
      deletedInstallments: Number(data?.deleted_installments ?? 0),
      deletedDebts: Number(data?.deleted_debts ?? 0),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível excluir o documento.",
      },
      { status: 500 },
    );
  }
}
