# Especificação funcional

## 1. Acesso do casal

- Login individual com e-mail e senha.
- Primeiro acesso com criação do espaço ou entrada por convite.
- No máximo duas pessoas ativas por espaço: Kim e Alexandre.
- Todos os registros podem ser individuais ou do grupo.

## 2. Visão geral

- Entradas, saídas e resultado do grupo no mês.
- Filtro consolidado, Kim, Alexandre ou grupo.
- Renda de cada pessoa calculada pelas entradas importadas.
- Maiores categorias, patrimônio e documentos recentes.
- Despesas fixas somente após três meses consecutivos.

## 3. Entradas e saídas

- Tabela única com pessoa, data, descrição, origem, categoria e valor.
- Origem documental: extrato bancário ou fatura de cartão.
- Busca e filtros por mês e pessoa.
- Vinculação de uma saída ao pagamento de uma dívida.
- Vinculação de uma transferência ao aporte de uma meta.

## 4. Dívidas

- Valor total, vencimento, parcelas e responsável.
- Saldo restante calculado pelos pagamentos importados vinculados.
- Não gera uma saída artificial: a baixa vem do extrato ou da fatura.

## 5. Patrimônio

- Conta corrente, reserva, dinheiro e outros bens.
- Investimentos e previdência.
- Seguros exibidos separadamente como capital segurado.
- Valor, instituição, responsável e data do saldo extraídos do documento.

## 6. Planejamento

- Meta individual ou do grupo.
- Valor total, valor mensal, data alvo e conta de destino.
- Progresso calculado pelos aportes importados e vinculados.

## 7. Importação inteligente

- PDF, CSV ou TXT de até 15 MB.
- Extratos bancários, faturas, investimentos, previdência e seguros.
- Extração de instituição, período, movimentações, categorias e saldos.
- Deduplicação por conteúdo do arquivo e por lançamento do documento.
- Documento original privado, estado de processamento e evidência da extração.
- Falhas ficam registradas sem aplicar dados parciais silenciosamente.

## 8. Regra de recorrência

Uma despesa é agrupada por pessoa e estabelecimento normalizado. Ela permanece
não fixa no primeiro e no segundo mês. Ao existir no terceiro mês consecutivo,
o grupo passa a ser classificado como fixo. Uma interrupção reinicia a contagem.
