// shim.mjs — OpenAI-compatible chat/completions -> opencode serve session API
import http from "node:http";

const OPENCODE_URL = process.env.OPENCODE_URL || "http://127.0.0.1:4096";
const OC_USER = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const OC_PASS = process.env.OPENCODE_SERVER_PASSWORD || "";
const SHIM_KEY = process.env.SHIM_API_KEY || "";
const MODEL_ID = process.env.MODEL_ID || "muse-spark-1.3-contributor-free";
const PORT = parseInt(process.env.SHIM_PORT || "8080", 10);

const basicAuth =
  "Basic " + Buffer.from(`${OC_USER}:${OC_PASS}`).toString("base64");

async function oc(path, method = "GET", body) {
  const res = await fetch(`${OPENCODE_URL}${path}`, {
    method,
    headers: { Authorization: basicAuth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`opencode ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function messagesToPrompt(messages) {
  return (messages || [])
    .map((m) => {
      let content = m.content;
      if (Array.isArray(content)) {
        content = content
          .map((p) => (p.type === "text" ? p.text : `[${p.type}]`))
          .join("\n");
      }
      const role =
        m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      return `${role}: ${content ?? ""}`;
    })
    .join("\n\n");
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function askOpenCode(model, prompt) {
  const session = await oc("/session", "POST", {});
  try {
    const answer = await oc(`/session/${session.id}/message`, "POST", {
      model: { providerID: "opencode", modelID: model },
      parts: [{ type: "text", text: prompt }],
    });
    return (answer.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  } finally {
    oc(`/session/${session.id}`, "DELETE").catch(() => {});
  }
}

function sseChunk(id, created, model, delta, finishReason) {
  return (
    "data: " +
    JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }) +
    "\n\n"
  );
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/v1/models") {
      return sendJson(res, 200, {
        object: "list",
        data: [
          { id: MODEL_ID, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "opencode" },
        ],
      });
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      if (SHIM_KEY && req.headers.authorization !== `Bearer ${SHIM_KEY}`) {
        return sendJson(res, 401, { error: "unauthorized" });
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const model = body.model || MODEL_ID;
      const prompt = messagesToPrompt(body.messages);
      const now = Math.floor(Date.now() / 1000);
      const cid = "chatcmpl-" + now;

      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(sseChunk(cid, now, model, { role: "assistant" }, null));
        try {
          const text = await askOpenCode(model, prompt);
          for (let i = 0; i < text.length; i += 24) {
            res.write(
              sseChunk(cid, now, model, { content: text.slice(i, i + 24) }, null)
            );
          }
          res.write(sseChunk(cid, now, model, {}, "stop"));
          res.write("data: [DONE]\n\n");
        } catch (e) {
          res.write(
            "data: " + JSON.stringify({ error: String((e && e.message) || e) }) + "\n\n"
          );
        }
        res.end();
        return;
      }

      const text = await askOpenCode(model, prompt);
      return sendJson(res, 200, {
        id: cid,
        object: "chat.completion",
        created: now,
        model,
        choices: [
          { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    try {
      return sendJson(res, 500, { error: String((e && e.message) || e) });
    } catch {
      try { res.end(); } catch { /* noop */ }
    }
  }
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`shim listening on :${PORT} -> ${OPENCODE_URL}`)
);
