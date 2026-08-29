'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  conectarWhatsApp,
  desligarWhatsApp,
  recomecarWhatsApp,
  situacaoWhatsApp,
  type SituacaoWhatsApp,
} from '@/app/app/(gestao)/gestao/configuracoes/actions';

/**
 * Conectar o WhatsApp da casa.
 *
 * Isto era um campo de texto onde o dono digitava o nome de uma instância que
 * alguém tinha criado por `curl` no servidor. Errar uma letra produzia o pior
 * defeito possível: a tela de campanhas dizia "WhatsApp ligado", a campanha
 * disparava, e nenhuma mensagem saía.
 *
 * O nome agora é DERIVADO do nome da casa mais o id dela, e ninguém digita.
 *
 * Este painel não faz parte do formulário de salvar, de propósito. Conectar não
 * é uma preferência que se guarda junto com a taxa de serviço — é uma ação, ela
 * acontece na hora, e desfazer é outro botão.
 */

const ESTADOS = {
  conectado: { texto: 'Conectado', classe: 'bg-alert-ok/15 text-alert-ok' },
  conectando: { texto: 'Esperando a leitura', classe: 'bg-alert-warn/15 text-alert-warn' },
  desconectado: { texto: 'Desconectado', classe: 'bg-alert-critical/10 text-alert-critical' },
  inexistente: { texto: 'Não conectado', classe: 'bg-muted text-muted-foreground' },
  indisponivel: { texto: 'Servidor fora do ar', classe: 'bg-alert-critical/10 text-alert-critical' },
  verificando: { texto: 'Verificando…', classe: 'bg-muted text-muted-foreground' },
} as const;

/** O QR da Evolution vira inválido em menos de um minuto. */
const VALIDADE_DO_QR_MS = 45_000;

export function ConexaoWhatsApp({ inicial }: { inicial: SituacaoWhatsApp }) {
  const [situacao, setSituacao] = useState(inicial);
  const [pendente, iniciar] = useTransition();
  const [expirou, setExpirou] = useState(false);

  const mostrandoQr = Boolean(situacao.qr) && situacao.estado !== 'conectado';

  const agir = useCallback((acao: () => Promise<SituacaoWhatsApp>) => {
    setExpirou(false);
    iniciar(async () => setSituacao(await acao()));
  }, []);

  /**
   * A primeira pergunta à Evolution, que a página deliberadamente não fez.
   *
   * Roda uma vez, ao abrir. Se o servidor estiver fora do ar, o crachá vira
   * "Servidor fora do ar" e o resto da tela de Configurações nunca esperou
   * por isso.
   */
  useEffect(() => {
    if (situacao.estado !== 'verificando') return;
    let vivo = true;
    situacaoWhatsApp().then((nova) => {
      if (vivo) setSituacao(nova);
    });
    return () => {
      vivo = false;
    };
  }, [situacao.estado]);

  /**
   * Enquanto o QR está na tela, pergunta à Evolution se já leram.
   *
   * Sem isto o dono lê o código, o WhatsApp dele conecta, e a tela continua
   * mostrando o QR — ele não teria como saber que deu certo a não ser
   * recarregando a página no chute.
   */
  useEffect(() => {
    if (!mostrandoQr) return;

    const relogio = setInterval(async () => {
      const nova = await situacaoWhatsApp();
      if (nova.estado === 'conectado') setSituacao(nova);
    }, 3000);

    // O código morre sozinho. Deixar um QR velho na tela faz a pessoa tentar
    // ler várias vezes e concluir que o sistema está quebrado.
    const morte = setTimeout(() => setExpirou(true), VALIDADE_DO_QR_MS);

    return () => {
      clearInterval(relogio);
      clearTimeout(morte);
    };
  }, [mostrandoQr]);

  const rotulo = ESTADOS[situacao.estado];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${rotulo.classe}`}>
          {rotulo.texto}
        </span>
        {situacao.instancia && (
          <code className="text-[11px] text-muted-foreground">{situacao.instancia}</code>
        )}
      </div>

      {situacao.erro && (
        <p role="alert" className="rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical">
          {situacao.erro}
        </p>
      )}

      {mostrandoQr && (
        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-[13px] text-muted-foreground">
            No celular da casa: <strong className="text-foreground">WhatsApp → Aparelhos
            conectados → Conectar aparelho</strong>, e aponte para o código.
          </p>

          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {/*
              A CSP deste projeto é `img-src 'self' blob: data:`.

              `lib/marketing/instancia` já entrega o QR como
              `data:image/png;base64,…`, mas quem escreve a tag é este arquivo, e
              a conferência mora colada nela: a Evolution muda o formato da
              resposta entre versões — é a razão de `conectar()` ler três campos
              diferentes — e no dia em que vier uma URL `http`, a CSP bloquearia
              a imagem EM SILÊNCIO. A pessoa veria um quadrado vazio e concluiria
              que o sistema está quebrado.

              Sem `data:`, não vira <img> nenhuma: a tela diz o que houve e
              oferece o código de pareamento, que resolve do mesmo jeito.
            */}
            {situacao.qr!.startsWith('data:') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={situacao.qr!}
                alt="Código QR para conectar o WhatsApp"
                width={200}
                height={200}
                className={`rounded-md border border-border ${expirou ? 'opacity-30' : ''}`}
              />
            ) : (
              <p className="rounded-md bg-alert-warn/10 px-3 py-2 text-[12px] text-alert-warn">
                Não deu para desenhar o código. Use o de pareamento, ao lado.
              </p>
            )}

            <div className="space-y-2 text-[13px]">
              {situacao.codigo && (
                <p className="text-muted-foreground">
                  Ou digite este código no celular:{' '}
                  <code className="font-mono text-foreground">{situacao.codigo}</code>
                </p>
              )}
              {expirou && (
                <p className="text-alert-warn">
                  Este código expirou. Gere outro para tentar de novo.
                </p>
              )}
              <Botao
                onClick={() => agir(conectarWhatsApp)}
                pendente={pendente}
                rotulo={expirou ? 'Gerar outro código' : 'Gerar código novo'}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {situacao.estado === 'inexistente' && (
          <Botao onClick={() => agir(conectarWhatsApp)} pendente={pendente} rotulo="Conectar WhatsApp" primario />
        )}

        {(situacao.estado === 'desconectado' || situacao.estado === 'indisponivel') && (
          <Botao onClick={() => agir(conectarWhatsApp)} pendente={pendente} rotulo="Conectar de novo" primario />
        )}

        {/*
          "ESPERANDO A LEITURA" SEM O CÓDIGO NA TELA.

          Acontece o tempo todo: a pessoa gera o QR, não termina de ler, e volta
          depois — ou recarrega a página. A instância fica em `connecting` e o QR
          vive só na memória do navegador, que se foi.

          Sem este botão a única saída visível era "Começar do zero", que apaga a
          conexão inteira para resolver um problema que é só de tela. `conectar`
          é idempotente: pede um código novo para a instância que já existe.
        */}
        {situacao.estado === 'conectando' && !mostrandoQr && (
          <Botao onClick={() => agir(conectarWhatsApp)} pendente={pendente} rotulo="Ver o código" primario />
        )}

        {situacao.instancia && (
          <>
            <Botao
              onClick={() => agir(recomecarWhatsApp)}
              pendente={pendente}
              rotulo="Começar do zero"
            />
            <Botao
              onClick={() =>
                iniciar(async () => {
                  await desligarWhatsApp();
                  setSituacao({ instancia: null, estado: 'inexistente' });
                })
              }
              pendente={pendente}
              rotulo="Desligar"
            />
          </>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {situacao.estado === 'conectado' ? (
          <>
            As campanhas saem por este número.{' '}
            <strong className="text-foreground">Começar do zero</strong> apaga a conexão e obriga a ler o QR de novo. Só serve quando o WhatsApp trava.
          </>
        ) : (
          <>
            Sem conexão não há campanha nem caixa de entrada. Conectado, o
            sistema recebe as conversas e a agenda do aparelho — e{' '}
            <strong className="text-foreground">a agenda não vira lista de
            disparo</strong>: campanha continua só para quem marcou o aceite.
          </>
        )}
      </p>
    </div>
  );
}

function Botao({
  onClick,
  pendente,
  rotulo,
  primario,
}: {
  onClick: () => void;
  pendente: boolean;
  rotulo: string;
  primario?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pendente}
      className={
        primario
          ? 'rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50'
          : 'rounded-md border border-border px-3 py-1.5 text-[13px] disabled:opacity-50'
      }
    >
      {pendente ? 'Aguarde…' : rotulo}
    </button>
  );
}
