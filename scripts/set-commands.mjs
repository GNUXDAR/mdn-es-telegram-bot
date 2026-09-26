// Registra los comandos del bot para que Telegram los sugiera al escribir "/".
// Uso: npm run set-commands
// Lee TELEGRAM_BOT_TOKEN de .dev.vars.

const { TELEGRAM_BOT_TOKEN } = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("Define TELEGRAM_BOT_TOKEN en .dev.vars");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    commands: [
      { command: "ayuda", description: "Enlaces para empezar a colaborar" },
      { command: "prs", description: "PRs abiertos en español" },
      { command: "issues", description: "Issues abiertos en español" },
    ],
  }),
});
console.log(await res.json());
