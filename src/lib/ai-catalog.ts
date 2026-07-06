// Snapshot from https://models.dev/catalog.json
// Source docs: https://models.dev/models/ and https://models.dev/providers/

export const providers = [
  {
    "id": "openai",
    "label": "OpenAI",
    "shortLabel": "O",
    "doc": "https://platform.openai.com/docs/models"
  },
  {
    "id": "anthropic",
    "label": "Anthropic",
    "shortLabel": "A",
    "doc": "https://docs.anthropic.com/en/docs/about-claude/models"
  },
  {
    "id": "google",
    "label": "Google",
    "shortLabel": "G",
    "doc": "https://ai.google.dev/gemini-api/docs/models"
  },
  {
    "id": "xai",
    "label": "xAI",
    "shortLabel": "x",
    "doc": "https://docs.x.ai/docs/models"
  },
  {
    "id": "moonshotai",
    "label": "Moonshot AI",
    "shortLabel": "MA",
    "doc": "https://platform.moonshot.ai/docs/api/chat"
  },
  {
    "id": "deepseek",
    "label": "DeepSeek",
    "shortLabel": "D",
    "doc": "https://api-docs.deepseek.com/quick_start/pricing"
  },
  {
    "id": "mistral",
    "label": "Mistral",
    "shortLabel": "M",
    "doc": "https://docs.mistral.ai/getting-started/models/"
  },
  {
    "id": "cohere",
    "label": "Cohere",
    "shortLabel": "C",
    "doc": "https://docs.cohere.com/docs/models"
  },
  {
    "id": "alibaba",
    "label": "Alibaba",
    "shortLabel": "A",
    "doc": "https://www.alibabacloud.com/help/en/model-studio/models"
  },
  {
    "id": "zhipuai",
    "label": "Zhipu AI",
    "shortLabel": "ZA",
    "doc": "https://docs.z.ai/guides/overview/pricing"
  },
  {
    "id": "minimax",
    "label": "MiniMax (minimax.io)",
    "shortLabel": "M(",
    "doc": "https://platform.minimax.io/docs/guides/quickstart"
  },
  {
    "id": "nvidia",
    "label": "Nvidia",
    "shortLabel": "N",
    "doc": "https://docs.api.nvidia.com/nim/"
  }
];

export const models = [
  {
    "id": "openai/gpt-5.5-pro",
    "label": "GPT-5.5 Pro",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.5",
    "label": "GPT-5.5",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.4-nano",
    "label": "GPT-5.4 nano",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.4-mini",
    "label": "GPT-5.4 mini",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.4",
    "label": "GPT-5.4",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.4-pro",
    "label": "GPT-5.4 Pro",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.3-chat-latest",
    "label": "GPT-5.3 Chat (latest)",
    "providerId": "openai"
  },
  {
    "id": "openai/gpt-5.3-codex-spark",
    "label": "GPT-5.3 Codex Spark",
    "providerId": "openai"
  },
  {
    "id": "anthropic/claude-sonnet-5",
    "label": "Claude Sonnet 5",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-fable-5",
    "label": "Claude Fable 5",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-opus-4-8",
    "label": "Claude Opus 4.8",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-opus-4-7",
    "label": "Claude Opus 4.7",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-opus-4-6",
    "label": "Claude Opus 4.6",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-sonnet-4-6",
    "label": "Claude Sonnet 4.6",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-opus-4-5",
    "label": "Claude Opus 4.5 (latest)",
    "providerId": "anthropic"
  },
  {
    "id": "anthropic/claude-opus-4-5-20251101",
    "label": "Claude Opus 4.5",
    "providerId": "anthropic"
  },
  {
    "id": "google/gemini-3.5-flash",
    "label": "Gemini 3.5 Flash",
    "providerId": "google"
  },
  {
    "id": "google/gemini-3.1-flash-lite",
    "label": "Gemini 3.1 Flash Lite",
    "providerId": "google"
  },
  {
    "id": "google/gemma-4-31b-it",
    "label": "Gemma 4 31B IT",
    "providerId": "google"
  },
  {
    "id": "google/gemma-4-26b-a4b-it",
    "label": "Gemma 4 26B A4B IT",
    "providerId": "google"
  },
  {
    "id": "google/gemini-3.1-flash-lite-preview",
    "label": "Gemini 3.1 Flash Lite Preview",
    "providerId": "google"
  },
  {
    "id": "google/gemini-3.1-pro-preview-customtools",
    "label": "Gemini 3.1 Pro Preview Custom Tools",
    "providerId": "google"
  },
  {
    "id": "google/gemini-3.1-pro-preview",
    "label": "Gemini 3.1 Pro Preview",
    "providerId": "google"
  },
  {
    "id": "google/gemini-3-flash-preview",
    "label": "Gemini 3 Flash Preview",
    "providerId": "google"
  },
  {
    "id": "xai/grok-4.3",
    "label": "Grok 4.3",
    "providerId": "xai"
  },
  {
    "id": "xai/grok-build-0.1",
    "label": "Grok Build 0.1",
    "providerId": "xai"
  },
  {
    "id": "xai/grok-4.20-multi-agent-0309",
    "label": "Grok 4.20 Multi-Agent",
    "providerId": "xai"
  },
  {
    "id": "xai/grok-4.20-0309-non-reasoning",
    "label": "Grok 4.20 (Non-Reasoning)",
    "providerId": "xai"
  },
  {
    "id": "xai/grok-4.20-0309-reasoning",
    "label": "Grok 4.20 (Reasoning)",
    "providerId": "xai"
  },
  {
    "id": "moonshotai/kimi-k2.7-code",
    "label": "Kimi K2.7 Code",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2.7-code-highspeed",
    "label": "Kimi K2.7 Code HighSpeed",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "label": "Kimi K2.6",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2.5",
    "label": "Kimi K2.5",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2-thinking-turbo",
    "label": "Kimi K2 Thinking Turbo",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2-thinking",
    "label": "Kimi K2 Thinking",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2-0905-preview",
    "label": "Kimi K2 0905",
    "providerId": "moonshotai"
  },
  {
    "id": "moonshotai/kimi-k2-turbo-preview",
    "label": "Kimi K2 Turbo",
    "providerId": "moonshotai"
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "label": "DeepSeek V4 Flash",
    "providerId": "deepseek"
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "label": "DeepSeek V4 Pro",
    "providerId": "deepseek"
  },
  {
    "id": "deepseek/deepseek-reasoner",
    "label": "DeepSeek Reasoner",
    "providerId": "deepseek"
  },
  {
    "id": "deepseek/deepseek-chat",
    "label": "DeepSeek Chat",
    "providerId": "deepseek"
  },
  {
    "id": "mistral/mistral-medium-latest",
    "label": "Mistral Medium (latest)",
    "providerId": "mistral"
  },
  {
    "id": "mistral/mistral-medium-2604",
    "label": "Mistral Medium 3.5",
    "providerId": "mistral"
  },
  {
    "id": "mistral/mistral-small-latest",
    "label": "Mistral Small (latest)",
    "providerId": "mistral"
  },
  {
    "id": "mistral/mistral-small-2603",
    "label": "Mistral Small 4",
    "providerId": "mistral"
  },
  {
    "id": "mistral/devstral-latest",
    "label": "Devstral 2",
    "providerId": "mistral"
  },
  {
    "id": "mistral/devstral-2512",
    "label": "Devstral 2",
    "providerId": "mistral"
  },
  {
    "id": "mistral/labs-devstral-small-2512",
    "label": "Devstral Small 2",
    "providerId": "mistral"
  },
  {
    "id": "mistral/mistral-large-latest",
    "label": "Mistral Large (latest)",
    "providerId": "mistral"
  },
  {
    "id": "cohere/command-a-plus-05-2026",
    "label": "Command A Plus",
    "providerId": "cohere"
  },
  {
    "id": "cohere/north-mini-code-1-0",
    "label": "North Mini Code",
    "providerId": "cohere"
  },
  {
    "id": "cohere/command-a-translate-08-2025",
    "label": "Command A Translate",
    "providerId": "cohere"
  },
  {
    "id": "cohere/command-a-reasoning-08-2025",
    "label": "Command A Reasoning",
    "providerId": "cohere"
  },
  {
    "id": "cohere/command-a-vision-07-2025",
    "label": "Command A Vision",
    "providerId": "cohere"
  },
  {
    "id": "cohere/c4ai-aya-vision-32b",
    "label": "Aya Vision 32B",
    "providerId": "cohere"
  },
  {
    "id": "cohere/c4ai-aya-vision-8b",
    "label": "Aya Vision 8B",
    "providerId": "cohere"
  },
  {
    "id": "cohere/command-a-03-2025",
    "label": "Command A",
    "providerId": "cohere"
  },
  {
    "id": "alibaba/qwen3.7-plus",
    "label": "Qwen3.7 Plus",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.7-max",
    "label": "Qwen3.7 Max",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.6-flash",
    "label": "Qwen3.6 Flash",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.6-27b",
    "label": "Qwen3.6 27B",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.6-max-preview",
    "label": "Qwen3.6 Max Preview",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.6-35b-a3b",
    "label": "Qwen3.6 35B-A3B",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.6-plus",
    "label": "Qwen3.6 Plus",
    "providerId": "alibaba"
  },
  {
    "id": "alibaba/qwen3.5-27b",
    "label": "Qwen3.5 27B",
    "providerId": "alibaba"
  },
  {
    "id": "zhipuai/glm-5.2",
    "label": "GLM-5.2",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-5v-turbo",
    "label": "GLM-5V-Turbo",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-5.1",
    "label": "GLM-5.1",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-5",
    "label": "GLM-5",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-4.7-flash",
    "label": "GLM-4.7-Flash",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-4.7-flashx",
    "label": "GLM-4.7-FlashX",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-4.7",
    "label": "GLM-4.7",
    "providerId": "zhipuai"
  },
  {
    "id": "zhipuai/glm-4.6v",
    "label": "GLM-4.6V",
    "providerId": "zhipuai"
  },
  {
    "id": "minimax/MiniMax-M3",
    "label": "MiniMax-M3",
    "providerId": "minimax"
  },
  {
    "id": "minimax/MiniMax-M2.7-highspeed",
    "label": "MiniMax-M2.7-highspeed",
    "providerId": "minimax"
  },
  {
    "id": "minimax/MiniMax-M2.7",
    "label": "MiniMax-M2.7",
    "providerId": "minimax"
  },
  {
    "id": "minimax/MiniMax-M2.5-highspeed",
    "label": "MiniMax-M2.5-highspeed",
    "providerId": "minimax"
  },
  {
    "id": "minimax/MiniMax-M2.5",
    "label": "MiniMax-M2.5",
    "providerId": "minimax"
  },
  {
    "id": "minimax/MiniMax-M2.1",
    "label": "MiniMax-M2.1",
    "providerId": "minimax"
  },
  {
    "id": "minimax/MiniMax-M2",
    "label": "MiniMax-M2",
    "providerId": "minimax"
  },
  {
    "id": "nvidia/z-ai/glm-5.2",
    "label": "GLM-5.2",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/nvidia/nemotron-3-ultra-550b-a55b",
    "label": "Nemotron 3 Ultra 550B A55B",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/minimaxai/minimax-m3",
    "label": "MiniMax-M3",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/stepfun-ai/step-3.7-flash",
    "label": "Step 3.7 Flash",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/baai/bge-m3",
    "label": "BGE M3",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/meta/llama-guard-4-12b",
    "label": "Llama Guard 4 12B",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "label": "Nemotron 3 Nano Omni",
    "providerId": "nvidia"
  },
  {
    "id": "nvidia/deepseek-ai/deepseek-v4-flash",
    "label": "DeepSeek V4 Flash",
    "providerId": "nvidia"
  }
];
