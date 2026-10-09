import { describe, expect, it } from "vite-plus/test";

import { parseCodexPluginTables } from "./InstalledPlugins.ts";

describe("parseCodexPluginTables", () => {
  it("reads each plugin table and its enabled flag", () => {
    const toml = [
      "[features]",
      "enabled = false",
      "[plugins]",
      "[plugins.'browser@openai-bundled']",
      "enabled = true",
      "",
      '[plugins."figma@openai-curated"]',
      "enabled = false",
      "[plugins.'pdf@openai-primary-runtime']",
      "[mcp_servers.docs]",
      "enabled = false",
    ].join("\n");

    expect(parseCodexPluginTables(toml)).toEqual([
      { id: "browser@openai-bundled", enabled: true },
      { id: "figma@openai-curated", enabled: false },
      { id: "pdf@openai-primary-runtime", enabled: true },
    ]);
  });
});
