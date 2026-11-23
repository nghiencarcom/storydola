export type CodingAgentId = "codex" | "claude" | "antigravity";
export type CodingAgentEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type CodingAgentSpeed = "standard" | "fast";
export type CodingAgentModelOption = {
  id: string;
  label: string;
  reasoningEffortLevels?: CodingAgentEffort[];
  defaultReasoningEffort?: CodingAgentEffort;
  speedTiers?: Exclude<CodingAgentSpeed, "standard">[];
};

export const codingAgentModelPresets: Record<CodingAgentId, CodingAgentModelOption[]> = {
  codex: [],
  claude: [
    { id: "sonnet", label: "Sonnet · cân bằng", reasoningEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { id: "opus", label: "Opus · chất lượng cao", reasoningEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { id: "haiku", label: "Haiku · nhanh", reasoningEffortLevels: ["low", "medium", "high"] },
  ],
  antigravity: [],
};
