/**
 * OpsBrains + employee model presets.
 * Catalog refreshed for current first-party API IDs (as of 2026-08-21).
 * Prefer official aliases/IDs from each vendor’s docs; keep “自定义…” for anything else.
 */

export type ApiFormat = "openai" | "ollama" | "anthropic";

export interface ModelPreset {
  id: string;
  label: string;
  /** Hermes config.yaml model.provider */
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiFormat?: ApiFormat;
  /** True = user fills fields manually */
  custom?: boolean;
}

export const MODEL_PRESETS: ModelPreset[] = [
  // —— OpenAI (GPT-5.6 family) ——
  {
    id: "openai-gpt-5.6",
    label: "GPT-5.6（旗舰 Sol）",
    provider: "openai",
    model: "gpt-5.6",
    baseUrl: "",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "openai-gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "openai",
    model: "gpt-5.6-terra",
    baseUrl: "",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "openai-gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "openai",
    model: "gpt-5.6-luna",
    baseUrl: "",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "openai-gpt-5-mini",
    label: "GPT-5 mini",
    provider: "openai",
    model: "gpt-5-mini",
    baseUrl: "",
    apiKeyEnv: "OPENAI_API_KEY",
  },

  // —— Anthropic (Claude 5 + current Haiku) ——
  {
    id: "anthropic-fable-5",
    label: "Claude Fable 5",
    provider: "anthropic",
    model: "claude-fable-5",
    baseUrl: "",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic-opus-5",
    label: "Claude Opus 5",
    provider: "anthropic",
    model: "claude-opus-5",
    baseUrl: "",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    model: "claude-sonnet-5",
    baseUrl: "",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    baseUrl: "",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },

  // —— Google Gemini ——
  {
    id: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    baseUrl: "",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "gemini",
    model: "gemini-3-flash-preview",
    baseUrl: "",
    apiKeyEnv: "GEMINI_API_KEY",
  },

  // —— DeepSeek V4 ——
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "custom",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "custom",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },

  // —— 通义千问 ——
  {
    id: "qwen-3.8-max",
    label: "通义 Qwen3.8-Max",
    provider: "custom",
    model: "qwen3.8-max",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
  },

  // —— 智谱 GLM ——
  {
    id: "glm-5.3",
    label: "智谱 GLM-5.3",
    provider: "custom",
    model: "glm-5.3",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
  },
  {
    id: "glm-5",
    label: "智谱 GLM-5",
    provider: "custom",
    model: "glm-5",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
  },
  {
    id: "glm-4.7",
    label: "智谱 GLM-4.7",
    provider: "custom",
    model: "glm-4.7",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
  },

  // —— Moonshot ——
  {
    id: "moonshot-v1-8k",
    label: "Moonshot v1 8K",
    provider: "custom",
    model: "moonshot-v1-8k",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
  },
  {
    id: "moonshot-v1-32k",
    label: "Moonshot v1 32K",
    provider: "custom",
    model: "moonshot-v1-32k",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
  },

  // —— 豆包 / 火山 ——
  {
    id: "doubao-pro",
    label: "豆包 Pro",
    provider: "custom",
    model: "doubao-pro-32k",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "ARK_API_KEY",
  },
  {
    id: "doubao-lite",
    label: "豆包 Lite",
    provider: "custom",
    model: "doubao-lite-32k",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "ARK_API_KEY",
  },

  // —— MiniMax ——
  {
    id: "minimax-abab6",
    label: "MiniMax abab6.5",
    provider: "custom",
    model: "abab6.5-chat",
    baseUrl: "https://api.minimax.chat/v1",
    apiKeyEnv: "MINIMAX_API_KEY",
  },

  {
    id: "ollama-local",
    label: "Ollama 本地（手选 tags）",
    provider: "custom",
    model: "",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyEnv: "",
    custom: true,
  },

  {
    id: "custom",
    label: "自定义…",
    provider: "custom",
    model: "",
    baseUrl: "",
    apiKeyEnv: "",
    custom: true,
  },
];

export function listModelPresets(): ModelPreset[] {
  return MODEL_PRESETS;
}

export function findModelPreset(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((p) => p.id === id);
}

/** Match preset by exact model id (employee override / brain.model). */
export function findPresetByModel(model: string): ModelPreset | undefined {
  const m = model.trim();
  if (!m) return undefined;
  return MODEL_PRESETS.find((p) => !p.custom && p.model === m);
}

export function resolvePresetIdForBrain(cfg: {
  model?: string;
  provider?: string;
  baseUrl?: string;
}): string {
  const byModel = findPresetByModel(cfg.model ?? "");
  if (byModel) {
    if (!cfg.baseUrl?.trim() || cfg.baseUrl.trim() === byModel.baseUrl) return byModel.id;
  }
  if ((cfg.model ?? "").trim() || (cfg.baseUrl ?? "").trim() || (cfg.provider ?? "").trim()) {
    return "custom";
  }
  return "custom";
}
