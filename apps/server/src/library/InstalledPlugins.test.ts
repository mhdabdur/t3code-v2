import { describe, expect, it } from "vite-plus/test";

import {
  parseAvailablePlugins,
  parseCodexPluginTables,
  searchAvailablePlugins,
} from "./InstalledPlugins.ts";

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

describe("marketplace listing", () => {
  // The shapes `claude plugin list` and `codex plugin list` print with --json --available.
  const listing = JSON.stringify({
    installed: [
      { id: "caveman@caveman", version: "0d95a81", enabled: true },
      { pluginId: "feedback@personal", name: "feedback", marketplaceName: "personal" },
    ],
    available: [
      {
        pluginId: "caveman@caveman",
        name: "caveman",
        marketplaceName: "caveman",
        description: "Terse replies",
        installCount: 12,
      },
      {
        pluginId: "audit@official",
        name: "audit",
        marketplaceName: "official",
        description: "Security audit for API specs",
        installCount: 3448,
      },
      { pluginId: "chrome@bundled", name: "chrome", marketplaceName: "bundled", installed: false },
    ],
  });

  it("merges installed plugins into what the marketplaces offer", () => {
    const plugins = parseAvailablePlugins(listing);

    expect(plugins.find((plugin) => plugin.id === "caveman@caveman")).toEqual({
      id: "caveman@caveman",
      name: "caveman",
      marketplace: "caveman",
      description: "Terse replies",
      installCount: 12,
      installed: true,
    });
    expect(plugins.find((plugin) => plugin.id === "feedback@personal")?.installed).toBe(true);
    expect(plugins.find((plugin) => plugin.id === "chrome@bundled")?.installed).toBe(false);
    expect(parseAvailablePlugins("not json")).toEqual([]);
  });

  it("searches name, marketplace and description, most installed first", () => {
    const plugins = parseAvailablePlugins(listing);

    expect(searchAvailablePlugins(plugins, "").plugins.map((plugin) => plugin.name)).toEqual([
      "audit",
      "caveman",
      "chrome",
      "feedback",
    ]);
    expect(
      searchAvailablePlugins(plugins, " SECURITY ").plugins.map((plugin) => plugin.id),
    ).toEqual(["audit@official"]);
    expect(searchAvailablePlugins(plugins, "bundled")).toMatchObject({
      total: 1,
      marketplaces: ["bundled", "caveman", "official", "personal"],
    });
  });
});
