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

function send(env, chatId, html) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

// --- Bienvenida -------------------------------------------------------------

function welcomeText(users) {
  const names = users
    .map((u) => `<a href="tg://user?id=${u.id}">${escapeHtml(u.first_name)}</a>`)
    .join(", ");
  return [
    `¡Hola, ${names}! 👋 Te damos la bienvenida a la comunidad de traducción de <b>MDN Web Docs al español</b>.`,
    "",
    "Si quieres colaborar, estos son buenos puntos de partida:",
    `📘 <a href="https://github.com/mdn/translated-content/blob/main/docs/es/README.md">Guía para colaborar</a>`,
    `🛠️ <a href="https://github.com/mdn/translated-content/blob/main/docs/es/entorno-local.md">Levantar el entorno local</a>`,
    `📋 <a href="https://github.com/mdn/translated-content/issues?q=is%3Aissue+is%3Aopen+label%3Al10n-es">Issues abiertos en español</a>`,
    "",
    "No hace falta experiencia previa: puedes empezar corrigiendo una traducción desde el navegador. ¡Pregunta lo que necesites!",
  ].join("\n");
}

async function handleMessage(env, msg) {
  const newcomers = (msg.new_chat_members ?? []).filter((u) => !u.is_bot);
  if (newcomers.length) {
    await send(env, msg.chat.id, welcomeText(newcomers));
    return;
  }
  // /chatid ayuda a obtener el valor de TELEGRAM_CHAT_ID durante la configuración.
  if (/^\/chatid(@\w+)?$/.test(msg.text ?? "")) {
    await send(env, msg.chat.id, `El ID de este chat es <code>${msg.chat.id}</code>`);
  }
}

// --- PRs en español ---------------------------------------------------------

async function fetchSpanishPRs(env) {
  const q = encodeURIComponent(`repo:${env.GITHUB_REPO} is:pr label:${env.GITHUB_LABEL}`);
  const res = await fetch(
    `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=30`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "mdn-es-telegram-bot",
        ...(env.GITHUB_TOKEN && { authorization: `Bearer ${env.GITHUB_TOKEN}` }),
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return (await res.json()).items;
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
