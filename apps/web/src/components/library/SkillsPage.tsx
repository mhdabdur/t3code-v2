import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  InstalledPluginGroup,
  LibrarySkillSource,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderSkill,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerConfigAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { valueOrToast } from "./libraryActions";
import { isSkillInFolder } from "./libraryLogic";
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
  const environmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerConfigAtom)?.providers ?? [];
  // The Claude and Codex accounts, each with the config folder its own skills live in.
  const accounts = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.installedPlugins({ environmentId, input: {} }),
  ).data?.groups;
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
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
    <LibraryPageShell
      title="Skills"
      actions={
        environmentId !== null && accounts && accounts.length > 0 ? (
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add skill
          </Button>
        ) : null
      }
    >
      <p className="text-muted-foreground text-sm">
        Skills each account can use, read from its own config folder on this device and from the
        open project. Skills an account gets from its online plugins are not listed yet. Only skills
        in a Claude or Codex account&apos;s own skills folder can be removed here.
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
          <SkillGroup
            key={group.provider.instanceId}
            environmentId={environmentId}
            providers={providers}
            account={accounts?.find((entry) => entry.instanceId === group.provider.instanceId)}
            {...group}
          />
        ))
      )}
      {adding && environmentId !== null && accounts ? (
        <AddSkillDialog
          environmentId={environmentId}
          providers={providers}
          accounts={accounts}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </LibraryPageShell>
  );
}

function SkillGroup(props: {
  readonly environmentId: EnvironmentId | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly provider: ServerProvider;
  readonly account: InstalledPluginGroup | undefined;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const { environmentId, account } = props;
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const removeSkill = useAtomCommand(serverEnvironment.removeSkill);
  const label = providerInstanceLabel(props.providers, props.provider.instanceId);

  const remove = async (skill: ServerProviderSkill) => {
    if (environmentId === null) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Remove the skill "${skill.displayName ?? skill.name}" from ${label}? Its folder is deleted.`,
    );
    if (!confirmed) return;
    setRemovingPath(skill.path);
    // The server re-reads this account's skills, and the list follows.
    valueOrToast(
      await removeSkill({
        environmentId,
        input: { instanceId: props.provider.instanceId, path: skill.path },
      }),
      `Could not remove ${skill.name}`,
    );
    setRemovingPath(null);
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">
        {label}
        <span className="ms-2 text-muted-foreground">{props.provider.skills.length}</span>
      </h2>
      {props.skills.length === 0 ? (
        <p className="text-muted-foreground text-xs">No skills match.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {props.skills.map((skill) => (
            <li key={skill.path} className="flex min-w-0 items-center gap-3 py-2">
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
              {account && isSkillInFolder(skill.path, account.configDir) ? (
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Remove ${skill.name}`}
                  disabled={removingPath !== null}
                  onClick={() => void remove(skill)}
                >
                  {removingPath === skill.path ? <Spinner /> : <Trash2Icon />}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type SkillSourceKind = LibrarySkillSource["kind"];

function AddSkillDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly accounts: ReadonlyArray<InstalledPluginGroup>;
  readonly onClose: () => void;
}) {
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(
    props.accounts[0]?.instanceId ?? null,
  );
  const [kind, setKind] = useState<SkillSourceKind>("git");
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const addSkill = useAtomCommand(serverEnvironment.addSkill);
  const account = props.accounts.find((entry) => entry.instanceId === instanceId);
  const labelFor = (id: ProviderInstanceId) => providerInstanceLabel(props.providers, id);

  const source: LibrarySkillSource | null =
    kind === "git"
      ? url.trim().length > 0
        ? { kind, url: url.trim() }
        : null
      : kind === "folder"
        ? folder.trim().length > 0
          ? { kind, path: folder.trim() }
          : null
        : name.trim().length > 0 && description.trim().length > 0
          ? { kind, name: name.trim(), description: description.trim(), body }
          : null;

  const submit = async () => {
    if (instanceId === null || source === null) return;
    setPending(true);
    const result = valueOrToast(
      await addSkill({ environmentId: props.environmentId, input: { instanceId, source } }),
      "Could not add the skill",
    );
    setPending(false);
    if (result === null) return;
    const skipped =
      result.skipped.length > 0 ? `Already there, left alone: ${result.skipped.join(", ")}.` : "";
    toastManager.add(
      result.added.length > 0
        ? {
            type: "success",
            title: `Added ${result.added.join(", ")}`,
            description: [skipped, "Threads you start afterwards can use it."]
              .filter(Boolean)
              .join(" "),
          }
        : { type: "warning", title: "Nothing was added", description: skipped },
    );
    if (result.added.length > 0) props.onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a skill</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <span className="font-medium text-xs">Account</span>
              <Select
                value={instanceId}
                onValueChange={(value) => {
                  const next = props.accounts.find((entry) => entry.instanceId === value);
                  if (next) setInstanceId(next.instanceId);
                }}
              >
                <SelectTrigger className="w-full" aria-label="Account">
                  <SelectValue>
                    {instanceId ? labelFor(instanceId) : "Choose an account"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {props.accounts.map((entry) => (
                    <SelectItem key={entry.instanceId} hideIndicator value={entry.instanceId}>
                      {labelFor(entry.instanceId)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {account ? (
                <p className="truncate text-muted-foreground text-xs">
                  Saved in {account.configDir}/skills
                </p>
              ) : null}
            </div>
            <ToggleGroup
              aria-label="Where the skill comes from"
              variant="segmented"
              value={[kind]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "git" || value === "folder" || value === "text") setKind(value);
              }}
            >
              <Toggle value="git">Git repository</Toggle>
              <Toggle value="folder">Folder</Toggle>
              <Toggle value="text">Write it here</Toggle>
            </ToggleGroup>
            {kind === "git" ? (
              <div className="grid gap-1.5">
                <Input
                  aria-label="Repository"
                  placeholder="owner/repo or a git URL"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Every folder in the repository that holds a SKILL.md is copied in.
                </p>
              </div>
            ) : kind === "folder" ? (
              <div className="grid gap-1.5">
                <div className="flex gap-2">
                  <Input
                    aria-label="Folder"
                    placeholder="/path/to/skill"
                    value={folder}
                    onChange={(event) => setFolder(event.target.value)}
                  />
                  {typeof window !== "undefined" && window.desktopBridge ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void ensureLocalApi()
                          .dialogs.pickFolder()
                          .then((picked) => (picked ? setFolder(picked) : undefined))
                      }
                    >
                      Browse
                    </Button>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  A folder on the machine running T3 Code that holds a SKILL.md, or a folder of such
                  folders.
                </p>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Input
                  aria-label="Skill name"
                  placeholder="Name, such as release-notes"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  aria-label="Skill description"
                  placeholder="When the agent should use this skill"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <Textarea
                  aria-label="Skill instructions"
                  placeholder="Instructions the agent follows when it uses the skill"
                  rows={8}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={instanceId === null || source === null || pending}
            onClick={() => void submit()}
          >
            {pending ? <Spinner /> : null}
            Add skill
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
