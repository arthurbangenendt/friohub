// Seed de profissionais demo (Fortaleza). Cria contas reais via signUp e preenche
// professionals + skills + áreas, respeitando o RLS (age como o próprio pro).
//
// Rodar:  node --env-file=.env.local scripts/seed-pros.mjs
// Requer: "Confirm email" DESLIGADO em Auth -> Settings (senão não há sessão).

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY. Use --env-file=.env.local");
  process.exit(1);
}

const SENHA = "demo1234";

const PROS = [
  {
    email: "joao.silva@demo.friohub.app", nome: "João Silva", tipo: "autonomo",
    bio: "Instalador com 8 anos de experiência em splits residenciais.",
    skills: [
      { specialty: "instalacao", rating: 4.9, count: 42, jobs: 42, anos: 8 },
      { specialty: "manutencao", rating: 4.7, count: 30, jobs: 30, anos: 8 },
    ],
  },
  {
    email: "contato@climanorte.demo.friohub.app", nome: "Clima Norte Refrigeração", tipo: "empresa",
    bio: "Empresa especializada em manutenção preventiva e contratos corporativos.",
    skills: [
      { specialty: "manutencao", rating: 4.8, count: 120, jobs: 120, anos: 12 },
      { specialty: "instalacao", rating: 4.6, count: 80, jobs: 80, anos: 12 },
      { specialty: "limpeza", rating: 4.9, count: 65, jobs: 65, anos: 12 },
    ],
  },
  {
    email: "maria.andrade@demo.friohub.app", nome: "Maria Andrade", tipo: "autonomo",
    bio: "Higienização e manutenção com foco em qualidade do ar.",
    skills: [
      { specialty: "limpeza", rating: 5.0, count: 60, jobs: 60, anos: 6 },
      { specialty: "manutencao", rating: 4.9, count: 55, jobs: 55, anos: 6 },
    ],
  },
  {
    email: "contato@argelado.demo.friohub.app", nome: "Ar Gelado Serviços", tipo: "empresa",
    bio: "Instalação, remanejamento e conserto com garantia.",
    skills: [
      { specialty: "instalacao", rating: 4.5, count: 50, jobs: 50, anos: 10 },
      { specialty: "remanejamento", rating: 4.7, count: 35, jobs: 35, anos: 10 },
      { specialty: "conserto", rating: 4.6, count: 40, jobs: 40, anos: 10 },
    ],
  },
  {
    email: "pedro.costa@demo.friohub.app", nome: "Pedro Costa", tipo: "autonomo",
    bio: "Reparos e diagnóstico de defeitos em ar-condicionado.",
    skills: [
      { specialty: "conserto", rating: 4.8, count: 38, jobs: 38, anos: 7 },
      { specialty: "manutencao", rating: 4.6, count: 25, jobs: 25, anos: 7 },
    ],
  },
];

async function main() {
  let ok = 0;
  for (const pro of PROS) {
    const anon = createClient(url, key);

    // 1) cria a conta (ou entra, se já existe)
    let session = null;
    const { data: up, error: upErr } = await anon.auth.signUp({
      email: pro.email, password: SENHA,
      options: { data: { nome: pro.nome, role: "profissional" } },
    });
    if (up?.session) session = up.session;
    if (!session) {
      const { data: si } = await anon.auth.signInWithPassword({ email: pro.email, password: SENHA });
      session = si?.session ?? null;
    }
    if (!session) {
      console.error(`✗ ${pro.nome}: sem sessão (desligue "Confirm email" em Auth). ${upErr?.message ?? ""}`);
      continue;
    }

    // 2) cliente autenticado como o próprio profissional (RLS ok)
    const sb = createClient(url, key);
    await sb.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    const uid = session.user.id;

    // 3) professionals
    await sb.from("professionals").upsert({
      id: uid, tipo: pro.tipo, cidade: "São Paulo", estado: "SP",
      bio: pro.bio, verification_status: "verificado", verified_at: new Date().toISOString(),
      razao_social: pro.tipo === "empresa" ? pro.nome : null,
    });

    // 4) skills (com reputação já preenchida para a vitrine)
    for (const s of pro.skills) {
      await sb.from("professional_skills").upsert({
        professional_id: uid, specialty: s.specialty,
        rating_avg: s.rating, rating_count: s.count, jobs_completed: s.jobs, years_experience: s.anos,
      }, { onConflict: "professional_id,specialty" });
    }

    // 5) áreas de atendimento do demo (faixas válidas da capital)
    await sb.from("service_areas").delete().eq("professional_id", uid);
    await sb.from("service_areas").insert(["01", "02", "03", "04", "05"].map((cep_prefix) => ({
      professional_id: uid, cep_prefix, cidade: "São Paulo",
    })));

    console.log(`✓ ${pro.nome} (${pro.skills.map((s) => s.specialty).join(", ")})`);
    ok++;
  }
  console.log(`\nConcluído: ${ok}/${PROS.length} profissionais.`);
  console.log(`Login demo: qualquer email acima / senha "${SENHA}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
