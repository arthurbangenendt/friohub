# FrioHub

Marketplace de climatização em São Paulo: clientes enviam pedidos de orçamento para profissionais,
comparam propostas e podem comprar equipamentos de distribuidoras em dropship.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres, Auth, Storage e Realtime) · Vercel

> O sistema está em hardening. Comissão e margem são calculadas, mas ainda não existe gateway de
> pagamento. Não usar para movimentar dinheiro real antes de concluir os bloqueadores P0 descritos
> em [`docs/ROADMAP_10_DE_10.md`](docs/ROADMAP_10_DE_10.md).

---

## Modelo de receita planejado

1. **Margem do equipamento** — calculada no banco; cobrança pendente.
2. **Comissão do serviço** — calculada no banco; cobrança pendente.
3. **Assinatura do profissional** — schema inicial existente; produto e cobrança pendentes.
4. **Destaque patrocinado** — elegibilidade modelada; compra e cobrança pendentes.

As primeiras decisões de risco estão registradas nas migrations versionadas em
`supabase/migrations/`:

- **[RISCO 1] Cold start** → `city_billing_config.cobranca_ativa` (piloto entra grátis)
- **[RISCO 2] Confiança x destaque** → `featured_placements` + `is_featured_eligible()`
- **[RISCO 3] Jobs só-serviço** → `jobs.job_type` / `has_equipment`
- **[RISCO 4] Qualidade da rede** → `professionals.verification_status`

---

## Rodar localmente

```bash
npm install
cp .env.local.example .env.local   # preencha com as chaves do Supabase (abaixo)
npm run dev                        # http://localhost:3000
```

O projeto usa `next/font`; o primeiro build precisa de acesso à internet para obter as fontes.

---

## Conectar o Supabase (passo a passo)

1. Crie um projeto em **https://supabase.com/dashboard** (região São Paulo).
2. Em **Project Settings → API**, copie:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Cole ambos no `.env.local`.
3. Instale um runtime compatível com Docker e a Supabase CLI.
4. Rode `supabase start` e `npm run db:reset`. Todas as migrations serão aplicadas em ordem.
5. Use confirmação de e-mail em produção. O ambiente local pode desativá-la para testes.

Nunca copie dados reais para o seed local e nunca execute `db reset --linked`.

---

## Qualidade

```bash
npm run lint             # ESLint
npm run typecheck        # TypeScript
npm run build            # build de produção
npm run db:reset         # recria apenas o banco local
npm run db:lint          # lint do schema local
npm run db:test          # pgTAP: contratos e regressões de RLS
npm run db:types         # atualiza tipos a partir do banco local
npm run db:types:check   # falha se o schema e os tipos divergirem
```

O workflow `.github/workflows/quality.yml` executa aplicação e banco em jobs separados. Os testes
P0 conhecidos estão marcados como `TODO` até a migration de hardening; cada correção deve remover o
respectivo `TODO` e transformar o contrato em obrigatório.

---

## Deploy na Vercel

Deploy de aplicação pode ser feito pela Vercel, mas migrations não devem ser aplicadas manualmente
pelo SQL Editor. Mudanças de banco devem nascer em migration, passar pelo CI e ser promovidas de
staging para produção por um único pipeline autorizado.

---

## Estrutura

```
src/
  app/                  # rotas (App Router)
  lib/supabase/
    client.ts           # cliente para o navegador
    server.ts           # cliente para Server Components / Actions
    proxy.ts            # refresh de sessão (usado por src/proxy.ts)
  proxy.ts              # convenção Next 16 (ex-"middleware")
supabase/
  migrations/
    *.sql                # histórico completo, aplicado em ordem
  tests/database/        # contratos pgTAP de schema e segurança
src/types/
  database.generated.ts # tipos gerados do schema Supabase
docs/
  ROADMAP_10_DE_10.md
  SECURITY_PERMISSION_MATRIX.md
```
