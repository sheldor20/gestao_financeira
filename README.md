# Dois — Gestão financeira para casal

Aplicação de gestão financeira para duas pessoas, com visões individuais, compartilhadas e consolidadas.

## Situação atual

Esta etapa entrega a experiência funcional local e o esquema inicial do Supabase. Os cadastros e regras funcionam durante a sessão, mas a interface ainda não persiste dados no banco. A migração cria somente tabelas, índices e políticas de segurança: nenhum usuário, salário, lançamento ou dado de demonstração é inserido.

## Funcionalidades

- Dashboard por mês e por escopo: consolidado, Kim, Alexandre e compartilhado.
- Entradas, saídas, transferências, categorias, status e observações.
- Regra de divisão compartilhada proporcional à renda, igual ou personalizada.
- Dívidas, parcelas, vencimentos e baixa de pagamento.
- Orçamentos mensais por categoria e responsável.
- Metas financeiras com aportes e percentual concluído.
- Entradas e despesas recorrentes mensais ou anuais.
- Contas, reservas, investimentos, previdência, seguros e outros bens.
- Cadastro de cartões e importação de faturas em PDF, CSV ou TXT.
- Categorização automática e revisão manual de compras importadas.

## Desenvolvimento

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Validação

```bash
npm test
npm run build
```

## Banco de dados

O esquema versionado está em `supabase/migrations`. Ele cria 14 tabelas com Row Level Security e não contém comandos de carga de dados. A conexão da interface ao Supabase será feita numa próxima PR, depois da configuração dos dois usuários.

## Arquitetura planejada

- Next.js + TypeScript
- Vercel para hospedagem
- Supabase Auth para o acesso do casal
- Supabase Postgres com RLS para isolamento por família (estrutura criada, integração pendente)
- Supabase Storage para faturas
- GitHub em `git@github.com:sheldor20/gestao_financeira.git`

Veja [Especificação funcional](docs/FUNCTIONAL_SPEC.md) e [Plano de arquitetura](docs/ARCHITECTURE.md).
