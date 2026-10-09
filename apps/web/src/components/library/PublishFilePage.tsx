import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  LibraryArtifact,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, FileCodeIcon, MessageSquareIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { ensureLocalApi } from "../../localApi";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerConfigAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { getDriverOption } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { LibraryPageShell } from "./LibraryPageShell";

type PublishTab = "artifacts" | "sites";

/** "Claude · Work", or the bare instance id once that account is gone. */
export function providerInstanceLabel(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId | null,
): string | null {
  if (instanceId === null) return null;
  const provider = providers.find((entry) => entry.instanceId === instanceId);
  if (!provider) return String(instanceId);
  const driver = getDriverOption(provider.driver)?.label ?? String(provider.driver);
  const name = provider.displayName?.trim();
  return name && name.toLowerCase() !== driver.toLowerCase() ? `${driver} · ${name}` : driver;
}

export function PublishFilePage() {
  const [tab, setTab] = useState<PublishTab>("artifacts");
  return (
    <LibraryPageShell
      title="Publish File"
      actions={
        <ToggleGroup
          aria-label="Publish File section"
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            if (next[0] === "artifacts" || next[0] === "sites") setTab(next[0]);
          }}
        >
          <Toggle value="artifacts">Artifacts</Toggle>
          <Toggle value="sites">Sites</Toggle>
        </ToggleGroup>
      }
    >
      {tab === "artifacts" ? (
        <ArtifactsSection />
      ) : (
        <p className="text-muted-foreground text-sm">
          Sites are not available yet. Pages an agent publishes appear under Artifacts.
        </p>
      )}
    </LibraryPageShell>
  );
}

function ArtifactsSection() {
  const environmentId = usePrimaryEnvironmentId();
  const result = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.libraryArtifacts({ environmentId, input: {} }),
  );
  const providers = useAtomValue(primaryServerConfigAtom)?.providers ?? [];
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const artifacts = result.data?.artifacts;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (artifacts ?? []).filter(
      (artifact) =>
        needle.length === 0 ||
        artifact.title.toLowerCase().includes(needle) ||
        (artifact.threadTitle ?? "").toLowerCase().includes(needle),
    );
  }, [artifacts, query]);
  const open = artifacts?.find((artifact) => artifact.id === openId) ?? null;

  if (environmentId === null) {
    return (
      <p className="text-muted-foreground text-sm">Connect an environment to see artifacts.</p>
    );
  }
  if (result.error) {
    return <p className="text-muted-foreground text-sm">{result.error}</p>;
  }
  if (artifacts === undefined) {
    return <p className="text-muted-foreground text-sm">Loading artifacts…</p>;
  }
  if (artifacts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No artifacts yet. Ask an agent for a page, such as a chart, a mockup, or a dashboard, and it
        is saved here, with every revision kept.
      </p>
    );
  }
  return (
    <>
      <Input
        type="search"
        placeholder="Search artifacts"
        aria-label="Search artifacts"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-sm"
      />
      <ul className="flex flex-col divide-y divide-border/60">
        {visible.map((artifact) => {
          const project = projects.find((entry) => entry.id === artifact.projectId);
          const details = [
            `v${artifact.versions.at(-1)?.version ?? 1}`,
            formatRelativeTimeLabel(artifact.updatedAt),
            project?.title ?? null,
            providerInstanceLabel(providers, artifact.providerInstanceId),
          ].filter(Boolean);
          return (
            <li key={artifact.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-accent/50"
                onClick={() => setOpenId(artifact.id)}
              >
                <FileCodeIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-sm">{artifact.title}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {details.join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="py-3 text-muted-foreground text-sm">No artifacts match "{query}".</li>
        ) : null}
      </ul>
      {open ? (
        <ArtifactViewer
          environmentId={environmentId}
          artifact={open}
          onClose={() => setOpenId(null)}
          onDeleted={() => {
            setOpenId(null);
            result.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ArtifactViewer(props: {
  readonly environmentId: EnvironmentId;
  readonly artifact: LibraryArtifact;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const { artifact } = props;
  const navigate = useNavigate();
  const deleteArtifact = useAtomCommand(serverEnvironment.deleteLibraryArtifact);
  const latest = artifact.versions.at(-1)?.version ?? 1;
  const [selected, setSelected] = useState(latest);
  const version =
    artifact.versions.find((entry) => entry.version === selected) ?? artifact.versions.at(-1);
  const resource = useMemo(
    () =>
      version
        ? {
            _tag: "attachment" as const,
            attachmentId: version.attachmentId,
            fileName: htmlRenderFileName(version.title),
            mimeType: "text/html",
            disposition: "inline" as const,
          }
        : null,
    [version],
  );
  const asset = useAssetUrlState(props.environmentId, resource);
  const src = asset._tag === "Success" ? asset.url : null;
  const threadId = artifact.threadId;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogPopup className="h-[85vh] max-w-5xl">
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate">
              <DialogTitle>{version?.title ?? artifact.title}</DialogTitle>
            </div>
            {artifact.versions.length > 1 ? (
              <ToggleGroup
                aria-label="Version"
                variant="segmented"
                value={[String(selected)]}
                onValueChange={(next) => {
                  const value = Number(next[0]);
                  if (Number.isInteger(value)) setSelected(value);
                }}
              >
                {artifact.versions.map((entry) => (
                  <Toggle key={entry.version} value={String(entry.version)}>
                    v{entry.version}
                  </Toggle>
                ))}
              </ToggleGroup>
            ) : null}
            {threadId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
                  })
                }
              >
                <MessageSquareIcon aria-hidden />
                Thread
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={src === null}
              onClick={() => (src ? void ensureLocalApi().shell.openExternal(src) : undefined)}
            >
              <ExternalLinkIcon aria-hidden />
              Browser
            </Button>
            <Button
              size="sm"
              variant="destructive-outline"
              onClick={() =>
                void deleteArtifact({
                  environmentId: props.environmentId,
                  input: { artifactId: artifact.id },
                }).then(props.onDeleted)
              }
            >
              <Trash2Icon aria-hidden />
              Delete
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60">
            {src && version ? (
              // Keyed so a different version loads its own page; the frame keeps its first URL.
              <HtmlRenderDocument
                key={version.attachmentId}
                src={src}
                title={version.title}
                className="block size-full"
              />
            ) : asset._tag === "Failure" ? (
              <p className="p-4 text-muted-foreground text-sm">Unable to load this version.</p>
            ) : null}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
