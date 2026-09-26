# Bot de Telegram de MDN en español

1. Da la bienvenida a quien entra al grupo y le enlaza la guía para colaborar.
2. Avisa en el grupo cuando se abre un PR con la etiqueta `l10n-es` en `mdn/translated-content`.

Corre gratis en [Cloudflare Workers](https://developers.cloudflare.com/workers/):

- **Bienvenida:** Telegram llama al Worker por webhook en cuanto alguien entra, así que la respuesta es inmediata.
- **PRs:** un Cron Trigger revisa GitHub cada 5 minutos. Los PRs ya avisados se guardan en Workers KV.

## Configuración

Necesitas Node 22 o superior y una cuenta gratis de Cloudflare.

1. **Crea el bot:** habla con [@BotFather](https://t.me/BotFather), ejecuta `/newbot` y guarda el token.
2. **Instala y entra en Cloudflare:**

   ```bash
   npm install
   npx wrangler login
   ```

3. **Crea el almacenamiento** y pega el `id` que te devuelve en `wrangler.toml`, en la sección `[[kv_namespaces]]`:

   ```bash
   npx wrangler kv namespace create STATE
   ```

4. **Guarda los secretos en Cloudflare.** Para `TELEGRAM_WEBHOOK_SECRET` inventa una cadena aleatoria, por ejemplo con `openssl rand -hex 32`:

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put GITHUB_TOKEN   # opcional
   ```

5. **Despliega:** `npm run deploy`. Al terminar te muestra la URL del Worker (`https://mdn-es-telegram-bot.<tu-subdominio>.workers.dev`).
6. **Conecta Telegram con el Worker.** Copia `.dev.vars.example` a `.dev.vars`, pon el mismo token y el mismo secreto del paso 4, y ejecuta:

   ```bash
   npm run set-webhook -- https://mdn-es-telegram-bot.<tu-subdominio>.workers.dev
   ```

7. **Añade el bot al grupo** y hazlo administrador para que reciba los avisos de miembros nuevos de forma fiable.
8. **Activa los avisos de PRs:** escribe `/chatid` en el grupo, pon ese número en `TELEGRAM_CHAT_ID` dentro de `wrangler.toml` y vuelve a desplegar.

En la primera revisión, los PRs que ya existen se marcan como vistos, así que solo se notifican los nuevos.

## Despliegue automático desde GitHub

En el panel de Cloudflare, ve a **Workers & Pages → mdn-es-telegram-bot → Settings → Builds** y conecta este repositorio. Desde entonces, cada push a `main` se despliega solo. Los secretos no van en el repo: ya quedaron guardados en Cloudflare en el paso 4.

## Cómo detecta los PRs

Como no somos administradores de `mdn/translated-content`, no podemos añadir un webhook de GitHub. En su lugar, el bot consulta la API de búsqueda cada 5 minutos. La etiqueta `l10n-es` la añade una Action poco después de abrirse el PR, así que el aviso puede tardar unos minutos más.

## Probar en local

```bash
npm run dev
# En otra terminal, simula la revisión programada:
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

`npm run dev` usa un KV local y lee los secretos de `.dev.vars`.
