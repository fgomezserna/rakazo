import { Trans, useLingui } from "@lingui/react/macro";
import { type Bot, GROUP_MEMBER_MAX, GROUP_MEMBER_MIN, type Group } from "@rakazo/contracts";
import { BotAvatar, Button, Input } from "@rakazo/ui-web";
import { Check, Plus, Trash2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

function validSelection(name: string, selected: readonly string[]) {
  return (
    Boolean(name.trim()) &&
    selected.length >= GROUP_MEMBER_MIN &&
    selected.length <= GROUP_MEMBER_MAX
  );
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

export type SharedBotOption = {
  id: string;
  name: string;
  color: string;
  status?: string;
  spaceName: string;
};

function MemberPicker({
  bots,
  selected,
  onChange,
  maxHeight,
}: {
  bots: Bot[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxHeight: "max-h-[240px]" | "max-h-[280px]";
}) {
  const selectable = useMemo(() => bots.filter((bot) => !bot.archivedAt), [bots]);

  function toggle(botId: string) {
    if (selected.includes(botId)) {
      onChange(selected.filter((id) => id !== botId));
    } else if (selected.length < GROUP_MEMBER_MAX) {
      onChange([...selected, botId]);
    }
  }

  return (
    <div className={`mt-2 ${maxHeight} space-y-1 overflow-y-auto`}>
      {selectable.map((bot) => {
        const checked = selected.includes(bot.id);
        return (
          <button
            key={bot.id}
            type="button"
            aria-pressed={checked}
            onClick={() => toggle(bot.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start ${
              checked ? "bg-muted" : "hover:bg-accent"
            }`}
          >
            <BotAvatar color={bot.color} identity={bot.id} size={32} status={bot.status} />
            <span className="flex-1 text-[15px] text-foreground" dir="auto">
              {bot.name}
            </span>
            {checked ? <Check size={14} className="text-muted-foreground" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function CreateGroupForm({
  bots,
  onCancel,
  onCreate,
}: {
  bots: Bot[];
  onCancel: () => void;
  onCreate: (input: { name: string; botIds: string[] }) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (submitting || !validSelection(name, selected)) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), botIds: selected });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not create group`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] text-muted-foreground">
          <Trans>New group</Trans>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Cancel new group`}
          onClick={onCancel}
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="block text-sm text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t`Name this group`}
          className="mt-2"
        />
      </label>
      <div className="mt-5 text-sm text-muted-foreground">
        <Trans>
          Members (pick {GROUP_MEMBER_MIN}–{GROUP_MEMBER_MAX})
        </Trans>
      </div>
      <MemberPicker
        bots={bots}
        selected={selected}
        onChange={setSelected}
        maxHeight="max-h-[280px]"
      />
      <Button
        className="mt-5 w-full"
        disabled={submitting || !validSelection(name, selected)}
        onClick={() => void create()}
      >
        {submitting ? <Trans>Creating…</Trans> : <Trans>Create group</Trans>}
      </Button>
    </div>
  );
}

export function GroupSettings({
  group,
  bots,
  sharedBots,
  onSave,
  onAddGuest,
  onRemoveGuest,
  onSetGuestMode,
  onRemove,
}: {
  group: Group;
  bots: Bot[];
  sharedBots: SharedBotOption[];
  onSave: (input: { name?: string; botIds?: string[] }) => Promise<void>;
  onAddGuest: (botId: string, mentionOnly: boolean) => Promise<void>;
  onRemoveGuest: (botId: string) => Promise<void>;
  onSetGuestMode: (botId: string, mentionOnly: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState(group.name);
  const localMembers = group.members.filter((member) => !member.shared);
  const guestMembers = group.members.filter((member) => member.shared);
  const [selected, setSelected] = useState(localMembers.map((member) => member.botId));
  const [guestMentionOnly, setGuestMentionOnly] = useState(true);
  const [pending, setPending] = useState<"save" | "remove" | `guest:${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(kind: "save" | "remove" | `guest:${string}`, action: () => Promise<void>) {
    if (pending) return;
    setPending(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : kind === "save"
            ? t`Could not save group`
            : kind === "remove"
              ? t`Could not remove group`
              : t`Could not update shared bot`,
      );
    } finally {
      setPending(null);
    }
  }

  function save() {
    return onSave({
      name: name.trim() !== group.name ? name.trim() : undefined,
      botIds: sameMembers(
        selected,
        localMembers.map((member) => member.botId),
      )
        ? undefined
        : selected,
    });
  }

  const guestIds = new Set(guestMembers.map((member) => member.botId));
  const localIds = new Set(localMembers.map((member) => member.botId));
  const availableSharedBots = sharedBots.filter(
    (bot) => !guestIds.has(bot.id) && !localIds.has(bot.id),
  );

  function guestAction(key: string, action: () => Promise<void>) {
    return mutate(`guest:${key}`, action);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] text-muted-foreground">
          <Trans>Group settings</Trans>
        </span>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="block text-sm text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2"
        />
      </label>
      <div className="mt-5 text-sm text-muted-foreground">
        <Trans>
          Members ({GROUP_MEMBER_MIN}–{GROUP_MEMBER_MAX})
        </Trans>
      </div>
      <MemberPicker
        bots={bots}
        selected={selected}
        onChange={setSelected}
        maxHeight="max-h-[240px]"
      />
      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="text-sm text-muted-foreground">
          <Trans>Shared bots</Trans>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/80">
          <Trans>
            Invite a bot from another workspace. It keeps its own memory and credentials.
          </Trans>
        </p>
        {guestMembers.length > 0 ? (
          <div className="mt-3 space-y-2">
            {guestMembers.map((member) => (
              <div
                key={member.botId}
                className="flex items-center gap-2 rounded-xl bg-muted/50 px-2.5 py-2"
              >
                <BotAvatar
                  color={member.color}
                  identity={member.botId}
                  size={30}
                  status={member.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{member.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {member.spaceName ?? t`Another workspace`}
                  </div>
                </div>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={member.mentionOnly !== false}
                    disabled={pending !== null}
                    onChange={(event) =>
                      void guestAction(member.botId, () =>
                        onSetGuestMode(member.botId, event.target.checked),
                      )
                    }
                  />
                  <Trans>Mention only</Trans>
                </label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Remove shared bot`}
                  disabled={pending !== null}
                  onClick={() => void guestAction(member.botId, () => onRemoveGuest(member.botId))}
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {availableSharedBots.length > 0 ? (
          <div className="mt-3 space-y-1">
            {availableSharedBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-accent"
                disabled={pending !== null}
                onClick={() => void guestAction(bot.id, () => onAddGuest(bot.id, guestMentionOnly))}
              >
                <BotAvatar color={bot.color} identity={bot.id} size={30} status={bot.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{bot.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {bot.spaceName}
                  </span>
                </span>
                <Plus size={15} className="text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        ) : null}
        {availableSharedBots.length > 0 ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={guestMentionOnly}
              disabled={pending !== null}
              onChange={(event) => setGuestMentionOnly(event.target.checked)}
            />
            <Trans>Only run when mentioned in the group</Trans>
          </label>
        ) : null}
      </div>
      <Button
        className="mt-5 w-full"
        disabled={pending !== null || !validSelection(name, selected)}
        onClick={() => void mutate("save", save)}
      >
        {pending === "save" ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
      </Button>
      <Button
        variant="destructive"
        className="mt-4 w-full"
        disabled={pending !== null}
        onClick={() => void mutate("remove", onRemove)}
      >
        {pending === "remove" ? <Trans>Deleting…</Trans> : <Trans>Delete group</Trans>}
      </Button>
    </div>
  );
}

export function memberName(
  members: Group["members"] | undefined,
  botId: string | undefined,
): string | undefined {
  if (!botId || !members) return undefined;
  return members.find((member) => member.botId === botId)?.name;
}
