# Dashboard SOL Provedor

Dashboard em React/MUI com backend Express integrado ao RouterBox.

## Desenvolvimento

```bash
npm install
npm run dev
```

O frontend e o backend são iniciados juntos.

## Docker

Mantenha as credenciais em `.env.local` e execute:

```bash
docker compose up -d --build
```

A dashboard ficará disponível em:

```text
http://localhost:6000
```

Para acompanhar os logs:

```bash
docker compose logs -f dashboard
```

Para reconstruir após alterações:

```bash
docker compose up -d --build
```

Para encerrar:

```bash
docker compose down
```

O `.env.local` não é copiado para a imagem. O Docker Compose injeta suas variáveis somente durante a inicialização do contêiner.
