-- ---------------------------------------------------------------------------
-- O beneficiário passa a enxergar o próprio repasse
--
-- Contexto: `payment_allocations` guarda o rateio econômico congelado no momento
-- em que a cobrança é preparada — quanto vai para o profissional, quanto para a
-- distribuidora, quanto é comissão e quanto é margem de equipamento. Até aqui a
-- única política de leitura era `payment_allocations_admin_read`, então o
-- profissional não tinha como ver quanto tem a receber por um serviço já pago:
-- a informação existia no banco e não chegava a ele.
--
-- Por que não derivar de `orders`: dá para calcular `preco_servico -
-- comissao_servico` a partir de uma tabela que o profissional já lê, e o número
-- normalmente bate. Mas `payment_allocations` é um SNAPSHOT — o comentário da
-- migration original diz isso com todas as letras: "Alterações futuras de
-- comissão, produto ou custo não reescrevem o passado". Se a plataforma mudar o
-- percentual de comissão, o cálculo em cima de `orders` passa a mostrar um valor
-- diferente do que foi efetivamente rateado. Mostrar ao profissional o valor
-- real do rateio é o ponto.
--
-- Escopo da política: apenas linhas em que ele é o beneficiário. As linhas de
-- receita da plataforma (`platform_commission`, `platform_product_margin`) têm
-- `beneficiary_id` nulo e continuam invisíveis, porque `null = auth.uid()` é
-- nulo, e não verdadeiro. A distribuidora enxerga as dela pelo mesmo caminho.
--
-- Escrita continua proibida: `revoke insert, update, delete` da migration
-- original segue valendo, e o rateio só nasce dentro de
-- `preparar_cobranca_order`, que é exclusiva de `service_role`.
--
-- Reversibilidade: `drop policy "payment_allocations_beneficiario_read" on
-- public.payment_allocations;`. Nenhuma tabela é alterada.
-- ---------------------------------------------------------------------------

create policy "payment_allocations_beneficiario_read"
  on public.payment_allocations for select to authenticated
  using (beneficiary_id = (select auth.uid()));

comment on policy "payment_allocations_beneficiario_read" on public.payment_allocations is
  'Beneficiário lê o próprio rateio. Linhas de receita da plataforma têm beneficiary_id nulo e permanecem restritas ao admin.';
