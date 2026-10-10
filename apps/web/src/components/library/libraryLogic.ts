import {
  LIBRARY_SHARED_ROUTE_PREFIX,
  type AdvertisedEndpoint,
  type LibraryArtifact,
} from "@t3tools/contracts";

const REACHABILITY_RANK: Record<AdvertisedEndpoint["reachability"], number> = {
  public: 0,
  "private-network": 1,
  lan: 2,
  loopback: 3,
};

function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}

/**
 * The link to hand out for a shared artifact. The desktop app reaches its own
 * server over loopback, which nobody else can open, so an address the server
 * advertises to other devices wins over the one this client connects through.
 * `localOnly` says the link still only opens on this machine.
 */
export function resolveShareLink(input: {
  readonly shareToken: string;
  readonly httpBaseUrl: string | null;
  readonly advertisedEndpoints: ReadonlyArray<AdvertisedEndpoint>;
}): { readonly url: string; readonly localOnly: boolean } | null {
  const advertised = input.advertisedEndpoints
    .filter((endpoint) => endpoint.status !== "unavailable" && endpoint.reachability !== "loopback")
    .toSorted((a, b) => REACHABILITY_RANK[a.reachability] - REACHABILITY_RANK[b.reachability])[0];
  const base = advertised?.httpBaseUrl ?? input.httpBaseUrl;
  if (base === null) return null;
  try {
    const url = new URL(`${LIBRARY_SHARED_ROUTE_PREFIX}/${input.shareToken}`, base).toString();
    return { url, localOnly: isLoopbackUrl(url) };
  } catch {
    return null;
  }
}

export type ArtifactVisibilityFilter = "all" | "private" | "public";

export interface ArtifactGroup {
  readonly label: string;
  readonly artifacts: ReadonlyArray<LibraryArtifact>;
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function dateGroupLabel(updatedAt: string, now: Date): string {
  const date = new Date(updatedAt);
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.toLocaleDateString(
    undefined,
    date.getFullYear() === now.getFullYear()
      ? { month: "long" }
      : { month: "long", year: "numeric" },
  );
}

/**
 * Pinned artifacts first, then the rest by when they last changed: today,
 * yesterday, each day of the past week, then by month. Expects newest first.
 */
export function groupArtifacts(
  artifacts: ReadonlyArray<LibraryArtifact>,
  now: Date,
): ReadonlyArray<ArtifactGroup> {
  const groups: Array<{ label: string; artifacts: Array<LibraryArtifact> }> = [];
  const pinned = artifacts.filter((artifact) => artifact.pinned);
  if (pinned.length > 0) groups.push({ label: "Pinned", artifacts: pinned });
  for (const artifact of artifacts) {
    if (artifact.pinned) continue;
    const label = dateGroupLabel(artifact.updatedAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.artifacts.push(artifact);
    else groups.push({ label, artifacts: [artifact] });
  }
  return groups;
}

export function filterArtifacts(
  artifacts: ReadonlyArray<LibraryArtifact>,
  query: string,
  visibility: ArtifactVisibilityFilter,
): ReadonlyArray<LibraryArtifact> {
  const needle = query.trim().toLowerCase();
  return artifacts.filter(
    (artifact) =>
      (visibility === "all" || (visibility === "public") === (artifact.shareToken !== null)) &&
      (needle.length === 0 ||
        artifact.title.toLowerCase().includes(needle) ||
        (artifact.threadTitle ?? "").toLowerCase().includes(needle)),
  );
}

/** Whether a skill sits in the account's own skills folder, where it can be removed. */
export function isSkillInFolder(skillPath: string, configDir: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalize(skillPath).startsWith(`${normalize(configDir)}/skills/`);
}
