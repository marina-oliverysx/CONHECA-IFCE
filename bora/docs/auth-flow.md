# Fluxo de autenticação por e-mail

O sistema não usa senha. Uma conta pública recebe o perfil `VISITOR`; o cadastro e a solicitação de acesso enviam a mesma resposta genérica para não indicar se um endereço já existe.

## Configuração local

Copie os nomes de variáveis de `.env.example` para `.env` e preencha uma chave de envio Resend e um remetente permitido/verificado. Nunca compartilhe ou versione `.env`. A API usa a API HTTP oficial do Resend; a chave deve ter permissão somente para enviar e-mails.

## Rotas

### `POST /auth/register`

JSON:

```json
{"name":"Ana Silva","email":"ana@example.com"}
```

Cria uma conta `VISITOR` se ainda não existir e envia token de acesso de uso único. Responde `202` com mensagem genérica. Campos ausentes ou inválidos retornam `400`.

### `POST /auth/request-access`

JSON:

```json
{"email":"ana@example.com"}
```

Envia token para uma conta existente. Responde `202` com a mesma mensagem genérica para endereço cadastrado ou não cadastrado.

### `POST /auth/confirm`

JSON com o token copiado do e-mail:

```json
{"token":"TOKEN_RECEBIDO_POR_EMAIL"}
```

Token dura 10 minutos e só pode ser usado uma vez. Sucesso retorna `200` e define cookie `session` HttpOnly. Tokens inválidos, vencidos ou usados retornam `401`.

### `GET /auth/me`

Requer o cookie de sessão; retorna os dados públicos do usuário autenticado e seu perfil.

### `POST /auth/logout`

Requer sessão; revoga-a no banco e limpa o cookie.

### `GET /task`

Exemplo de rota protegida. Requer sessão válida.

### `PATCH /admin/users/:id/role`

Requer sessão `ADMIN`. JSON:

```json
{"role":"MEMBER"}
```

Promove somente um `VISITOR` a `MEMBER`; não permite alterar o próprio perfil para `ADMIN`.

## Uso manual

1. Inicie a API com `npm run dev`.
2. Envie `POST /auth/register` ou `POST /auth/request-access` com JSON.
3. Copie o token recebido por e-mail e envie em `POST /auth/confirm`.
4. Guarde o cookie retornado pelo cliente HTTP e use-o em `/auth/me`, `/task` e `/auth/logout`.

Em navegador, o frontend deve chamar a API com credenciais/cookies habilitados e enviar o token do e-mail no corpo de `/auth/confirm`. A API não inclui token ou hash nas respostas. O token persistido e a sessão ficam armazenados como SHA-256 no banco.

## Antes de publicar

Configurar HTTPS e `NODE_ENV=production` (ativa `Secure` no cookie), limitar tentativas por IP e endereço com armazenamento compartilhado, proteger contra CSRF conforme a origem do frontend, limpar tokens/sessões expirados periodicamente e configurar domínio remetente no provedor. A limitação de tentativas ainda não está implementada nesta versão.
