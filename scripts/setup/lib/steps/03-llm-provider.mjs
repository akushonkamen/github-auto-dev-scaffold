/**
 * Step 3 — LLM provider.
 * GLM 5.2 via Zhipu (default, matches repo's claude-code settings.json) /
 * Anthropic direct / custom endpoint.
 * Performs a health probe against /v1/messages.
 */
import { input, password, select } from '../prompts.mjs';
import { maskSecret, validateHttpUrl, validateModelId } from '../validators.mjs';

export const id = '03-llm-provider';
export const title = 'LLM provider';

export const PRESETS = {
  glm: {
    name: 'GLM 5.2 via Zhipu bigmodel.cn (recommended — matches repo default)',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    keyEnv: 'LLM_API_KEY',
    model: 'glm-5.2',
  },
  anthropic: {
    name: 'Anthropic direct (Claude Opus / Sonnet / Haiku)',
    baseUrl: '',
    keyEnv: 'LLM_API_KEY',
    model: 'claude-opus-4-7',
  },
  custom: { name: 'Custom Anthropic-compatible endpoint', baseUrl: '', keyEnv: '', model: '' },
};

export async function run(ctx) {
  const { preview, state } = ctx;

  const providerKey = await select({
    message: 'LLM provider:',
    choices: Object.entries(PRESETS).map(([k, v]) => ({ name: v.name, value: k })),
  });
  const preset = PRESETS[providerKey];

  let baseUrl = preset.baseUrl;
  let keyEnv = preset.keyEnv;
  let model = preset.model;

  if (providerKey === 'custom') {
    const url = await input({
      message: 'Anthropic-compatible base URL (https://…):',
      validate: (s) => validateHttpUrl(s).ok || validateHttpUrl(s).error,
    });
    baseUrl = validateHttpUrl(url).value;
    keyEnv = await input({
      message: 'Secret name for API key (e.g. LLM_API_KEY):',
      default: 'CUSTOM_API_KEY',
    });
    model = await input({
      message: 'Default model id:',
      validate: (s) => validateModelId(s).ok || validateModelId(s).error,
    });
  }

  const key = await password({ message: `${keyEnv} value (input masked):`, mask: '*' });

  preview.info('Health probe: POST $base/v1/messages');
  const probe = await probeModel(baseUrl, key, model);
  if (!probe.ok) {
    preview.error(`health probe failed: ${probe.error}`);
    return { status: 'failed' };
  }
  preview.notice(`probe ok (${probe.latencyMs}ms)`);

  ctx.llm = { provider: providerKey, baseUrl, keyEnv, model };
  ctx._secrets = ctx._secrets || {};
  ctx._secrets[keyEnv] = key;
  state.llm = { provider: providerKey, baseUrl, keyEnv, model };
  preview.info(`API key masked: ${maskSecret(key)}`);
  return { status: 'ok' };
}

async function probeModel(baseUrl, key, model) {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/v1/messages` : 'https://api.anthropic.com/v1/messages';
  const start = Date.now();
  try {
    // Send both auth headers — native Anthropic uses x-api-key, compat layers
    // (e.g. Zhipu/GLM bigmodel.cn) typically use Authorization: Bearer. Each
    // server picks the one it recognises and ignores the other.
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'authorization': `Bearer ${key}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const latencyMs = Date.now() - start;
    if (res.status === 200) return { ok: true, latencyMs };
    const text = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 140)}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

