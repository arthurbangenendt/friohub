-- ============================================================================
-- CORREÇÃO: "infinite recursion detected in policy for relation quote_requests"
--
-- Erro meu em 20260812240000. As policies ficaram mutuamente dependentes:
--
--   · `qr_target_read`   (em quote_requests)        consulta quote_request_targets
--   · `qrt_cliente_all`  (em quote_request_targets) consulta quote_requests
--
-- Ler uma tabela dispara a policy da outra, que dispara a da primeira. O Postgres
-- detecta o ciclo e aborta — na prática, o fluxo de orçamento inteiro parava.
--
-- A correção é a mesma já usada em `eh_admin()`: mover a checagem para função
-- SECURITY DEFINER. Dentro dela a RLS não é reavaliada, então o ciclo se rompe.
-- A autorização não afrouxa: cada função responde exatamente à pergunta que a
-- policy fazia, e nada além disso.
--
-- Regra para daqui em diante: policy que precisa consultar OUTRA tabela com RLS
-- deve fazê-lo por função definer, não por subquery direta.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Predicados, cada um com uma pergunta só
-- ---------------------------------------------------------------------------
create or replace function public.dono_do_pedido(p_quote_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.quote_requests q
     where q.id = p_quote_request_id and q.cliente_id = auth.uid()
  );
$$;

create or replace function public.destinatario_do_pedido(p_quote_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.quote_request_targets t
     where t.quote_request_id = p_quote_request_id and t.professional_id = auth.uid()
  );
$$;

/* Usada só no INSERT de proposta: convidado, pedido aberto e dentro do prazo. */
create or replace function public.pode_propor(p_quote_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.quote_request_targets t
      join public.quote_requests q on q.id = t.quote_request_id
     where t.quote_request_id = p_quote_request_id
       and t.professional_id = auth.uid()
       and t.recusado_em is null
       and q.status = 'aberto'
       and q.expira_em > now()
  );
$$;

comment on function public.dono_do_pedido is
  'Predicado para policies. SECURITY DEFINER quebra a recursão entre quote_requests e quote_request_targets.';

-- ---------------------------------------------------------------------------
-- 2. Policies reescritas sobre os predicados
-- ---------------------------------------------------------------------------
drop policy if exists "qr_target_read" on public.quote_requests;
create policy "qr_target_read" on public.quote_requests for select
  using (public.destinatario_do_pedido(id) or public.eh_admin());

drop policy if exists "qrt_cliente_all" on public.quote_request_targets;
create policy "qrt_cliente_all" on public.quote_request_targets for all
  using (public.dono_do_pedido(quote_request_id))
  with check (public.dono_do_pedido(quote_request_id));

drop policy if exists "qrp_read" on public.quote_request_photos;
create policy "qrp_read" on public.quote_request_photos for select
  using (
    public.dono_do_pedido(quote_request_id)
    or public.destinatario_do_pedido(quote_request_id)
  );

drop policy if exists "qrp_cliente_write" on public.quote_request_photos;
create policy "qrp_cliente_write" on public.quote_request_photos for all
  using (public.dono_do_pedido(quote_request_id))
  with check (public.dono_do_pedido(quote_request_id));

drop policy if exists "quotes_cliente_read" on public.quotes;
create policy "quotes_cliente_read" on public.quotes for select
  using (public.dono_do_pedido(quote_request_id));

drop policy if exists "quotes_pro_insert" on public.quotes;
create policy "quotes_pro_insert" on public.quotes for insert
  with check (
    professional_id = auth.uid()
    and public.pode_propor(quote_request_id)
  );
