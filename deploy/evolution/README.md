# A máquina da Evolution

Tudo que roda **fora** da Vercel: a Evolution API (que mantém a sessão do
WhatsApp aberta) e o worker de campanhas (que chama `/api/marketing/tick` em
laço).

Nenhum dos dois pode ser serverless. A Evolution tem estado em disco e uma
conexão viva com o WhatsApp; o worker precisa obedecer ao intervalo de 40 a 90
segundos que o `tick` devolve, e o cron da Vercel tem granularidade de um
minuto no plano Pro — e de um dia no Hobby.

## Instalar

Numa Oracle `VM.Standard.E2.1.Micro` (1 GB) com Ubuntu 22.04 ou 24.04:

```bash
scp -r deploy/evolution ubuntu@SEU_IP:/tmp/
ssh ubuntu@SEU_IP 'sudo mkdir -p /opt/evolution && sudo cp -r /tmp/evolution/* /opt/evolution/ && sudo chown -R ubuntu:ubuntu /opt/evolution'
ssh ubuntu@SEU_IP 'cd /opt/evolution && bash setup.sh SEU-DOMINIO'
```

Sem domínio próprio, use `sslip.io`: para o IP `147.15.61.138`, o domínio é
`147-15-61-138.sslip.io`. Ele resolve para o próprio IP e o Let's Encrypt emite
certificado normalmente — é HTTPS de verdade, não autoassinado.

### Depois

1. **Abra 80 e 443 na Security List da Oracle.** O `setup.sh` cuida do iptables
   da máquina, mas a camada do painel é sua. Sem ela o pacote nem chega.
2. **Leia a chave da API** — ela é gerada na máquina e nunca impressa:
   ```bash
   grep AUTHENTICATION_API_KEY /opt/evolution/evolution.env
   ```
   Esse valor vai em `EVOLUTION_API_KEY` na Vercel, junto com
   `EVOLUTION_API_URL=https://SEU-DOMINIO`.
3. **Suba o worker**:
   ```bash
   sudo cp /opt/evolution/pedidos-ia-worker.service /etc/systemd/system/
   printf 'PEDIDOS_IA_URL=https://seu-app.vercel.app\nMARKETING_WORKER_SECRET=<o mesmo da Vercel>\n' \
     | sudo tee /opt/evolution/worker.env >/dev/null
   sudo chmod 600 /opt/evolution/worker.env
   sudo cp worker/marketing-worker.mjs /opt/evolution/
   sudo systemctl daemon-reload && sudo systemctl enable --now pedidos-ia-worker
   ```

## Conferir

```bash
docker compose -f /opt/evolution/docker-compose.yml ps
journalctl -u pedidos-ia-worker -f
free -h                      # a memória é o recurso escasso aqui
```

## Conectar um número

Uma instância por restaurante. O nome dela vai em
**Gestão → Configurações → WhatsApp** no app — é por ele que o sistema sabe por
qual número mandar.

```bash
CHAVE=$(grep AUTHENTICATION_API_KEY /opt/evolution/evolution.env | cut -d= -f2)
curl -s -X POST https://SEU-DOMINIO/instance/create \
  -H "apikey: $CHAVE" -H 'Content-Type: application/json' \
  -d '{"instanceName":"brasa-burger","integration":"WHATSAPP-BAILEYS","qrcode":true}'
```

O QR volta na resposta, em base64. Leia com o WhatsApp do restaurante.

## Se ficar sem memória

`free -h` mostrando swap em uso constante é o sinal. Nesta ordem:

1. `DATABASE_SAVE_*` já vêm desligados no `evolution.env` — confira que
   continuam assim;
2. reduza `MemoryMax` do worker;
3. troque a máquina por uma ARM (`VM.Standard.A1.Flex`, 1 OCPU / 6 GB já é
   sobra). Migrar é copiar os volumes `postgres_dados` e
   `evolution_instancias` — a sessão do WhatsApp vai junto e ninguém precisa
   ler QR de novo.
