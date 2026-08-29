'use client';

import { useState, useTransition } from 'react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { criarConta, entrarNaConta } from '@/app/m/[short_code]/conta/actions';

/**
 * Identificação do cliente — pedida no PRIMEIRO envio, nunca antes (spec §4).
 *
 * Nome é obrigatório porque a cozinha e o garçom precisam saber de quem é o
 * prato. Telefone é opcional por padrão: é dado pessoal, e a §10.9 manda
 * minimizar. Vira obrigatório só quando o restaurante liga `require_phone`.
 *
 * O consentimento LGPD é registrado com timestamp no banco, e só existe se a
 * pessoa marcar. Sem marcar, o telefone é descartado no servidor — não fica
 * "guardado por precaução", que é exatamente o que gera multa.
 *
 * DOIS MODOS, quando a casa dá cashback
 *
 * O cadastro precisa ser oferecido AQUI, no instante em que a pessoa se
 * identifica para pedir. Foi o erro da primeira versão: a conta existia numa
 * página à parte, atrás de um botão discreto no cabeçalho, e quem senta, se
 * identifica e pede nunca esbarrava nela. Uma oferta que só aparece para quem
 * já foi procurá-la não é uma oferta.
 *
 * Visitante continua sendo o padrão e a primeira aba: quem só quer comer não
 * deveria ter de decidir nada.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantName: string;
  requirePhone: boolean;
  enviando: boolean;
  erro: string | null;
  /** 0 esconde o cadastro por completo: não há o que oferecer. */
  cashbackPct: number;
  shortCode: string;
  onConfirm: (dados: { nome: string; telefone?: string; consentimento: boolean }) => void;
}

export function IdentifySheet({
  open,
  onOpenChange,
  restaurantName,
  requirePhone,
  enviando,
  erro,
  cashbackPct,
  shortCode,
  onConfirm,
}: Props) {
  const [modo, setModo] = useState<'visitante' | 'conta'>('visitante');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [consentimento, setConsentimento] = useState(false);

  const telefoneLimpo = telefone.replace(/\D/g, '');
  const telefoneValido = telefoneLimpo.length === 0 || telefoneLimpo.length >= 10;
  const podeEnviar =
    nome.trim().length > 0 &&
    telefoneValido &&
    (!requirePhone || telefoneLimpo.length >= 10) &&
    // telefone só sai daqui com consentimento marcado
    (telefoneLimpo.length === 0 || consentimento);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        <form
          className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!podeEnviar || enviando) return;
            onConfirm({
              nome: nome.trim(),
              telefone: telefoneLimpo || undefined,
              consentimento,
            });
          }}
        >
          <SheetTitle className="font-display text-2xl leading-tight">
            Como te chamamos?
          </SheetTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            O garçom precisa saber de quem é o pedido.
          </p>

          {/* A ESCOLHA, e só quando há o que escolher. Com cashback em zero as
              abas somem inteiras e a tela volta a ser o que sempre foi. */}
          {cashbackPct > 0 && (
            <div className="mt-4 flex gap-2" role="tablist">
              {(['visitante', 'conta'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={modo === m}
                  onClick={() => setModo(m)}
                  className={`h-10 flex-1 rounded-lg px-2 text-[13px] font-semibold ${
                    modo === m ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                  }`}
                >
                  {m === 'visitante' ? 'Só pedir' : `Entrar e ganhar ${formatPct(cashbackPct)}`}
                </button>
              ))}
            </div>
          )}

          {modo === 'visitante' && (
          <>
          <label htmlFor="nome" className="mt-5 block text-sm font-medium">
            Seu nome
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            autoComplete="given-name"
            autoFocus
            enterKeyHint="done"
            placeholder="Como preferir ser chamado"
            className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />

          <label htmlFor="tel" className="mt-4 block text-sm font-medium">
            Telefone{' '}
            <span className="font-normal text-muted-foreground">
              {requirePhone ? '(obrigatório aqui)' : '(opcional)'}
            </span>
          </label>
          <input
            id="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            type="tel"
            inputMode="tel"
            maxLength={24}
            autoComplete="tel"
            placeholder="(11) 90000-0000"
            className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />

          {telefoneLimpo.length > 0 && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={consentimento}
                onChange={(e) => setConsentimento(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="text-[13px] leading-snug text-muted-foreground">
                Autorizo {restaurantName} a guardar meu telefone para contato
                sobre este pedido.{' '}
                <a
                  href="/privacidade"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  Como usamos seus dados
                </a>
              </span>
            </label>
          )}

          {erro && (
            <p role="alert" className="mt-4 text-[13px] text-destructive">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={!podeEnviar || enviando}
            className="mt-5 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {enviando ? 'Enviando…' : 'Enviar pedido'}
          </button>

          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            Sem cadastro, sem senha. Só o nome.
          </p>
          </>
          )}

          {modo === 'conta' && (
            <ComConta
              shortCode={shortCode}
              restaurantName={restaurantName}
              cashbackPct={cashbackPct}
              requirePhone={requirePhone}
              enviando={enviando}
              erroDoPedido={erro}
              onPronto={onConfirm}
            />
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * O caminho da conta, dentro da folha de identificação.
 *
 * Entra ou cria, e só então dispara o pedido. O nome que vai para a cozinha é o
 * da conta — perguntar de novo seria pedir duas vezes a mesma coisa.
 *
 * O vínculo entre a conta e a mesa NÃO acontece aqui: acontece no servidor,
 * quando a comanda nasce (`/api/mesa/[short_code]/entrar`). Neste instante ainda
 * não há mesa aberta, e tentar ligar agora cairia no vazio em silêncio.
 */
function ComConta({
  shortCode,
  restaurantName,
  cashbackPct,
  requirePhone,
  enviando,
  erroDoPedido,
  onPronto,
}: {
  shortCode: string;
  restaurantName: string;
  cashbackPct: number;
  requirePhone: boolean;
  enviando: boolean;
  erroDoPedido: string | null;
  onPronto: (dados: { nome: string; telefone?: string; consentimento: boolean }) => void;
}) {
  const [aba, setAba] = useState<'entrar' | 'criar'>('entrar');
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  // Começa DESMARCADO, e não é isso que trava o botão. Caixa pré-marcada não é
  // consentimento — é o padrão que a LGPD chama de não-manifestação, e o único
  // efeito prático seria uma lista grande de gente que não escolheu nada.
  const [marketing, setMarketing] = useState(false);

  const telefoneLimpo = telefone.replace(/\D/g, '');
  const telefoneValido = telefoneLimpo.length === 0 || telefoneLimpo.length >= 10;

  const ocupado = pendente || enviando;
  const podeEnviar =
    cpf.replace(/\D/g, '').length === 11 &&
    senha.length >= 8 &&
    (aba === 'entrar' || nome.trim().length >= 2) &&
    telefoneValido &&
    (!requirePhone || telefoneLimpo.length >= 10) &&
    // Telefone só sai daqui com consentimento marcado — a mesma regra da aba do
    // visitante. Ter conta não é base legal para guardar telefone; consentir é.
    (telefoneLimpo.length === 0 || consentimento);

  function enviar() {
    setErro(null);
    const fd = new FormData();
    fd.set('cpf', cpf);
    fd.set('senha', senha);
    if (aba === 'criar') {
      fd.set('nome', nome.trim());
      fd.set('telefone', telefoneLimpo);
      fd.set('email', email.trim());
      fd.set('marketing', marketing && telefoneLimpo.length > 0 ? 'sim' : '');
    }

    iniciar(async () => {
      const r = aba === 'criar'
        ? await criarConta(shortCode, fd)
        : await entrarNaConta(shortCode, fd);

      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      // Entrou. O pedido segue, e o servidor liga a conta à mesa que acabou de
      // nascer. O telefone vai junto para a COMANDA — é outro registro que não
      // o da conta, e é o que o garçom usa se precisar ligar.
      onPronto({
        nome: aba === 'criar' ? nome.trim() : (r.nome ?? 'Cliente'),
        telefone: telefoneLimpo || undefined,
        consentimento,
      });
    });
  }

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        {(['entrar', 'criar'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => { setAba(a); setErro(null); }}
            className={`h-9 flex-1 rounded-lg text-[13px] font-semibold ${
              aba === a ? 'bg-secondary text-foreground' : 'text-muted-foreground'
            }`}
          >
            {a === 'entrar' ? 'Já tenho conta' : 'Criar agora'}
          </button>
        ))}
      </div>

      <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
        {formatPct(cashbackPct)} do que você consumir vira saldo em{' '}
        {restaurantName}. Libera em 24 h e vale nas próximas visitas.
      </p>

      {aba === 'criar' && (
        <>
          <label htmlFor="conta-nome" className="mt-4 block text-sm font-medium">
            Seu nome
          </label>
          <input
            id="conta-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            autoComplete="name"
            className={CAMPO}
          />
        </>
      )}

      <label htmlFor="conta-cpf" className="mt-4 block text-sm font-medium">
        CPF
      </label>
      <input
        id="conta-cpf"
        value={cpf}
        onChange={(e) => setCpf(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
        maxLength={14}
        placeholder="000.000.000-00"
        className={CAMPO}
      />

      {/*
        TELEFONE, e ele estava faltando aqui.
        
        A primeira versão desta aba pedia só CPF, nome e senha — e com isso
        furava duas coisas: o `require_phone` da casa era ignorado por quem
        entrasse por aqui, e a comanda nascia sem telefone nenhum, que é o que o
        garçom usa quando precisa ligar.
        
        O consentimento é o MESMO da aba do visitante, e não uma regra mais
        frouxa: ter conta não é base legal para guardar telefone de ninguém.
      */}
      <label htmlFor="conta-tel" className="mt-4 block text-sm font-medium">
        Telefone{' '}
        <span className="font-normal text-muted-foreground">
          {requirePhone ? '(obrigatório aqui)' : '(opcional)'}
        </span>
      </label>
      <input
        id="conta-tel"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        type="tel"
        inputMode="tel"
        maxLength={24}
        autoComplete="tel"
        placeholder="(11) 90000-0000"
        className={CAMPO}
      />

      {telefoneLimpo.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-[13px] leading-snug text-muted-foreground">
            Autorizo {restaurantName} a guardar meu telefone para contato sobre
            este pedido.{' '}
            <a
              href="/privacidade"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Como usamos seus dados
            </a>
          </span>
        </label>
      )}

      {/*
        A SEGUNDA caixa, e o motivo de ela não estar junto com a primeira.

        A de cima autoriza guardar o número para ESTE pedido. Esta autoriza
        mandar mensagem depois. São finalidades diferentes, e a LGPD trata
        finalidade como o eixo de tudo: consentimento dado para uma não vale
        para a outra.

        Juntar as duas numa caixa só daria uma lista maior hoje e uma base
        indefensável para sempre — porque a frase aceita falaria de "contato
        sobre este pedido", e seria ela que apareceria como prova.

        Fica só na aba de criar conta: é lá que existe um cliente com id para
        carregar o aceite. Quem entra numa conta que já existe não precisa
        reafirmar nada, e quem pede como visitante não tem cadastro para marcar.
      */}
      {aba === 'criar' && telefoneLimpo.length > 0 && consentimento && (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg bg-secondary/50 p-3">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-[13px] leading-snug">
            <span className="font-medium text-foreground">
              Quero avisos de saldo e promoções no WhatsApp
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Dá para sair pelo link no fim de qualquer mensagem.
            </span>
          </span>
        </label>
      )}

      {aba === 'criar' && (
        <>
          <label htmlFor="conta-email" className="mt-4 block text-sm font-medium">
            E-mail <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <input
            id="conta-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            autoComplete="email"
            className={CAMPO}
          />
        </>
      )}

      <label htmlFor="conta-senha" className="mt-4 block text-sm font-medium">
        Senha
      </label>
      <input
        id="conta-senha"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        type="password"
        minLength={8}
        autoComplete={aba === 'criar' ? 'new-password' : 'current-password'}
        className={CAMPO}
      />
      {aba === 'criar' && (
        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
          Pelo menos 8 caracteres. Guarde bem: ainda não há recuperação de senha.
        </span>
      )}

      {(erro || erroDoPedido) && (
        <p role="alert" className="mt-4 text-[13px] text-destructive">
          {erro ?? erroDoPedido}
        </p>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={!podeEnviar || ocupado}
        className="mt-5 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
      >
        {ocupado
          ? 'Um momento…'
          : aba === 'criar'
            ? 'Criar conta e enviar pedido'
            : 'Entrar e enviar pedido'}
      </button>

      <p className="mt-3 text-center text-[12px] text-muted-foreground">
        Não quer conta?{' '}
        <span className="text-foreground">Volte em “Só pedir”</span> — dá para
        pedir sem nada disso.
      </p>
    </div>
  );
}

const CAMPO =
  'mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** "8%" e não "8,00%" — percentual inteiro é o caso normal. */
function formatPct(v: number): string {
  return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}
