# Arquitetura e segurança

## Componentes

- Next.js e TypeScript no GitHub.
- Vercel para produção e previews.
- Supabase Auth, Postgres, Row Level Security e Storage privado.
- OpenAI Responses API, chamada apenas no servidor, para ler documentos.

## Modelo de autorização

O `auth.uid()` precisa ter uma associação ativa em `household_members`. Todas as
políticas de dados e arquivos verificam essa associação e o mesmo
`household_id`. O cadastro inicial e o convite são funções `security definer`
com `search_path` explícito, validação do usuário autenticado e limitação de duas
pessoas.

## Pipeline documental

1. O servidor autentica o usuário e valida tipo/tamanho do arquivo.
2. Calcula SHA-256 para impedir reimportação do mesmo conteúdo.
3. Salva o original no bucket privado `financial-documents`.
4. Envia o arquivo à OpenAI como entrada privada do processamento atual.
5. Valida a resposta contra um esquema estruturado.
6. Insere movimentações e atualiza saldos no Postgres.
7. Recalcula a recorrência no banco, exigindo três meses consecutivos.

Sem `OPENAI_API_KEY`, somente faturas de cartão podem usar a leitura
determinística existente; os outros documentos falham com uma mensagem clara
para evitar interpretar créditos e débitos de forma errada.

## Segredos e ambientes

- `NEXT_PUBLIC_SUPABASE_URL` e a chave publicável podem existir no navegador.
- `OPENAI_API_KEY` é segredo exclusivo do servidor/Vercel.
- Nunca usar `service_role` na interface ou versionar `.env.local`.
- Produção deve cadastrar o domínio público nos redirects do Supabase Auth.

## Dados

Valores monetários são inteiros em centavos. Datas financeiras usam `date` e
períodos usam o primeiro dia do mês. Não há seed nem dados de demonstração nas
migrações.
