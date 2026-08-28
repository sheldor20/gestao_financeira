# Especificação funcional

## 1. Estrutura do casal

Todo registro financeiro pertence a Kim, Alexandre ou ao casal. O filtro global possui quatro visões: consolidado, Kim, Alexandre e compartilhado. O mês selecionado também é global.

## 2. Visão geral

- Entradas, saídas e resultado do mês.
- Patrimônio financeiro e capital segurado em totais separados.
- Gastos agrupados por categoria.
- Divisão do aluguel conforme a regra do casal.
- Próximas parcelas e próximas cobranças recorrentes.

## 3. Movimentações

- Entrada, saída ou transferência.
- Responsável, data, valor, categoria, status e observação.
- Origem manual, recorrência ou fatura.
- Alteração de status e exclusão.
- Busca e filtros globais.

## 4. Planejamento

- Orçamentos mensais por categoria e responsável.
- Comparação entre limite e valor efetivamente gasto.
- Metas financeiras individuais ou compartilhadas.
- Aportes e progresso da meta.
- Receitas e despesas recorrentes mensais ou anuais.
- Ativação, pausa e exclusão de recorrências.

## 5. Dívidas

- Valor total e valor da parcela.
- Parcela atual, número total de parcelas e saldo estimado.
- Próximo vencimento.
- Status pendente, pago ou atrasado.

## 6. Patrimônio

- Conta corrente, reserva/poupança e dinheiro.
- Investimentos e previdência.
- Seguros, exibidos como capital segurado.
- Outros bens.
- Inclusão opcional no cálculo do patrimônio líquido.

## 7. Cartões e faturas

- Cadastro de cartão, instituição, limite, fechamento e vencimento.
- Importação de PDF, CSV ou TXT.
- Identificação de data, descrição, valor e parcela.
- Sugestão de categoria por regras.
- Revisão manual da categoria.
- Na etapa Supabase, arquivo original no Storage e proteção contra duplicidade.

## 8. Configurações

- Renda mensal de cada pessoa.
- Divisão proporcional à renda, 50/50 ou personalizada.
- Categorias personalizadas.
- Estado das integrações GitHub, Vercel e Supabase.
