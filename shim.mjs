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

      const session = await oc("/session", "POST", {});
      try {
        const answer = await oc(`/session/${session.id}/message`, "POST", {
          model: { providerID: "opencode", modelID: model },
          parts: [{ type: "text", text: prompt }],
        });
        const text = (answer.parts || [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const now = Math.floor(Date.now() / 1000);
        return sendJson(res, 200, {
          id: "chatcmpl-" + now,
          object: "chat.completion",
          created: now,
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } finally {
        oc(`/session/${session.id}`, "DELETE").catch(() => {});
      }
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`shim listening on :${PORT} -> ${OPENCODE_URL}`)
);
