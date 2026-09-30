#!/usr/bin/env node
/**
 * A tiny fake OpenAI-compatible server for the CI Docker smoke test
 * (ADR 0011 D6). Docker Model Runner is not available on GitHub runners, so
 * compose.ci.yaml runs this in its place. Node built-ins only; no model, no
 * network, no secrets.
 *
 *   GET  {/v1,/engines/v1}/models            → { data: [{ id: FAKE_MODEL }] }
 *   POST {/v1,/engines/v1}/chat/completions  → a canned JSON quiz verdict
 *
 * Fails the request (400) when an Authorization header arrives: the app must
 * never send a key to a keyless local server.
 */
import * as http from 'node:http';

const PORT = Number(process.env.FAKE_OPENAI_PORT ?? 8080);
const MODEL = process.env.FAKE_OPENAI_MODEL ?? 'ai/fake-model';
const MAX_BODY = 1024 * 1024;

const VERDICT = JSON.stringify({
  verdict: 'on_track',
  feedback: 'Fake verdict from the CI server: the direction looks right.',
});

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/')
    .split('?')[0]
    .replace(/^\/engines(\/[^/]+)?(?=\/v1\/)/, '');
  if (req.headers.authorization !== undefined) {
    send(res, 400, { error: { message: 'unexpected Authorization header' } });
    return;
  }
  if (req.method === 'GET' && path === '/v1/models') {
    send(res, 200, {
      object: 'list',
      data: [{ id: MODEL, object: 'model' }],
    });
    return;
  }
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(res, 400, { error: { message: 'invalid JSON' } });
        return;
      }
      if (body?.model !== MODEL || !Array.isArray(body?.messages)) {
        send(res, 400, { error: { message: 'unexpected model or messages' } });
        return;
      }
      send(res, 200, {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        model: MODEL,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: VERDICT },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    return;
  }
  send(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`fake OpenAI-compatible server on :${PORT} (model ${MODEL})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
