# Convite Gabriel & Halanaia

Site de convite com confirmação de presença, lista de presentes via Supabase e pagamento por cartão com Mercado Pago Checkout Pro.

## Variáveis de ambiente

Configure na Railway:

```env
SUPABASE_URL=https://lyuqvwrikfajmcodwous.supabase.co
SUPABASE_ANON_KEY=...
MERCADO_PAGO_ACCESS_TOKEN=...
NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY=...
MERCADO_PAGO_WEBHOOK_SECRET=...
SITE_URL=https://convite-production.up.railway.app
BACKEND_URL=https://convite-production.up.railway.app
```

O `MERCADO_PAGO_ACCESS_TOKEN` fica apenas no backend. Não coloque esse token em arquivos públicos nem no frontend.

## Banco de dados

Rode os scripts no Supabase SQL Editor, nesta ordem:

```txt
supabase-schema.sql
supabase-functions.sql
supabase-payments.sql
```

O arquivo `supabase-payments.sql` cria/adapta a tabela `payment_orders`, cria a função para pedido pendente do Mercado Pago, atualiza o status real pelo webhook e reserva o presente quando o pagamento é aprovado.

## Mercado Pago

No painel Mercado Pago Developers:

1. Crie uma aplicação com Checkout Pro.
2. Use o `Access Token` em `MERCADO_PAGO_ACCESS_TOKEN`.
3. Use a `Public Key` em `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY`.
4. Configure Webhooks para o evento `payment`.
5. URL do webhook:

```txt
https://convite-production.up.railway.app/api/webhooks/mercadopago
```

6. Copie a assinatura secreta do webhook para `MERCADO_PAGO_WEBHOOK_SECRET`.

## Fluxo de pagamento

1. O convidado escolhe um presente.
2. Informa nome, e-mail e mensagem opcional.
3. O backend cria uma intenção em `payment_orders`.
4. O backend cria uma preferência no Mercado Pago.
5. O frontend redireciona para `init_point`.
6. O Mercado Pago chama o webhook.
7. O webhook consulta `/v1/payments/:id` no Mercado Pago.
8. Se o status for `approved`, o presente é reservado em `gift_reservations`.

As páginas de retorno existem em:

```txt
/pagamento/sucesso
/pagamento/erro
/pagamento/pendente
```

Elas não confirmam pagamento sozinhas. A confirmação real é feita pelo webhook.

## Teste

Use credenciais sandbox/teste do Mercado Pago primeiro. Depois de configurar as variáveis:

```bash
npm start
```

Abra a lista, escolha um presente, selecione cartão e confirme. O checkout deve abrir no Mercado Pago.
