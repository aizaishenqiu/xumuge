/** Bundled reference pricing (CNY per 1M tokens). Synced from manifest via xu_sync_model_pricing. */

export interface ModelPricingTier {
  inputPerMTokCny: number;
  outputPerMTokCny: number;
  cacheReadPerMTokCny?: number;
  hoursLocal?: string;
}

export interface ModelPricing {
  inputPerMTokCny: number;
  outputPerMTokCny: number;
  cacheReadPerMTokCny?: number;
  peak?: ModelPricingTier;
  offPeak?: ModelPricingTier;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  local: { inputPerMTokCny: 0, outputPerMTokCny: 0, cacheReadPerMTokCny: 0 },
  "deepseek-v4-flash": {
    inputPerMTokCny: 0.14,
    outputPerMTokCny: 0.28,
    cacheReadPerMTokCny: 0.014,
  },
  "deepseek-v4-pro": {
    inputPerMTokCny: 0.55,
    outputPerMTokCny: 2.19,
    cacheReadPerMTokCny: 0.055,
  },
  "openai-gpt-5.6": {
    inputPerMTokCny: 1.75,
    outputPerMTokCny: 14,
    cacheReadPerMTokCny: 0.175,
  },
};

export function pricingLabelForPreset(presetId: string): string {
  if (!presetId || presetId === "local") return "本地模型";
  return presetId;
}
