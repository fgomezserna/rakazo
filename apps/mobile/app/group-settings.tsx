import { GROUP_MEMBER_MAX, GROUP_MEMBER_MIN } from "@rakazo/contracts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { BotMemberPicker } from "../components/bot-member-picker";
import { type MobileBot, type MobileGroup, type MobileSpaceNavigation, rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function GroupSettingsScreen() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [group, setGroup] = useState<MobileGroup | null>(null);
  const [bots, setBots] = useState<MobileBot[]>([]);
  const [sharedBots, setSharedBots] = useState<
    Array<Pick<MobileBot, "id" | "name" | "color" | "status"> & { spaceName: string }>
  >([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    void Promise.all([
      rpc<MobileGroup[]>("groups/list").then(
        (groups) => groups.find((row) => row.id === groupId) ?? null,
      ),
      rpc<MobileBot[]>("bots/list"),
      rpc<MobileSpaceNavigation>("spaces/list"),
    ])
      .then(([nextGroup, nextBots, navigation]) => {
        if (!nextGroup) throw new Error(t("Group not found"));
        setGroup(nextGroup);
        setName(nextGroup.name);
        setSelected(
          nextGroup.members.filter((member) => !member.shared).map((member) => member.botId),
        );
        setBots(nextBots.filter((bot) => !bot.archivedAt));
        const spaceId = nextGroup.spaceId ?? navigation.current.id;
        setSharedBots(
          navigation.spaces
            .filter((space) => space.id !== spaceId)
            .flatMap((space) =>
              space.bots.map((bot) => ({
                id: bot.id,
                name: bot.name,
                color: bot.color,
                status: bot.status,
                spaceName: space.name,
              })),
            ),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("Could not load group")));
  }, [groupId]);

  async function save() {
    if (!groupId || !group || pending) return;
    setPending(true);
    setError(null);
    try {
      const input: { groupId: string; name?: string; botIds?: string[] } = { groupId };
      if (name.trim() !== group.name) input.name = name.trim();
      const memberIds = group.members
        .filter((member) => !member.shared)
        .map((member) => member.botId)
        .join(",");
      if (selected.join(",") !== memberIds) input.botIds = selected;
      if (input.name || input.botIds) await rpc("groups/update", input);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not save group"));
    } finally {
      setPending(false);
    }
  }

  async function addGuest(botId: string) {
    if (!groupId || pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await rpc<MobileGroup>("groups/guests/add", {
        groupId,
        botId,
        mentionOnly: true,
      });
      setGroup(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not add shared bot"));
    } finally {
      setPending(false);
    }
  }

  async function removeGuest(botId: string) {
    if (!groupId || pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await rpc<MobileGroup>("groups/guests/remove", { groupId, botId });
      setGroup(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not remove shared bot"));
    } finally {
      setPending(false);
    }
  }

  function remove() {
    if (!groupId || !group) return;
    Alert.alert(group.name, t("Delete this group? Bots and their solo threads are kept."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () =>
          void rpc("groups/remove", { groupId })
            .then(() => router.replace("/"))
            .catch((err) =>
              Alert.alert(
                t("Could not delete group"),
                err instanceof Error ? err.message : t("Try again."),
              ),
            ),
      },
    ]);
  }

  if (!group) return null;

  return (
    <>
      <Stack.Screen options={{ title: t("Group settings") }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: tokens.background }}
        contentContainerStyle={{ padding: 24 }}
      >
        <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Name")}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("Group name")}
          placeholderTextColor={tokens.mutedForeground}
          style={{
            marginTop: 8,
            backgroundColor: tokens.muted,
            borderRadius: 11,
            padding: 14,
            color: tokens.foreground,
            fontSize: 16,
          }}
        />
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, marginTop: 20 }}>
          {t("Members")}
        </Text>
        <BotMemberPicker
          bots={bots}
          selected={selected}
          onChange={setSelected}
          disabled={pending}
        />
        {group.members.some((member) => member.shared) ? (
          <View style={{ marginTop: 18 }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Shared bots")}</Text>
            {group.members
              .filter((member) => member.shared)
              .map((member) => (
                <View
                  key={member.botId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 10,
                    gap: 10,
                  }}
                >
                  <Text style={{ color: tokens.foreground, flex: 1 }}>
                    {member.name} · {member.spaceName ?? t("Another workspace")}
                  </Text>
                  <Pressable onPress={() => void removeGuest(member.botId)} disabled={pending}>
                    <Text style={{ color: tokens.destructive }}>{t("Remove")}</Text>
                  </Pressable>
                </View>
              ))}
            {sharedBots
              .filter(
                (bot) =>
                  !group.members.some((member) => member.botId === bot.id) &&
                  !group.members.some((member) => !member.shared && member.botId === bot.id),
              )
              .map((bot) => (
                <Pressable
                  key={bot.id}
                  onPress={() => void addGuest(bot.id)}
                  disabled={pending}
                  style={{ paddingVertical: 10 }}
                >
                  <Text style={{ color: tokens.primary }}>
                    {t("Add")} {bot.name} · {bot.spaceName}
                  </Text>
                </Pressable>
              ))}
          </View>
        ) : sharedBots.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Shared bots")}</Text>
            {sharedBots.map((bot) => (
              <Pressable
                key={bot.id}
                onPress={() => void addGuest(bot.id)}
                disabled={pending}
                style={{ paddingVertical: 10 }}
              >
                <Text style={{ color: tokens.primary }}>
                  {t("Add")} {bot.name} · {bot.spaceName}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {error ? <Text style={{ color: tokens.destructive, marginTop: 12 }}>{error}</Text> : null}
        <Pressable
          onPress={() => void save()}
          disabled={
            !name.trim() ||
            selected.length < GROUP_MEMBER_MIN ||
            selected.length > GROUP_MEMBER_MAX ||
            pending
          }
          style={{
            marginTop: 24,
            backgroundColor: tokens.primary,
            opacity:
              !name.trim() ||
              selected.length < GROUP_MEMBER_MIN ||
              selected.length > GROUP_MEMBER_MAX ||
              pending
                ? 0.5
                : 1,
            borderRadius: 11,
            padding: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: tokens.primaryForeground, fontSize: 16, fontWeight: "600" }}>
            {pending ? t("Saving…") : t("Save")}
          </Text>
        </Pressable>
        <Pressable
          onPress={remove}
          style={{
            marginTop: 16,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: tokens.border,
            padding: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: tokens.destructive, fontSize: 16 }}>{t("Delete group")}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}
