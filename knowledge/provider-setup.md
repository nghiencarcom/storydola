# OpenAI Script Provider Setup

StoryAI sends script-writing requests from its server to the OpenAI Responses API. Set `OPENAI_API_KEY` in `.env.local`; keep the key server-side and never use a `NEXT_PUBLIC_*` variable or commit the key.

The default configuration uses `https://api.openai.com/v1`, model `gpt-6-luna`, `reasoning.effort: max`, and `service_tier: fast` from `HTMLVIDEO_SCRIPT_LLM_SERVICE_TIER`. Fallback models are disabled so script requests stay on the selected model. OpenAI currently prices Fast mode for GPT-6 Luna at 2× the Standard rate.
