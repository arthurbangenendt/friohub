-- ============================================================================
-- O rate limit de mensagens precisa sobreviver à mudança de caminho de escrita
--
-- `enforce_marketplace_rate_limits()` (20260813184012) é trigger BEFORE INSERT
-- em `messages` e começa assim:
--
--     v_uid uuid := (select auth.uid());
--     if v_uid is null then return new; end if;   -- escrita interna/service role
--
-- Isso estava certo enquanto a única escrita interna era de worker. Com o
-- Chatwoot, TODA mensagem passa a entrar por `espelhar_mensagem_chatwoot`, que
-- roda como service_role e portanto sem `auth.uid()` — o teto de 30 por minuto
-- e 500 por dia deixaria de existir sem que nada acusasse.
--
-- A defesa muda de lugar junto com a escrita: sai do trigger e vai para a
-- borda, na Edge Function que recebe a mensagem do usuário. Esta função é o que
-- ela chama, com o id de quem está autenticado no app.
--
-- Não damos execute em `consume_rate_limit` direto para service_role: assim o
-- worker consegue consumir ESTE limite e nenhum outro (pedido de orçamento,
-- PMOC), que não são dele.
-- ============================================================================

create or replace function public.consumir_limite_mensagem(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'Limite de mensagem exige um usuário.';
  end if;

  -- Mesmos tetos do trigger, para o comportamento não mudar com o caminho.
  perform public.consume_rate_limit('message_minute', p_user_id, 30, 60);
  perform public.consume_rate_limit('message_day', p_user_id, 500, 86400);
end;
$$;

revoke all on function public.consumir_limite_mensagem(uuid) from public, anon, authenticated;
grant execute on function public.consumir_limite_mensagem(uuid) to service_role;

comment on function public.consumir_limite_mensagem is
  'Teto de mensagens aplicado na borda (Edge Function), já que a escrita passou a ser de service_role e o trigger só age quando há auth.uid().';
