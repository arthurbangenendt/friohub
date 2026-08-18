-- ============================================================================
-- Reconciliação manual pontual: R$100 do Jonathas (sandbox, plano Profissional)
-- ============================================================================
--
-- Durante o teste ponta a ponta do Asaas (18/08/2026), o profissional
-- bb1e7e03-467b-46c2-92cd-6885ca7d35cc pagou a fatura do plano Profissional
-- (R$100) depois de já ter trocado várias vezes de plano no /planos — a
-- assinatura correspondente (0e66cea5-a2dd-48da-93eb-070d0f4b924e) já estava
-- cancelada quando o dinheiro chegou (20260818150000). O ledger registrou o
-- recebimento corretamente, mas ninguém foi promovido automaticamente —
-- decisão explícita do time: religar esse recebimento ao plano Profissional.

-- Guard de existência: esta assinatura só existe no banco onde o teste
-- realmente rodou (produção). Sem isso, `supabase db reset` local e o CI
-- quebrariam para sempre tentando reconciliar um id que nunca existiu ali.
do $$
begin
  if exists (
    select 1 from public.plan_subscriptions
     where id = '0e66cea5-a2dd-48da-93eb-070d0f4b924e' and status = 'cancelled'
  ) then
    perform public.reconciliar_assinatura_manual('0e66cea5-a2dd-48da-93eb-070d0f4b924e');
  end if;
end $$;
