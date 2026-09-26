const STATE_KEY = "seen-prs";
const MAX_SEEN = 300;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

function send(env, chatId, html, replyTo) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo && { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }),
  });
}

// --- Bienvenida y comandos --------------------------------------------------

const LINKS = [
  `📘 <a href="https://github.com/mdn/translated-content/blob/main/docs/es/README.md">Guía para colaborar</a>`,
  `🛠️ <a href="https://github.com/mdn/translated-content/blob/main/docs/es/entorno-local.md">Levantar el entorno local</a>`,
  `📋 <a href="https://github.com/mdn/translated-content/issues?q=is%3Aissue+is%3Aopen+label%3Al10n-es">Issues abiertos en español</a>`,
];

function welcomeText(users) {
  const names = users
    .map((u) => `<a href="tg://user?id=${u.id}">${escapeHtml(u.first_name)}</a>`)
    .join(", ");
  return [
    `¡Hola, ${names}! 👋 Te damos la bienvenida a la comunidad de traducción de <b>MDN Web Docs al español</b>.`,
    "",
    "Si quieres colaborar, estos son buenos puntos de partida:",
    ...LINKS,
    "",
    "No hace falta experiencia previa: puedes empezar corrigiendo una traducción desde el navegador. ¡Pregunta lo que necesites!",
  ].join("\n");
}

function helpText() {
  return [
    "Soy el bot de la comunidad de traducción de <b>MDN Web Docs al español</b>.",
    "",
    ...LINKS,
    "",
    "/prs · PRs abiertos en español",
    "/issues · issues abiertos para empezar a colaborar",
    "/ayuda · este mensaje",
  ].join("\n");
}

const LIST_LIMIT = 8;

async function listText(env, kind) {
  const filter = `is:${kind} is:open`;
  const { total, items } = await searchGitHub(env, filter, LIST_LIMIT);
  const what = kind === "pr" ? "PRs" : "issues";
  const title = kind === "pr" ? "PRs" : "Issues";
  if (!total) return `No hay ${what} abiertos en español ahora mismo.`;
  const q = encodeURIComponent(`${filter} label:${env.GITHUB_LABEL}`);
  const all = `https://github.com/${env.GITHUB_REPO}/${kind === "pr" ? "pulls" : "issues"}?q=${q}`;
  return [
    `<b>${title} abiertos en español</b> (${total})`,
    "",
    ...items.map((i) => `• <a href="${i.html_url}">#${i.number}</a> ${escapeHtml(i.title)}`),
    ...(total > items.length ? ["", `<a href="${all}">Ver los ${total} en GitHub</a>`] : []),
  ].join("\n");
}

const COMMANDS = {
  ayuda: helpText,
  start: helpText,
  prs: (env) => listText(env, "pr"),
  issues: (env) => listText(env, "issue"),
  // Ayuda a obtener el valor de TELEGRAM_CHAT_ID durante la configuración.
  chatid: (env, msg) => `El ID de este chat es <code>${msg.chat.id}</code>`,
};

async function handleMessage(env, msg) {
  const newcomers = (msg.new_chat_members ?? []).filter((u) => !u.is_bot);
  if (newcomers.length) {
    await send(env, msg.chat.id, welcomeText(newcomers));
    return;
  }

  const match = /^\/([a-z]+)(?:@(\w+))?(?:\s|$)/i.exec(msg.text ?? "");
  if (!match) return;
  const [, name, target] = match;
  // En un grupo con varios bots, /cmd@otro_bot no es para nosotros.
  if (target && target.toLowerCase() !== env.BOT_USERNAME.toLowerCase()) return;
  const command = COMMANDS[name.toLowerCase()];
  if (!command) return;

  let text;
  try {
    text = await command(env, msg);
  } catch (e) {
    console.error(e.message);
    text = "No pude consultar GitHub en este momento. Inténtalo de nuevo en un minuto.";
  }
  await send(env, msg.chat.id, text, msg.message_id);
}

// --- PRs en español ---------------------------------------------------------

async function searchGitHub(env, filter, perPage) {
  const q = encodeURIComponent(`repo:${env.GITHUB_REPO} label:${env.GITHUB_LABEL} ${filter}`);
  const res = await fetch(
    `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=${perPage}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "mdn-es-telegram-bot",
        ...(env.GITHUB_TOKEN && { authorization: `Bearer ${env.GITHUB_TOKEN}` }),
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { total: data.total_count, items: data.items };
}

async function fetchSpanishPRs(env) {
  return (await searchGitHub(env, "is:pr", 30)).items;
}

function prText(pr) {
  return [
    `🆕 <b>Nuevo PR en español</b>${pr.draft ? " (borrador)" : ""}`,
    `<a href="${pr.html_url}">#${pr.number} ${escapeHtml(pr.title)}</a>`,
    `por <a href="${pr.user.html_url}">@${escapeHtml(pr.user.login)}</a>`,
  ].join("\n");
}

async function checkPRs(env) {
  if (!env.TELEGRAM_CHAT_ID) {
    console.warn("Sin TELEGRAM_CHAT_ID: las notificaciones de PRs están desactivadas");
    return;
  }
  const prs = await fetchSpanishPRs(env);
  const stored = await env.STATE.get(STATE_KEY, "json");

  // Primer arranque: marca lo existente como visto para no inundar el grupo.
  if (!stored) {
    await env.STATE.put(STATE_KEY, JSON.stringify(prs.map((p) => p.number)));
    console.log(`Estado inicial con ${prs.length} PRs`);
    return;
  }

  const seen = new Set(stored);
  // El label lo añade una Action tras abrir el PR, así que se compara por número
  // y no por fecha: un PR etiquetado tarde se notifica en la siguiente vuelta.
  const fresh = prs.filter((p) => !seen.has(p.number)).reverse();
  for (const pr of fresh) {
    await send(env, env.TELEGRAM_CHAT_ID, prText(pr));
    seen.add(pr.number);
  }
  if (fresh.length) {
    const trimmed = [...seen].sort((a, b) => b - a).slice(0, MAX_SEEN);
    await env.STATE.put(STATE_KEY, JSON.stringify(trimmed));
    console.log(`Notificados: ${fresh.map((p) => p.number).join(", ")}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }
    // Telegram reenvía el secret_token configurado en setWebhook en esta cabecera.
    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return new Response("Forbidden", { status: 403 });
    }
    const update = await request.json();
    if (update.message) {
      ctx.waitUntil(handleMessage(env, update.message).catch((e) => console.error(e.message)));
    }
    return new Response("ok");
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkPRs(env));
  },
};
