# Dois — Gestão financeira para casal

Sistema privado de gestão financeira para Kim e Alexandre. A fonte das
movimentações é sempre um extrato bancário ou uma fatura de cartão; os saldos de
contas, investimentos, previdência e seguros também podem ser extraídos dos
documentos.

## Fluxo do produto

1. Cada pessoa cria o próprio acesso com e-mail e senha.
2. A primeira pessoa cria o espaço do casal e compartilha um convite de uso
   único; a segunda entra no mesmo espaço.
3. Extratos e faturas são enviados para armazenamento privado.
4. A IA lê o documento no servidor, extrai movimentações e saldos e aplica os
   dados no Supabase.
5. O painel oferece cinco áreas: visão geral, entradas e saídas, dívidas,
   patrimônio e planejamento.

A renda mensal não é cadastrada: ela é a soma das entradas de cada pessoa no
mês. Uma saída só recebe a marcação de fixa depois de aparecer por três meses
consecutivos para a mesma pessoa e estabelecimento.

## Segurança

- Supabase Auth com senha individual.
- Row Level Security em todas as tabelas; uma família não acessa a outra.
- Espaço limitado a duas pessoas ativas.
- Convites aleatórios, de uso único e com validade de sete dias.
- Arquivos em bucket privado, limitado a PDF, CSV e TXT de até 15 MB.
- A chave da OpenAI existe somente no servidor e não vai para o navegador.
- Nenhum dado financeiro ou credencial é versionado no GitHub.

## Configuração

Copie `.env.example` para `.env.local` e preencha:

```text
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://kwjtuodcnwwugfuxtmcv.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
OPENAI_API_KEY=...
OPENAI_DOCUMENT_MODEL=gpt-5.4-nano
```

Depois execute:

```bash
npm install
npm run dev
```

## Validação

```bash
npm run lint
npm test
npm run build
```

O esquema está versionado em `supabase/migrations`. As migrações não criam
usuários nem inserem dados financeiros.

Veja também [Especificação funcional](docs/FUNCTIONAL_SPEC.md) e
[Arquitetura e segurança](docs/ARCHITECTURE.md).
