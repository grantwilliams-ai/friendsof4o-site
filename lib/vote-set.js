// Written by tools/make_vote_set.py from content/vote.json and the name check. Do not edit by hand.
export const VOTE_SET = {
  "set": "everyday-recommended-1",
  "rounds_first": 3,
  "rounds_max": 5,
  "min_votes": 30,
  "check": "4o-nov-check",
  "questions": [
    "s01",
    "s02",
    "s03",
    "s04",
    "s05",
    "s06",
    "s07",
    "s11",
    "s12",
    "s15",
    "s19",
    "s20"
  ],
  "models": [
    "qwen35-35b",
    "qwen38-max",
    "opus55",
    "sonnet46",
    "sonnet55",
    "dsv41-flash-api",
    "gemini38flash",
    "gemini4carbon",
    "gemini4hydrogen",
    "gemini4neon",
    "muse-spark13",
    "mistral-large4",
    "kimi-k31pro",
    "chat-latest",
    "gpt6-luna",
    "gpt62-astra",
    "gpt62-sol",
    "grok47",
    "glm53-flash-api",
    "qwen35-9b",
    "qwen38",
    "gemma12",
    "gemma31",
    "gptoss20",
    "nova-qwen14-maker",
    "aura31b",
    "distil8b",
    "distil70b",
    "helcyon-g4-maker",
    "helcyon-4o-v4-maker",
    "helcyon-4o-v45-maker",
    "4o-nov-check"
  ],
  "left_out": {
    "helcyon-g4-maker": [
      "s11"
    ]
  }
};
