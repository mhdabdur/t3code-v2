import type { AdvertisedEndpoint, LibraryArtifact } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { filterArtifacts, groupArtifacts, isSkillInFolder, resolveShareLink } from "./libraryLogic";

const endpoint = (
  reachability: AdvertisedEndpoint["reachability"],
  httpBaseUrl: string,
  status: AdvertisedEndpoint["status"] = "available",
) =>
  ({
    id: `${reachability}:${httpBaseUrl}`,
    label: reachability,
    provider: { id: "core", label: "Core", kind: "core", isAddon: false },
    httpBaseUrl,
    wsBaseUrl: httpBaseUrl.replace("http", "ws"),
    reachability,
    compatibility: { hostedHttpsApp: "unknown", desktopApp: "compatible" },
    source: "desktop-core",
    status,
  }) as AdvertisedEndpoint;

const artifact = (id: string, updatedAt: string, extra: Partial<LibraryArtifact> = {}) =>
  ({
    id,
    title: id,
    threadTitle: null,
    updatedAt,
    pinned: false,
    shareToken: null,
    versions: [],
    ...extra,
  }) as unknown as LibraryArtifact;

describe("resolveShareLink", () => {
  it("prefers the address other devices can reach over the loopback one", () => {
    expect(
      resolveShareLink({
        shareToken: "tok",
        httpBaseUrl: "http://127.0.0.1:3773",
        advertisedEndpoints: [
          endpoint("loopback", "http://127.0.0.1:3773"),
          endpoint("lan", "http://192.168.1.20:3773"),
          endpoint("private-network", "https://mac.tailnet.ts.net"),
          endpoint("public", "https://down.example.com", "unavailable"),
        ],
      }),
    ).toEqual({ url: "https://mac.tailnet.ts.net/api/shared/tok", localOnly: false });
  });

  it("flags a link that only this machine can open", () => {
    expect(
      resolveShareLink({
        shareToken: "tok",
        httpBaseUrl: "http://localhost:3773",
        advertisedEndpoints: [endpoint("loopback", "http://127.0.0.1:3773")],
      }),
    ).toEqual({ url: "http://localhost:3773/api/shared/tok", localOnly: true });
  });

  it("uses the address a remote client connects through", () => {
    expect(
      resolveShareLink({
        shareToken: "tok",
        httpBaseUrl: "https://t3.example.com",
        advertisedEndpoints: [],
      }),
    ).toEqual({ url: "https://t3.example.com/api/shared/tok", localOnly: false });
    expect(
      resolveShareLink({ shareToken: "tok", httpBaseUrl: null, advertisedEndpoints: [] }),
    ).toBeNull();
  });
});

describe("groupArtifacts", () => {
  it("lists pinned artifacts first, then by day and month", () => {
    const now = new Date(2026, 9, 10, 15);
    const at = (year: number, month: number, day: number) =>
      new Date(year, month, day, 9).toISOString();
    const groups = groupArtifacts(
      [
        artifact("today", at(2026, 9, 10)),
        artifact("pinned-old", at(2026, 8, 1), { pinned: true }),
        artifact("yesterday", at(2026, 9, 9)),
        artifact("this-month", at(2026, 9, 1)),
        artifact("also-this-month", at(2026, 9, 1)),
        artifact("last-year", at(2025, 8, 17)),
      ],
      now,
    );

    expect(groups.map((group) => group.artifacts.map((entry) => entry.id))).toEqual([
      ["pinned-old"],
      ["today"],
      ["yesterday"],
      ["this-month", "also-this-month"],
      ["last-year"],
    ]);
    expect(groups.slice(0, 3).map((group) => group.label)).toEqual([
      "Pinned",
      "Today",
      "Yesterday",
    ]);
    // A month in another year carries the year, so it cannot be read as this one.
    expect(groups[4]?.label).toContain("2025");
    expect(groups[3]?.label).not.toContain("2026");
  });
});

describe("filterArtifacts", () => {
  it("narrows by sharing state and by title or thread", () => {
    const artifacts = [
      artifact("Sales chart", "2026-10-10T00:00:00.000Z", { shareToken: "tok" }),
      artifact("Draft", "2026-10-09T00:00:00.000Z", { threadTitle: "Sales review" }),
      artifact("Mockup", "2026-10-08T00:00:00.000Z"),
    ];

    expect(filterArtifacts(artifacts, "", "public").map((entry) => entry.id)).toEqual([
      "Sales chart",
    ]);
    expect(filterArtifacts(artifacts, " sales ", "all").map((entry) => entry.id)).toEqual([
      "Sales chart",
      "Draft",
    ]);
    expect(filterArtifacts(artifacts, "sales", "private").map((entry) => entry.id)).toEqual([
      "Draft",
    ]);
  });
});

describe("isSkillInFolder", () => {
  it("accepts only paths under the account's skills folder", () => {
    expect(isSkillInFolder("/home/a/.claude/skills/notes/SKILL.md", "/home/a/.claude")).toBe(true);
    expect(
      isSkillInFolder("C:\\Users\\a\\.codex\\skills\\x\\SKILL.md", "C:\\Users\\a\\.codex\\"),
    ).toBe(true);
    expect(
      isSkillInFolder("/home/a/.claude/plugins/cache/p/skills/x/SKILL.md", "/home/a/.claude"),
    ).toBe(false);
    expect(isSkillInFolder("/home/a/.claude-work/skills/x/SKILL.md", "/home/a/.claude")).toBe(
      false,
    );
  });
});
