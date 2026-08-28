import { parseInvoiceText } from "@/app/lib/invoice-parser";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";

const allowedTypes = new Set([
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const owner = String(form.get("owner") ?? "joint");
    const period = String(
      form.get("period") ?? new Date().toISOString().slice(0, 7),
    );
    const cardId = String(form.get("cardId") ?? "") || null;

    if (!(file instanceof File))
      return Response.json({ error: "Selecione uma fatura." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024)
      return Response.json(
        { error: "A fatura deve ter no máximo 10 MB." },
        { status: 400 },
      );
    if (!allowedTypes.has(file.type) && !/\.(pdf|csv|txt)$/i.test(file.name))
      return Response.json(
        { error: "Envie um arquivo PDF, CSV ou TXT." },
        { status: 400 },
      );

    const bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;
    if (
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf")
    ) {
      const pdf = await getDocumentProxy(bytes);
      text = (await extractText(pdf, { mergePages: true })).text;
    } else {
      text = new TextDecoder("utf-8").decode(bytes);
    }

    const parsed = parseInvoiceText(text, period);
    if (!parsed.length)
      return Response.json(
        {
          error:
            "Não encontrei compras com data e valor. Tente CSV/TXT ou um PDF com texto selecionável.",
        },
        { status: 422 },
      );

    const invoiceId = crypto.randomUUID();
    const totalCents = parsed.reduce((sum, item) => sum + item.amountCents, 0);
    const byCategory: Record<string, number> = {};
    parsed.forEach((item) => {
      byCategory[item.category] =
        (byCategory[item.category] ?? 0) + item.amountCents;
    });

    return Response.json(
      {
        invoice: {
          id: invoiceId,
          cardId,
          owner,
          filename: file.name,
          period,
          totalCents,
          itemCount: parsed.length,
          status: "review",
          createdAt: new Date().toISOString(),
        },
        transactions: parsed.map((item) => ({
          id: crypto.randomUUID(),
          owner,
          kind: "expense",
          description: item.description,
          category: item.category,
          amountCents: item.amountCents,
          transactionDate: item.transactionDate,
          status: "paid",
          source: "invoice",
          cardId,
          installmentCurrent: item.installmentCurrent,
          installmentTotal: item.installmentTotal,
        })),
        analysis: {
          totalCents,
          itemCount: parsed.length,
          byCategory,
          sample: parsed.slice(0, 8),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível analisar a fatura.",
      },
      { status: 500 },
    );
  }
}
