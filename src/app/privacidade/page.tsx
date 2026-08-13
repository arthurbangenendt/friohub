import { LegalShell, Secao } from "./LegalShell";
import { TERMOS_VERSAO } from "../(auth)/termos-versao";

export const metadata = { title: "Política de Privacidade — FrioHub" };

export default function PrivacidadePage() {
  return (
    <LegalShell titulo="Política de Privacidade" versao={TERMOS_VERSAO}>
      <Secao t="1. Quais dados coletamos">
        Nome, e-mail, telefone e CPF ou CNPJ no cadastro. Endereço e CEP quando você
        solicita um serviço. Dados do ambiente (área, número de pessoas, insolação)
        e fotos opcionais do local para calcular e orçar o serviço. Para parceiros, também dados
        profissionais: especialidades, equipamentos que domina, região de atendimento
        e fotos de portfólio que você mesmo envia. Também guardamos as{" "}
        <strong>mensagens trocadas no chat</strong> da plataforma.
      </Secao>
      <Secao t="2. Para que usamos">
        Para conectar você ao profissional ou ao cliente certo, executar a solicitação
        de serviço, calcular a capacidade recomendada do equipamento, processar
        pagamentos e exibir reputação pública dos parceiros.
      </Secao>
      <Secao t="3. O que é público e o que não é">
        São públicos: nome do profissional, foto de portfólio, especialidades,
        avaliações e nota. <strong>Não são públicos</strong>: CPF ou CNPJ, telefone,
        endereço, fotos de pedidos e mensagens — esses ficam em armazenamento restrito,
        acessível apenas aos participantes do pedido quando necessário e à administração
        da plataforma. O perfil de cliente não é exibido
        publicamente.
      </Secao>
      <Secao t="4. Com quem compartilhamos">
        Com o profissional escolhido, os dados necessários para executar o serviço
        (nome, endereço e descrição do problema). Com distribuidoras parceiras, os
        dados necessários para entrega do equipamento. Com processadores de pagamento,
        os dados necessários para a transação. Não vendemos dados pessoais.
      </Secao>
      <Secao t="4.1. Chat e troca de telefone">
        A conversa entre cliente e profissional acontece dentro da plataforma. O seu
        <strong> telefone não é entregue à outra parte automaticamente</strong>: ele só
        é revelado depois que a conversa se torna frequente — ou que um serviço é
        fechado — e <strong>apenas se as duas pessoas autorizarem</strong>. Você pode
        conversar sem nunca compartilhar o número.
        <br />
        <br />
        As mensagens ficam registradas e podem ser lidas pela administração da
        plataforma em caso de suporte ou disputa sobre um serviço. Elas não são
        públicas, não aparecem em nenhum perfil e não são usadas para publicidade.
      </Secao>
      <Secao t="5. Por quanto tempo guardamos">
        Enquanto sua conta existir e pelo prazo exigido pela legislação fiscal e civil
        aplicável aos serviços contratados.
      </Secao>
      <Secao t="6. Seus direitos (LGPD)">
        Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados
        pessoais, além de revogar consentimentos. Pedidos podem ser feitos pelos canais
        de atendimento informados no site.
      </Secao>
      <Secao t="7. Segurança">
        Os dados sensíveis ficam em tabelas com controle de acesso por linha, separadas
        dos dados de exibição pública. O acesso administrativo é restrito e registrado.
      </Secao>
      <Secao t="8. Cookies">
        Usamos cookies estritamente necessários para manter sua sessão autenticada. Analytics de
        produto é opcional e só é ativado após sua autorização. Quando autorizado, registramos
        páginas normalizadas e ações de uso, sem conteúdo de mensagens, endereço, telefone, fotos
        ou valores financeiros. A preferência pode ser revogada limpando os dados do site ou pelas
        preferências de analytics disponibilizadas na plataforma.
      </Secao>
      <Secao t="9. Alterações">
        Esta política pode ser atualizada. A versão vigente e a data do seu aceite ficam
        registradas na sua conta.
      </Secao>
    </LegalShell>
  );
}
