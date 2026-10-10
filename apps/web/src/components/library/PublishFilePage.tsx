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
import {
  CloudUploadIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

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
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { useShareArtifact, valueOrToast } from "./libraryActions";
import { filterArtifacts, groupArtifacts, type ArtifactVisibilityFilter } from "./libraryLogic";
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
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<ArtifactVisibilityFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const artifacts = result.data?.artifacts;
  const groups = useMemo(
    () => groupArtifacts(filterArtifacts(artifacts ?? [], query, visibility), new Date()),
    [artifacts, query, visibility],
  );
  const open = artifacts?.find((artifact) => artifact.id === openId) ?? null;
  const renaming = artifacts?.find((artifact) => artifact.id === renameId) ?? null;

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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search artifacts"
          aria-label="Search artifacts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <ToggleGroup
          aria-label="Show artifacts"
          variant="segmented"
          value={[visibility]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "all" || value === "private" || value === "public") setVisibility(value);
          }}
        >
          <Toggle value="all">All</Toggle>
          <Toggle value="private">Private</Toggle>
          <Toggle value="public">Public</Toggle>
        </ToggleGroup>
      </div>
      {groups.length === 0 ? (
        <p className="py-3 text-muted-foreground text-sm">No artifacts match.</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-1">
            <h2 className="px-2 text-muted-foreground text-xs">{group.label}</h2>
            <ul className="flex flex-col">
              {group.artifacts.map((artifact) => (
                <ArtifactRow
                  key={artifact.id}
                  environmentId={environmentId}
                  artifact={artifact}
                  onOpen={() => setOpenId(artifact.id)}
                  onRename={() => setRenameId(artifact.id)}
                  onChanged={result.refresh}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {open ? (
        <ArtifactViewer
          environmentId={environmentId}
          artifact={open}
          onClose={() => setOpenId(null)}
          onChanged={result.refresh}
        />
      ) : null}
      {renaming ? (
        <RenameArtifactDialog
          environmentId={environmentId}
          artifact={renaming}
          onClose={() => setRenameId(null)}
          onRenamed={result.refresh}
        />
      ) : null}
    </>
  );
}

/** Asks first: deleting drops every version and breaks a link shared earlier. */
function useDeleteArtifact(environmentId: EnvironmentId) {
  const deleteArtifact = useAtomCommand(serverEnvironment.deleteLibraryArtifact);
  return async (artifact: LibraryArtifact): Promise<boolean> => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      artifact.publication
        ? `Delete "${artifact.title}" and all of its versions? Its page on claude.ai stays; choose Delete from claude.ai first to remove that too.`
        : `Delete "${artifact.title}" and all of its versions?`,
    );
    if (!confirmed) return false;
    const deleted = valueOrToast(
      await deleteArtifact({ environmentId, input: { artifactId: artifact.id } }),
      "Could not delete the artifact",
    );
    return deleted !== null;
  };
}

function ArtifactRow(props: {
  readonly environmentId: EnvironmentId;
  readonly artifact: LibraryArtifact;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onChanged: () => void;
}) {
  const { artifact, environmentId, onChanged } = props;
  const providers = useAtomValue(primaryServerConfigAtom)?.providers ?? [];
  const project = useProjects().find((entry) => entry.id === artifact.projectId);
  const updateArtifact = useAtomCommand(serverEnvironment.updateLibraryArtifact);
  const duplicateArtifact = useAtomCommand(serverEnvironment.duplicateLibraryArtifact);
  const publishArtifact = useAtomCommand(serverEnvironment.publishLibraryArtifact);
  const unpublishArtifact = useAtomCommand(serverEnvironment.unpublishLibraryArtifact);
  const shareArtifact = useShareArtifact(environmentId);
  const deleteArtifact = useDeleteArtifact(environmentId);
  const [publishing, setPublishing] = useState(false);
  const isPublic = artifact.shareToken !== null;
  const latestVersion = artifact.versions.at(-1)?.version ?? 1;
  const { publication } = artifact;
  // claude.ai hosts pages for the Claude account that made them, through its own CLI.
  const madeByClaude =
    providers.find((provider) => provider.instanceId === artifact.providerInstanceId)?.driver ===
    "claudeAgent";
  const details = [
    `v${latestVersion}`,
    project?.title ?? null,
    providerInstanceLabel(providers, artifact.providerInstanceId),
    publication
      ? publication.version < latestVersion
        ? `claude.ai shows v${publication.version}`
        : "On claude.ai"
      : null,
  ].filter(Boolean);

  const publish = async () => {
    setPublishing(true);
    const published = valueOrToast(
      await publishArtifact({ environmentId, input: { artifactId: artifact.id } }),
      "Could not publish to claude.ai",
    );
    setPublishing(false);
    if (published === null) return;
    toastManager.add({
      type: "success",
      title: "Published to claude.ai",
      description: "Only your Claude account can open it until you share it on claude.ai.",
    });
    onChanged();
  };

  const unpublish = async () => {
    // Claude Code asks for this confirmation before it deletes; here is where it is given.
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete "${artifact.title}" from claude.ai? Its link stops working for everyone. The artifact stays here.`,
    );
    if (!confirmed) return;
    setPublishing(true);
    const removed = valueOrToast(
      await unpublishArtifact({ environmentId, input: { artifactId: artifact.id } }),
      "Could not delete from claude.ai",
    );
    setPublishing(false);
    if (removed === null) return;
    toastManager.add({ type: "success", title: "Deleted from claude.ai" });
    onChanged();
  };

  const update = async (
    change: {
      readonly pinned?: boolean;
      readonly shared?: boolean;
      readonly publication?: null;
    },
    failureTitle: string,
  ) => {
    const updated = valueOrToast(
      await updateArtifact({ environmentId, input: { artifactId: artifact.id, ...change } }),
      failureTitle,
    );
    if (updated !== null) onChanged();
  };

  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md hover:bg-accent/50">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left"
        onClick={props.onOpen}
      >
        <FileCodeIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-sm">{artifact.title}</span>
          <span className="truncate text-muted-foreground text-xs">{details.join(" · ")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
          {publishing ? (
            <Spinner aria-label="Working with claude.ai" size="sm" />
          ) : isPublic ? (
            <GlobeIcon aria-label="Public" className="size-3.5" />
          ) : (
            <LockIcon aria-label="Private" className="size-3.5" />
          )}
          {formatRelativeTimeLabel(artifact.updatedAt)}
        </span>
      </button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label={`More actions for ${artifact.title}`}
            />
          }
        >
          <EllipsisVerticalIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            onClick={() =>
              void update({ pinned: !artifact.pinned }, "Could not update the artifact")
            }
          >
            {artifact.pinned ? <PinOffIcon /> : <PinIcon />}
            {artifact.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem onClick={props.onRename}>
            <PencilIcon />
            Rename
          </MenuItem>
          <MenuItem
            onClick={() =>
              void duplicateArtifact({ environmentId, input: { artifactId: artifact.id } }).then(
                (result) => {
                  if (valueOrToast(result, "Could not duplicate the artifact") !== null) {
                    onChanged();
                  }
                },
              )
            }
          >
            <CopyIcon />
            Duplicate
          </MenuItem>
          <MenuItem
            onClick={() =>
              void shareArtifact(artifact).then((changed) => (changed ? onChanged() : undefined))
            }
          >
            <LinkIcon />
            {isPublic ? "Copy link" : "Share link"}
          </MenuItem>
          {isPublic ? (
            <MenuItem
              onClick={() => void update({ shared: false }, "Could not stop sharing the artifact")}
            >
              <UnlinkIcon />
              Stop sharing
            </MenuItem>
          ) : null}
          {publication ? (
            <>
              <MenuSeparator />
              <MenuItem
                onClick={() =>
                  void writeTextToClipboard(publication.url)
                    .catch(() => false)
                    .then((copied) =>
                      toastManager.add(
                        copied
                          ? { type: "success", title: "claude.ai link copied" }
                          : { type: "error", title: "Could not copy the link" },
                      ),
                    )
                }
              >
                <LinkIcon />
                Copy claude.ai link
              </MenuItem>
              <MenuItem onClick={() => void ensureLocalApi().shell.openExternal(publication.url)}>
                <ExternalLinkIcon />
                Open on claude.ai
              </MenuItem>
              {publication.version < latestVersion ? (
                <MenuItem disabled={publishing} onClick={() => void publish()}>
                  <CloudUploadIcon />
                  Update on claude.ai
                </MenuItem>
              ) : null}
              <MenuItem
                onClick={() =>
                  void update({ publication: null }, "Could not unlink the artifact from claude.ai")
                }
              >
                <UnlinkIcon />
                Unlink from claude.ai
              </MenuItem>
              <MenuItem
                variant="destructive"
                disabled={publishing}
                onClick={() => void unpublish()}
              >
                <Trash2Icon />
                Delete from claude.ai
              </MenuItem>
            </>
          ) : madeByClaude ? (
            <>
              <MenuSeparator />
              <MenuItem disabled={publishing} onClick={() => void publish()}>
                <CloudUploadIcon />
                Publish to claude.ai
              </MenuItem>
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={() =>
              void deleteArtifact(artifact).then((deleted) => (deleted ? onChanged() : undefined))
            }
          >
            <Trash2Icon />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

function RenameArtifactDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly artifact: LibraryArtifact;
  readonly onClose: () => void;
  readonly onRenamed: () => void;
}) {
  const updateArtifact = useAtomCommand(serverEnvironment.updateLibraryArtifact);
  const [title, setTitle] = useState(props.artifact.title);
  const trimmed = title.trim();
  const submit = async () => {
    if (trimmed.length === 0) return;
    const updated = valueOrToast(
      await updateArtifact({
        environmentId: props.environmentId,
        input: { artifactId: props.artifact.id, title: trimmed },
      }),
      "Could not rename the artifact",
    );
    if (updated === null) return;
    props.onRenamed();
    props.onClose();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rename artifact</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Input
            aria-label="Artifact title"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={trimmed.length === 0} onClick={() => void submit()}>
            Rename
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ArtifactViewer(props: {
  readonly environmentId: EnvironmentId;
  readonly artifact: LibraryArtifact;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const { artifact } = props;
  const navigate = useNavigate();
  const deleteArtifact = useDeleteArtifact(props.environmentId);
  const shareArtifact = useShareArtifact(props.environmentId);
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
              variant="outline"
              onClick={() =>
                void shareArtifact(artifact).then((changed) =>
                  changed ? props.onChanged() : undefined,
                )
              }
            >
              <LinkIcon aria-hidden />
              {artifact.shareToken === null ? "Share link" : "Copy link"}
            </Button>
            <Button
              size="sm"
              variant="destructive-outline"
              onClick={() =>
                void deleteArtifact(artifact).then((deleted) => {
                  if (!deleted) return;
                  props.onClose();
                  props.onChanged();
                })
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
