// Registra la URL del Worker como webhook del bot en Telegram.
// Uso: npm run set-webhook -- https://mdn-es-telegram-bot.TU_SUBDOMINIO.workers.dev
// Lee TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET de .dev.vars.

const workerUrl = process.argv[2];
const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;

if (!workerUrl || !TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
  console.error("Uso: npm run set-webhook -- <URL del Worker>");
  console.error("y define TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en .dev.vars");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: new URL("/telegram", workerUrl).href,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
  }),
});
console.log(await res.json());
