import { useAtomValue } from "@effect/atom-react";
import type { InstalledPluginGroup, ServerProvider } from "@t3tools/contracts";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerConfigAtom, serverEnvironment } from "../../state/server";
import { Badge } from "../ui/badge";
import { LibraryPageShell } from "./LibraryPageShell";
import { providerInstanceLabel } from "./PublishFilePage";

export function PluginsPage() {
  const environmentId = usePrimaryEnvironmentId();
  const result = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.installedPlugins({ environmentId, input: {} }),
  );
  const providers = useAtomValue(primaryServerConfigAtom)?.providers ?? [];
  const groups = result.data?.groups;

  return (
    <LibraryPageShell title="Plugins">
      <p className="text-muted-foreground text-sm">
        Plugins each Claude and Codex account has installed in its config folder on this device.
        Plugins an account gets online from claude.ai or ChatGPT are not listed.
      </p>
      {environmentId === null ? (
        <p className="text-muted-foreground text-sm">Connect an environment to see plugins.</p>
      ) : result.error ? (
        <p className="text-muted-foreground text-sm">{result.error}</p>
      ) : groups === undefined ? (
        <p className="text-muted-foreground text-sm">Loading plugins…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No Claude or Codex account is set up.</p>
      ) : (
        groups.map((group) => (
          <PluginGroup key={group.instanceId} providers={providers} group={group} />
        ))
      )}
    </LibraryPageShell>
  );
}

function PluginGroup(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly group: InstalledPluginGroup;
}) {
  const { group } = props;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex min-w-0 items-baseline gap-2 font-medium text-sm">
        {providerInstanceLabel(props.providers, group.instanceId)}
        <span className="text-muted-foreground">{group.plugins.length}</span>
        <span className="truncate font-normal text-muted-foreground text-xs">
          {group.configDir}
        </span>
      </h2>
      {group.plugins.length === 0 ? (
        <p className="text-muted-foreground text-xs">No plugins installed.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {group.plugins.map((plugin) => (
            <li key={plugin.id} className="flex min-w-0 items-start gap-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-sm">
                  {plugin.name}
                  {plugin.version ? (
                    <span className="ms-2 font-normal text-muted-foreground text-xs">
                      {plugin.version}
                    </span>
                  ) : null}
                </span>
                {plugin.description ? (
                  <span className="line-clamp-2 text-muted-foreground text-xs">
                    {plugin.description}
                  </span>
                ) : null}
              </span>
              {plugin.marketplace ? <Badge variant="outline">{plugin.marketplace}</Badge> : null}
              {plugin.enabled ? null : <Badge variant="outline">Off</Badge>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
