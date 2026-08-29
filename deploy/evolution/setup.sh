#!/usr/bin/env bash
# =============================================================================
# Monta a máquina da Evolution do zero, numa Oracle E2.1.Micro (1 GB)
# =============================================================================
# Roda NA VM, como o usuário `ubuntu`. É idempotente: rodar duas vezes não
# duplica nada, então dá para reexecutar depois de arrumar algo que faltou.
#
#   curl -fsSL <url-deste-arquivo> | bash -s -- <dominio>
#
# ou, copiando a pasta inteira:
#
#   bash setup.sh 147-15-61-138.sslip.io
# =============================================================================
set -euo pipefail

DOMINIO="${1:-}"
DIR=/opt/evolution

if [ -z "$DOMINIO" ]; then
  echo "uso: bash setup.sh <dominio-ou-ip.sslip.io>" >&2
  exit 1
fi

log() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# ── 1. SWAP ─────────────────────────────────────────────────────────────────
# Primeiro de tudo, e não por capricho: numa máquina de 1 GB sem swap, o kernel
# MATA o processo que estourar. O que estoura primeiro é a Evolution, no meio
# de uma sessão — e quando ela volta, o número pede o QR de novo.
log "swap"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # 10 = só usa swap quando apertar de verdade. O padrão (60) empurraria coisa
  # quente para o disco à toa, e disco de plano gratuito é lento.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null
  sudo sysctl -q vm.swappiness=10
  echo "  2 GB criados"
else
  echo "  já existia"
fi

# ── 2. DOCKER ───────────────────────────────────────────────────────────────
log "docker"
if ! command -v docker >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl >/dev/null
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
  sudo usermod -aG docker ubuntu
  sudo systemctl enable --now docker >/dev/null
  echo "  $(sudo docker --version)"
else
  echo "  já instalado"
fi

# ── 3. FIREWALL DE DENTRO ───────────────────────────────────────────────────
# A Oracle tem DUAS camadas, e esta é a esquecida. As imagens Ubuntu dela sobem
# com um REJECT geral no fim da cadeia INPUT — por isso as regras entram com
# `-I` (no começo) e não `-A` (no fim): depois do REJECT, nada é avaliado.
#
# A camada de fora (Security List / NSG, no painel) continua sendo sua: abra
# 80 e 443 lá também, senão o pacote nem chega aqui.
log "firewall da máquina"
for porta in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$porta" -m state --state NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$porta" -j ACCEPT
    echo "  porta $porta liberada"
  else
    echo "  porta $porta já estava liberada"
  fi
done
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true

# ── 4. SEGREDOS ─────────────────────────────────────────────────────────────
# Gerados AQUI, na máquina, e nunca digitados nem colados de fora: assim eles
# não passam por histórico de terminal, mensagem, nem área de transferência.
log "segredos"
sudo mkdir -p "$DIR"
sudo chown ubuntu:ubuntu "$DIR"

if [ ! -f "$DIR/pg_senha.txt" ]; then
  # HEX, e não base64. A senha entra numa URL de conexão
  # (postgresql://user:SENHA@host:5432/db), e base64 produz `/`, `+` e `=` —
  # uma barra no meio da senha faz o Prisma ler o resto como caminho e falhar
  # com "invalid port number in database URL", que não parece nada com o
  # problema real. Hex tem 128 bits de entropia em 32 caracteres e nunca
  # precisa de escape.
  openssl rand -hex 32 | tr -d '\n' > "$DIR/pg_senha.txt"
  chmod 600 "$DIR/pg_senha.txt"
  echo "  senha do Postgres gerada"
fi

if [ ! -f "$DIR/evolution.env" ]; then
  CHAVE=$(openssl rand -hex 32)
  PG=$(cat "$DIR/pg_senha.txt")
  cat > "$DIR/evolution.env" <<ENV
AUTHENTICATION_API_KEY=$CHAVE
SERVER_URL=https://$DOMINIO

DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$PG@postgres:5432/evolution?schema=public
DATABASE_CONNECTION_CLIENT_NAME=evolution

# O que guardar no banco. Mensagem e contato ficam DESLIGADOS: este servidor
# existe para MANDAR campanha, não para ser um histórico de conversas — e numa
# máquina de 1 GB, guardar tudo enche o disco e a memória à toa.
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

LOG_LEVEL=ERROR
LOG_COLOR=false
DEL_INSTANCE=false
QRCODE_LIMIT=10
ENV
  chmod 600 "$DIR/evolution.env"
  echo "  chave da API gerada"
fi

# ── 5. SUBIR ────────────────────────────────────────────────────────────────
log "subindo os contêineres"
cd "$DIR"
DOMINIO="$DOMINIO" sudo -E docker compose up -d

echo
log "pronto"
echo "  Evolution:  https://$DOMINIO"
echo
echo "  A chave da API está em $DIR/evolution.env, na linha"
echo "  AUTHENTICATION_API_KEY. Ela NUNCA foi impressa aqui de propósito —"
echo "  leia com:"
echo
echo "      grep AUTHENTICATION_API_KEY $DIR/evolution.env"
echo
echo "  É esse valor que vai em EVOLUTION_API_KEY na Vercel."
