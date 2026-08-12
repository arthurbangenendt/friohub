# FrioHub

Marketplace de HVAC residencial: o cliente descreve o que precisa, escolhe o profissional
pelo perfil/skill/avaliação, e o equipamento vem da distribuidora em dropship.
A experiência é de serviço; a monetização é de loja.

**Stack:** Next.js 16 (App Router) · Tailwind · Supabase (Postgres + Auth) · Vercel

---

## Modelo de receita (4 fontes)

1. **Margem do equipamento** (dropship) — motor, ativo desde o dia 1
2. **Comissão do serviço** — por job fechado, ativo desde o dia 1
3. **Assinatura do profissional** — construída, cobrança ligada depois
4. **Destaque patrocinado** — construído, cobrança ligada depois

As 4 soluções de risco estão embutidas no schema (`supabase/migrations/0001_init.sql`),
marcadas com `[RISCO N]`:

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

---

## Conectar o Supabase (passo a passo)

1. Crie um projeto em **https://supabase.com/dashboard** (região São Paulo).
2. Em **Project Settings → API**, copie:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Cole ambos no `.env.local`.
3. Rode o schema: **SQL Editor → New query** → cole o conteúdo de
   `supabase/migrations/0001_init.sql` → **Run**.
4. **Authentication → Providers**: mantenha **Email** ativo (login por email + senha).
   Para testar rápido, desative "Confirm email" em Auth → Settings.

---

## Deploy na Vercel

1. Suba o repositório no GitHub.
2. Em **https://vercel.com/new**, importe o repo.
3. Em **Environment Variables**, adicione `NEXT_PUBLIC_SUPABASE_URL` e
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (os mesmos do `.env.local`).
4. Deploy.

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
    0001_init.sql       # schema completo do MVP
```
