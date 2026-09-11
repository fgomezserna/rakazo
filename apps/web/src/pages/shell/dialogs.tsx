import { Trans, useLingui } from "@lingui/react/macro";
import {
  type Bot,
  isSpaceAvatarDataUrl,
  SPACE_AVATAR_MIME_TYPES,
  type Space,
} from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import { ImagePlus, Lock, Trash2, Upload, Users } from "lucide-react";
import { useId, useRef, useState } from "react";

/** Each dialog is mounted only while open, so `open` is always true and the
 * parent unmounts it from `onCancel`. Escape and backdrop presses are ignored
 * while a request is in flight. */
function closeUnlessBusy(busy: boolean, onCancel: () => void) {
  return (open: boolean) => {
    if (!open && !busy) onCancel();
  };
}

export function NewSpaceDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    void onConfirm(trimmed).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t`Could not create space`);
      setSaving(false);
    });
  };

  return (
    <Dialog open onOpenChange={closeUnlessBusy(saving, onCancel)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <Lock
              size={17}
              strokeWidth={1.8}
              className="text-muted-foreground"
              aria-hidden="true"
            />
            <Trans>New space</Trans>
          </DialogTitle>
        </DialogHeader>
        <label htmlFor={nameId} className="block text-[13.5px] text-foreground/75">
          <Trans>Name</Trans>
          <Input
            id={nameId}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
            placeholder={t`Customer support`}
            className="mt-2"
          />
        </label>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button disabled={saving || !name.trim()} onClick={create}>
            {saving ? <Trans>Creating…</Trans> : <Trans>Create space</Trans>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function fileToSpaceAvatar(file: File): Promise<string> {
  if (!(SPACE_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  }
  const maxEdge = 256;
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare that image.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const [format, quality] of [
        ["image/webp", 0.84],
        ["image/jpeg", 0.84],
      ] as const) {
        const dataUrl = canvas.toDataURL(format, quality);
        if (isSpaceAvatarDataUrl(dataUrl)) return dataUrl;
      }
    } finally {
      bitmap.close();
    }
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
  if (!isSpaceAvatarDataUrl(dataUrl)) {
    throw new Error("That image is too large. Choose an image under 512 KiB.");
  }
  return dataUrl;
}

export function SpaceSettingsDialog({
  space,
  onCancel,
  onConfirm,
}: {
  space: Pick<Space, "name" | "avatarUrl">;
  onCancel: () => void;
  onConfirm: (input: { name: string; avatarUrl: string | null }) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const fileId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(space.name);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(space.avatarUrl);
  const [readingAvatar, setReadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseAvatar = async (file: File | undefined) => {
    if (!file || readingAvatar || saving) return;
    setReadingAvatar(true);
    setError(null);
    try {
      setAvatarUrl(await fileToSpaceAvatar(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not read that image`);
    } finally {
      setReadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || saving || readingAvatar) return;
    setSaving(true);
    setError(null);
    void onConfirm({ name: trimmed, avatarUrl }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t`Could not update workspace`);
      setSaving(false);
    });
  };

  return (
    <Dialog open onOpenChange={closeUnlessBusy(saving || readingAvatar, onCancel)}>
      <DialogContent showCloseButton={false}>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <Lock
                size={17}
                strokeWidth={1.8}
                className="text-muted-foreground"
                aria-hidden="true"
              />
              <Trans>Configure workspace</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Choose the name and avatar your team will see in the sidebar.</Trans>
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={nameId} className="block text-[13.5px] text-foreground/75">
            <Trans>Name</Trans>
            <Input
              id={nameId}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2"
            />
          </label>
          <div className="space-y-2">
            <span className="block text-[13.5px] text-foreground/75">
              <Trans>Avatar</Trans>
            </span>
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
              <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="size-full object-cover" />
                ) : (
                  <ImagePlus size={20} strokeWidth={1.7} aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <input
                  ref={fileInputRef}
                  id={fileId}
                  type="file"
                  accept={SPACE_AVATAR_MIME_TYPES.join(",")}
                  className="sr-only"
                  onChange={(event) => void chooseAvatar(event.target.files?.[0])}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={readingAvatar || saving}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} aria-hidden="true" />
                    {readingAvatar ? <Trans>Reading…</Trans> : <Trans>Choose image</Trans>}
                  </Button>
                  {avatarUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={readingAvatar || saving}
                      onClick={() => setAvatarUrl(null)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <Trans>Remove</Trans>
                    </Button>
                  ) : null}
                </div>
                <p className="text-[12px] text-muted-foreground">
                  <Trans>
                    PNG, JPEG, WebP, or GIF. The image is resized to a small team avatar.
                  </Trans>
                </p>
              </div>
            </div>
          </div>
          {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving || readingAvatar}
              onClick={onCancel}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={saving || readingAvatar || !name.trim()}>
              {saving ? <Trans>Saving…</Trans> : <Trans>Save workspace</Trans>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PickerInfoDialog({
  topic,
  onClose,
}: {
  topic: "group" | "space";
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="picker-info-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {topic === "group" ? (
              <Users
                size={17}
                strokeWidth={1.8}
                className="text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <Lock
                size={17}
                strokeWidth={1.8}
                className="text-muted-foreground"
                aria-hidden="true"
              />
            )}
            {topic === "group" ? <Trans>Groups</Trans> : <Trans>Spaces</Trans>}
          </DialogTitle>
          <DialogDescription>
            {topic === "group" ? (
              <Trans>Shared chat with 2-6 bots. They all reply in the same thread.</Trans>
            ) : (
              <Trans>Private workspace with its own bots and groups.</Trans>
            )}
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export function NewBotSectionDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Pick<Bot, "name">;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={closeUnlessBusy(saving, onCancel)}>
      <DialogContent showCloseButton={false}>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed || saving) return;
            setSaving(true);
            setError(null);
            void onConfirm(trimmed).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : t`Could not create section`);
              setSaving(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <Trans>New section</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Create a section and move {bot.name} into it.</Trans>
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={nameId} className="block text-[13.5px] text-foreground/75">
            <Trans>Name</Trans>
            <Input
              id={nameId}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2"
            />
          </label>
          {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClearConversationDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Pick<Bot, "name">;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={closeUnlessBusy(clearing, onCancel)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            <Trans>Clear {bot.name}’s conversation?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              This permanently removes every message and stops current work. The chat remains
              available.
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={clearing}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={clearing}
            onClick={() => {
              setClearing(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : t`Could not clear conversation`);
                setClearing(false);
              });
            }}
          >
            {clearing ? <Trans>Clearing…</Trans> : <Trans>Clear</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteBotDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Bot;
  onCancel: () => void;
  onConfirm: (deleteMemories: boolean) => Promise<void>;
}) {
  const { t } = useLingui();
  const [deleting, setDeleting] = useState(false);
  const [deleteMemories, setDeleteMemories] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={closeUnlessBusy(deleting, onCancel)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            <Trans>Delete {bot.name}?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              Its conversation, files, and routines will be permanently deleted. Bots it created
              stay in your list.
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-[13.5px] text-foreground/75">
            <Trans>What about its memories?</Trans>
          </legend>
          <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
            <input
              type="radio"
              name="delete-memory"
              checked={!deleteMemories}
              onChange={() => setDeleteMemories(false)}
            />
            <span>
              <span className="block text-[14px] text-foreground">
                <Trans>Keep memories</Trans>
              </span>
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                <Trans>Move them to your shared memory.</Trans>
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
            <input
              type="radio"
              name="delete-memory"
              checked={deleteMemories}
              onChange={() => setDeleteMemories(true)}
            />
            <span>
              <span className="block text-[14px] text-foreground">
                <Trans>Delete memories too</Trans>
              </span>
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                <Trans>This cannot be undone.</Trans>
              </span>
            </span>
          </label>
        </fieldset>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm(deleteMemories).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : t`Could not delete bot`);
                setDeleting(false);
              });
            }}
          >
            {deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteItemDialog({
  item,
  noun,
  description,
  onCancel,
  onConfirm,
}: {
  item: { name: string };
  noun: "group" | "routine" | "space";
  description?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={closeUnlessBusy(deleting, onCancel)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>Delete {item.name}?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? <Trans>This cannot be undone.</Trans>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(
                  err instanceof Error
                    ? err.message
                    : noun === "group"
                      ? t`Could not delete group`
                      : noun === "space"
                        ? t`Could not delete space`
                        : t`Could not delete routine`,
                );
                setDeleting(false);
              });
            }}
          >
            {deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
