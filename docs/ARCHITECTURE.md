# Plano de arquitetura — GitHub, Vercel e Supabase

## Objetivo da primeira PR

Subir a base funcional atual para `git@github.com:sheldor20/gestao_financeira.git`, com Next.js, documentação, testes de regras financeiras e sem segredos.

## Etapa Supabase

O projeto Supabase é criado vazio nesta PR. A migração inicial entrega:

1. Supabase Auth com dois usuários convidados para a mesma família.
2. Postgres com as tabelas `households`, `household_members`, `profiles`, `accounts`, `credit_cards`, `categories`, `transactions`, `transaction_splits`, `debts`, `budgets`, `goals`, `recurrences`, `invoices` e `invoice_items`.
3. Row Level Security em todas as tabelas, usando a associação ativa em `household_members`.
4. Estrutura para registrar o caminho dos arquivos de fatura, sem criar bucket ou inserir arquivos nesta etapa.
5. Índices e restrições para parcelas, recorrências e deduplicação de faturas.
6. Trilhas de auditoria com `created_by`, `updated_by`, `created_at` e `updated_at`.

A interface, a autenticação e o Storage serão conectados em PRs posteriores. Não há seed: os dados de demonstração permanecem apenas no estado local da interface.

## Etapa Vercel

- Importar o repositório do GitHub.
- Configurar `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Configurar previews por PR.
- Proteger produção até a autenticação do casal estar concluída.

## Critérios de segurança

- Nenhuma `service_role` no navegador.
- Uploads em bucket privado com URLs assinadas.
- RLS testada para impedir acesso entre famílias.
- Valores financeiros armazenados em centavos inteiros.
- Datas mensais persistidas no formato `YYYY-MM` e eventos em `date`/`timestamptz` conforme o caso.
