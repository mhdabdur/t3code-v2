import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  InstalledPlugin,
  InstalledPluginGroup,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerConfigAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { valueOrToast } from "./libraryActions";
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
        Plugins an account gets online from claude.ai or ChatGPT are not listed. A plugin you add or
        remove applies to threads you start afterwards.
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
          <PluginGroup
            key={group.instanceId}
            environmentId={environmentId}
            providers={providers}
            group={group}
            onChanged={result.refresh}
          />
        ))
      )}
    </LibraryPageShell>
  );
}

function PluginGroup(props: {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly group: InstalledPluginGroup;
  readonly onChanged: () => void;
}) {
  const { group } = props;
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const uninstallPlugin = useAtomCommand(serverEnvironment.uninstallPlugin);
  const label = providerInstanceLabel(props.providers, group.instanceId);

  const remove = async (plugin: InstalledPlugin) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Remove the plugin "${plugin.name}" from ${label}?`,
    );
    if (!confirmed) return;
    setRemovingId(plugin.id);
    const removed = valueOrToast(
      await uninstallPlugin({
        environmentId: props.environmentId,
        input: { instanceId: group.instanceId, pluginId: plugin.id },
      }),
      `Could not remove ${plugin.name}`,
    );
    setRemovingId(null);
    if (removed !== null) props.onChanged();
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-baseline gap-2 font-medium text-sm">
          {label}
          <span className="text-muted-foreground">{group.plugins.length}</span>
          <span className="truncate font-normal text-muted-foreground text-xs">
            {group.configDir}
          </span>
        </h2>
        <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          Add plugin
        </Button>
      </div>
      {group.plugins.length === 0 ? (
        <p className="text-muted-foreground text-xs">No plugins installed.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {group.plugins.map((plugin) => (
            <li key={plugin.id} className="flex min-w-0 items-center gap-3 py-2">
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
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Remove ${plugin.name}`}
                disabled={removingId !== null}
                onClick={() => void remove(plugin)}
              >
                {removingId === plugin.id ? <Spinner /> : <Trash2Icon />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddPluginDialog
          environmentId={props.environmentId}
          instanceId={group.instanceId}
          accountLabel={label}
          onClose={() => setAdding(false)}
          onChanged={props.onChanged}
        />
      ) : null}
    </section>
  );
}

function AddPluginDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly accountLabel: string | null;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const { environmentId, instanceId } = props;
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState("");
  // One CLI run at a time: both commands edit the same config folder.
  const [busy, setBusy] = useState<string | null>(null);
  const search = useDebouncedValue(query.trim(), 200);
  const available = useEnvironmentQuery(
    serverEnvironment.availablePlugins({ environmentId, input: { instanceId, query: search } }),
  );
  const installPlugin = useAtomCommand(serverEnvironment.installPlugin);
  const addMarketplace = useAtomCommand(serverEnvironment.addPluginMarketplace);
  const plugins = available.data?.plugins;
  const source = marketplace.trim();

  const install = async (pluginId: string, name: string) => {
    setBusy(pluginId);
    const installed = valueOrToast(
      await installPlugin({ environmentId, input: { instanceId, pluginId } }),
      `Could not install ${name}`,
    );
    setBusy(null);
    if (installed === null) return;
    available.refresh();
    props.onChanged();
  };

  const submitMarketplace = async () => {
    if (source.length === 0) return;
    setBusy("marketplace");
    const added = valueOrToast(
      await addMarketplace({ environmentId, input: { instanceId, source } }),
      "Could not add the marketplace",
    );
    setBusy(null);
    if (added === null) return;
    setMarketplace("");
    available.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a plugin to {props.accountLabel}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <Input
              type="search"
              autoFocus
              placeholder="Search this account's marketplaces"
              aria-label="Search plugins"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="h-80 overflow-y-auto rounded-md border border-border/60">
              {available.error ? (
                <p className="p-3 text-muted-foreground text-sm">{available.error}</p>
              ) : plugins === undefined ? (
                <p className="p-3 text-muted-foreground text-sm">Loading marketplaces…</p>
              ) : plugins.length === 0 ? (
                <p className="p-3 text-muted-foreground text-sm">No plugins match.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border/60">
                  {plugins.map((plugin) => (
                    <li key={plugin.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium text-sm">
                          {plugin.name}
                          {plugin.marketplace ? (
                            <span className="ms-2 font-normal text-muted-foreground text-xs">
                              {plugin.marketplace}
                            </span>
                          ) : null}
                        </span>
                        {plugin.description ? (
                          <span className="line-clamp-2 text-muted-foreground text-xs">
                            {plugin.description}
                          </span>
                        ) : null}
                      </span>
                      {plugin.installed ? (
                        <Badge variant="outline">Installed</Badge>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void install(plugin.id, plugin.name)}
                        >
                          {busy === plugin.id ? <Spinner /> : null}
                          Install
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {available.data && available.data.total > available.data.plugins.length ? (
              <p className="text-muted-foreground text-xs">
                Showing {available.data.plugins.length} of {available.data.total}. Search to narrow
                the list.
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-xs">Add a marketplace</span>
              <div className="flex gap-2">
                <Input
                  placeholder="owner/repo or a git URL"
                  aria-label="Marketplace source"
                  value={marketplace}
                  onChange={(event) => setMarketplace(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitMarketplace();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  disabled={source.length === 0 || busy !== null}
                  onClick={() => void submitMarketplace()}
                >
                  {busy === "marketplace" ? <Spinner /> : null}
                  Add
                </Button>
              </div>
              {available.data && available.data.marketplaces.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Marketplaces: {available.data.marketplaces.join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
