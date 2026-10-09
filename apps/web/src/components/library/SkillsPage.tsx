import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider, ServerProviderSkill } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { primaryServerConfigAtom } from "../../state/server";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { LibraryPageShell } from "./LibraryPageShell";
import { providerInstanceLabel } from "./PublishFilePage";

/** Where a skill comes from, in the words the page uses. */
function scopeLabel(scope: string | undefined): string {
  switch (scope) {
    case "user":
      return "Device";
    case "project":
    case "repo":
      return "Project";
    case undefined:
      return "Other";
    default:
      return scope.charAt(0).toUpperCase() + scope.slice(1);
  }
}

function matches(skill: ServerProviderSkill, needle: string): boolean {
  return (
    needle.length === 0 ||
    skill.name.toLowerCase().includes(needle) ||
    (skill.displayName ?? "").toLowerCase().includes(needle) ||
    (skill.description ?? "").toLowerCase().includes(needle)
  );
}

export function SkillsPage() {
  const providers = useAtomValue(primaryServerConfigAtom)?.providers ?? [];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled && provider.skills.length > 0)
        .map((provider) => ({
          provider,
          skills: provider.skills
            .filter((skill) => matches(skill, needle))
            .toSorted((a, b) => a.name.localeCompare(b.name)),
        })),
    [needle, providers],
  );

  return (
    <LibraryPageShell title="Skills">
      <p className="text-muted-foreground text-sm">
        Skills each account can use, read from its own config folder on this device and from the
        open project. Skills an account gets from its online plugins are not listed yet.
      </p>
      <Input
        type="search"
        placeholder="Search skills"
        aria-label="Search skills"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-sm"
      />
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No account reports any skills.</p>
      ) : (
        groups.map((group) => (
          <SkillGroup key={group.provider.instanceId} providers={providers} {...group} />
        ))
      )}
    </LibraryPageShell>
  );
}

function SkillGroup(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly provider: ServerProvider;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">
        {providerInstanceLabel(props.providers, props.provider.instanceId)}
        <span className="ms-2 text-muted-foreground">{props.provider.skills.length}</span>
      </h2>
      {props.skills.length === 0 ? (
        <p className="text-muted-foreground text-xs">No skills match.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {props.skills.map((skill) => (
            <li key={skill.path} className="flex min-w-0 items-start gap-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-sm">
                  {skill.displayName ?? skill.name}
                </span>
                {skill.shortDescription || skill.description ? (
                  <span className="line-clamp-2 text-muted-foreground text-xs">
                    {skill.shortDescription ?? skill.description}
                  </span>
                ) : null}
              </span>
              <Badge variant="outline">{scopeLabel(skill.scope)}</Badge>
              {skill.enabled ? null : <Badge variant="outline">Off</Badge>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
