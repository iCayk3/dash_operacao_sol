# Dashboard SOL Provedor

Dashboard em React/MUI com backend Express integrado ao RouterBox.

## Desenvolvimento

```bash
npm install
npm run dev
```

O frontend e o backend são iniciados juntos.

## Portainer

Crie uma nova Stack usando este repositório Git e o arquivo:

```text
docker-compose.yml
```

Na seção **Environment variables** da Stack, adicione:

```text
ROUTERBOX_INTEGRATION_KEY=SUA_CHAVE
```

As demais variáveis já possuem valores padrão no Compose. Se necessário, também podem ser sobrescritas pelo Portainer:

```text
ROUTERBOX_URL
ROUTERBOX_CACHE_TTL_MS
ROUTERBOX_STATUS_ACTIVE
ROUTERBOX_STATUS_INACTIVE
ROUTERBOX_STATUS_CANCELED
ROUTERBOX_STATUS_SUSPENDED
ROUTERBOX_STATUS_BLOCKED
ROUTERBOX_STATUS_AWAITING_INSTALLATION
```

Após publicar a Stack, a dashboard ficará disponível em:

```text
http://IP_DO_SERVIDOR:6000
```

O Portainer clonará o repositório, construirá a imagem e injetará a chave somente durante a execução do contêiner.

## Docker Compose local

Também é possível executar localmente fornecendo a variável:

```bash
ROUTERBOX_INTEGRATION_KEY=SUA_CHAVE docker compose up -d --build
```
