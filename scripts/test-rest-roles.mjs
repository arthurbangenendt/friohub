import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function localConfig() {
  const raw = execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const status = JSON.parse(raw);
  return {
    url: status.API_URL,
    anonKey: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
    serviceKey: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
  };
}

function client(url, key) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dbQuery(sql) {
  return execFileSync("supabase", ["db", "query", "--local", sql], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
}

async function authenticatedClient(url, anonKey, email, password) {
  const supabase = client(url, anonKey);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `login REST falhou para ${email}: ${error?.message}`);
  return supabase;
}

function ok(label) {
  process.stdout.write(`ok - ${label}\n`);
}

const { url, anonKey, serviceKey } = localConfig();
assert.ok(url && anonKey && serviceKey, "Supabase local não retornou URL e chaves");

const service = client(url, serviceKey);
const anon = client(url, anonKey);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = `Rest-${crypto.randomUUID()}-9a!`;
const createdUserIds = [];
let productId = null;

async function createUser(role, nome) {
  const email = `rest-${createdUserIds.length + 1}-${role}-${suffix}@friohub.local`;
  let { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      nome,
      role: role === "admin" ? "cliente" : role,
      telefone: `119${String(createdUserIds.length + 1).padStart(8, "0")}`,
      cpf_cnpj: `rest-${role}-${suffix}`,
      termos_versao: "rest-test",
    },
  });
  // O Auth local pode concluir o POST e repetir a chamada depois de um timeout.
  // Nesse caso a segunda resposta é email_exists, embora a conta já seja nossa.
  if (error?.code === "email_exists") {
    const { data: usersPage, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    assert.equal(listError, null, `não foi possível recuperar seed idempotente: ${listError?.message}`);
    const existing = usersPage.users.find((user) => user.email === email);
    if (existing) {
      data = { user: existing };
      error = null;
    }
  }
  assert.equal(error, null, `seed de ${role} falhou: ${error?.message}`);
  assert.ok(data.user?.id, `seed de ${role} não retornou UUID`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

try {
  const cliente = await createUser("cliente", "Cliente REST");
  const outroCliente = await createUser("cliente", "Outro Cliente REST");
  const profissional = await createUser("profissional", "Profissional REST");
  const outroProfissional = await createUser("profissional", "Outro Profissional REST");
  const distribuidora = await createUser("distribuidora", "Distribuidora REST");
  const admin = await createUser("admin", "Admin REST");

  productId = crypto.randomUUID();
  // Fixtures são criadas como postgres pela CLI local. A service_role não
  // recebe grants genéricos de tabela neste projeto; ela só acessa RPCs
  // explicitamente concedidas, que é uma superfície menor e intencional.
  dbQuery(`update public.profiles set role = 'admin' where id = ${sqlLiteral(admin.id)}::uuid`);
  dbQuery(`insert into public.professionals (id,tipo,bio,cidade,estado) values
      (${sqlLiteral(profissional.id)}::uuid,'autonomo','Original','São Paulo','SP'),
      (${sqlLiteral(outroProfissional.id)}::uuid,'autonomo','Não alterar','São Paulo','SP')`);
  dbQuery(`insert into public.distributors
      (id,razao_social,cnpj,cidade,estado,verification_status,verified_at,ativo)
    values
      (${sqlLiteral(distribuidora.id)}::uuid,'Distribuidora REST',${sqlLiteral(`cnpj-${suffix}`)},'São Paulo','SP','verificado',now(),true)`);
  dbQuery(`insert into public.products
      (id,marca,modelo,btu,categoria,custo,preco_venda,distributor_id,estoque_disponivel,ativo)
    values
      (${sqlLiteral(productId)}::uuid,'Marca REST',${sqlLiteral(`Modelo ${suffix}`)},12000,'inverter',600,750,${sqlLiteral(distribuidora.id)}::uuid,true,true)`);

  const clienteApi = await authenticatedClient(url, anonKey, cliente.email, password);
  const profissionalApi = await authenticatedClient(url, anonKey, profissional.email, password);
  const distribuidoraApi = await authenticatedClient(url, anonKey, distribuidora.email, password);
  const adminApi = await authenticatedClient(url, anonKey, admin.email, password);

  const { data: publicProfessional, error: publicProfessionalError } = await anon
    .from("profiles").select("id,nome,role").eq("id", profissional.id);
  assert.equal(publicProfessionalError, null);
  assert.equal(publicProfessional.length, 1);
  ok("anônimo lê somente o perfil profissional público esperado");

  const { data: hiddenClient, error: hiddenClientError } = await anon
    .from("profiles").select("id").eq("id", cliente.id);
  assert.equal(hiddenClientError, null);
  assert.equal(hiddenClient.length, 0);
  ok("anônimo não lê perfil de cliente");

  const { data: publicProduct, error: publicProductError } = await anon
    .from("products").select("id,preco_venda").eq("id", productId);
  assert.equal(publicProductError, null);
  assert.equal(publicProduct.length, 1);
  const { error: costLeak } = await anon.from("products").select("id,custo").eq("id", productId);
  assert.ok(costLeak, "anônimo conseguiu selecionar custo do produto");
  ok("catálogo anônimo expõe preço final, mas não custo");

  const { data: ownPrivate, error: ownPrivateError } = await clienteApi
    .from("profile_private").select("id,telefone,cpf_cnpj");
  assert.equal(ownPrivateError, null);
  assert.deepEqual(ownPrivate.map(({ id }) => id), [cliente.id]);
  ok("cliente lê apenas os próprios dados pessoais");

  const { data: nonexistentPrivate, error: nonexistentPrivateError } = await clienteApi
    .from("profile_private").select("id").eq("id", crypto.randomUUID());
  assert.equal(nonexistentPrivateError, null);
  assert.equal(nonexistentPrivate.length, 0);
  ok("UUID sem vínculo não contorna RLS");

  const { data: attemptedPromotion, error: attemptedPromotionError } = await clienteApi
    .from("profiles").update({ role: "admin" }).eq("id", cliente.id).select("role").single();
  assert.equal(attemptedPromotionError, null);
  assert.equal(attemptedPromotion.role, "cliente");
  ok("cliente não consegue se promover a admin pela REST API");

  const { error: entityEscalation } = await clienteApi.from("professionals").insert({
    id: cliente.id,
    tipo: "autonomo",
    cidade: "São Paulo",
    estado: "SP",
  });
  assert.ok(entityEscalation, "cliente conseguiu criar entidade profissional");
  ok("cliente não cria entidade de outro papel");

  const { data: foreignUpdate, error: foreignUpdateError } = await profissionalApi
    .from("professionals").update({ bio: "Alterado indevidamente" })
    .eq("id", outroProfissional.id).select("id");
  assert.equal(foreignUpdateError, null);
  assert.equal(foreignUpdate.length, 0);
  const { data: preservedProfessional, error: preservedProfessionalError } = await profissionalApi
    .from("professionals").select("bio").eq("id", outroProfissional.id).single();
  assert.equal(preservedProfessionalError, null);
  assert.equal(preservedProfessional.bio, "Não alterar");
  ok("profissional não altera cadastro de outro profissional");

  const { data: ownCnpj, error: ownCnpjError } = await distribuidoraApi
    .rpc("obter_cnpj_distribuidora", { p_distributor_id: distribuidora.id });
  assert.equal(ownCnpjError, null);
  assert.equal(ownCnpj, `cnpj-${suffix}`);
  const { error: clientCnpjError } = await clienteApi
    .rpc("obter_cnpj_distribuidora", { p_distributor_id: distribuidora.id });
  assert.ok(clientCnpjError, "cliente conseguiu ler CNPJ da distribuidora");
  ok("CNPJ é acessível à própria distribuidora e negado ao cliente");

  const { data: protectedProduct, error: priceAttemptError } = await distribuidoraApi.from("products").update({
    custo: 800,
    preco_venda: 1,
    preco_manual: true,
  }).eq("id", productId).select("preco_venda").single();
  assert.equal(priceAttemptError, null, `atualização legítima de custo falhou: ${priceAttemptError?.message}`);
  assert.equal(Number(protectedProduct.preco_venda), 1000);
  ok("distribuidora atualiza custo sem controlar preço final ou override");

  const { error: nonAdminModeration } = await clienteApi.rpc("definir_verificacao", {
    p_entity_type: "professional",
    p_entity_id: profissional.id,
    p_status: "verificado",
    p_reason: "tentativa indevida REST",
  });
  assert.ok(nonAdminModeration, "cliente conseguiu moderar verificação");

  const { error: adminModeration } = await adminApi.rpc("definir_verificacao", {
    p_entity_type: "professional",
    p_entity_id: profissional.id,
    p_status: "verificado",
    p_reason: "validação da suíte REST",
  });
  assert.equal(adminModeration, null, `admin não conseguiu moderar: ${adminModeration?.message}`);
  const { data: audit, error: auditError } = await adminApi
    .from("admin_audit_log").select("actor_id,action,entity_id").eq("entity_id", profissional.id);
  assert.equal(auditError, null);
  assert.equal(audit.some((row) => row.actor_id === admin.id && row.action === "verification_changed"), true);
  ok("somente admin modera e a ação fica auditada");

  const { data: privateForAdmin, error: privateForAdminError } = await adminApi
    .from("profile_private").select("id").in("id", [cliente.id, outroCliente.id]);
  assert.equal(privateForAdminError, null);
  assert.equal(privateForAdmin.length, 2);
  const { data: auditForAnon, error: auditForAnonError } = await anon
    .from("admin_audit_log").select("id").limit(1);
  assert.ok(auditForAnonError || auditForAnon.length === 0);
  ok("admin possui leitura de suporte; anônimo não lê auditoria");

  process.stdout.write("REST por papel: 12/12 contratos passaram.\n");
} finally {
  if (createdUserIds.length) {
    const ids = createdUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(",");
    dbQuery(`delete from public.admin_audit_log where entity_id in (${ids});`);
    for (const id of [...createdUserIds].reverse()) {
      await service.auth.admin.deleteUser(id);
    }
  }
}
