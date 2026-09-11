import {
  isSpaceAvatarDataUrl,
  SPACE_AVATAR_MIME_TYPES,
  type Space,
  type SpaceNavigation,
  type SpaceProfile,
} from "@rakazo/contracts";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { NativeSymbol } from "../components/native-symbol";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

type SpaceSettingsRecord = Pick<Space, "id" | "name" | "avatarUrl" | "canConfigure">;

async function pickSpaceAvatar(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const mimeType = (asset.mimeType ?? "image/jpeg") as string;
  if (!(SPACE_AVATAR_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  }
  const contentBase64 = await new File(asset.uri).base64();
  const dataUrl = `data:${mimeType};base64,${contentBase64}`;
  if (!isSpaceAvatarDataUrl(dataUrl)) {
    throw new Error("That image is too large. Choose a smaller image.");
  }
  return dataUrl;
}

export default function SpaceSettingsScreen() {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const router = useRouter();
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const [space, setSpace] = useState<SpaceSettingsRecord | null>(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    void rpc<SpaceNavigation>("spaces/list")
      .then((navigation) => {
        const found = navigation.spaces.find((candidate) => candidate.id === spaceId);
        if (!found?.canConfigure) {
          throw new Error(t("Only the workspace owner can configure it"));
        }
        const next = {
          id: found.id,
          name: found.name,
          avatarUrl: found.avatarUrl,
          canConfigure: found.canConfigure,
        } satisfies SpaceSettingsRecord;
        setSpace(next);
        setName(next.name);
        setAvatarUrl(next.avatarUrl);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : t("Could not load workspace")),
      );
  }, [spaceId, t]);

  async function chooseAvatar() {
    if (pending || picking) return;
    setPicking(true);
    setError(null);
    try {
      const next = await pickSpaceAvatar();
      if (next) setAvatarUrl(next);
      else {
        const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!permission.granted)
          Alert.alert(t("Photo access required"), t("Allow photo access to choose an avatar."));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not read that image"));
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!space || !spaceId || !trimmed || pending || picking) return;
    setPending(true);
    setError(null);
    try {
      await rpc<SpaceProfile>("spaces/update", { spaceId, name: trimmed, avatarUrl });
      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not update workspace"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t("Configure workspace"),
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={{ paddingEnd: 20, paddingVertical: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t("Cancel")}
            >
              <Text style={{ color: tokens.foreground, fontSize: 17 }}>{t("Cancel")}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: tokens.background }}
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tokens.muted,
            }}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} />
            ) : (
              <NativeSymbol
                ios="lock"
                android="lock-closed-outline"
                size={30}
                color={tokens.mutedForeground}
              />
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Pressable
              onPress={() => void chooseAvatar()}
              disabled={pending || picking || !space}
              style={{
                borderRadius: 11,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: tokens.muted,
                opacity: pending || picking || !space ? 0.45 : 1,
              }}
            >
              <Text style={{ color: tokens.foreground, fontWeight: "600" }}>
                {picking ? t("Reading…") : t("Choose image")}
              </Text>
            </Pressable>
            {avatarUrl ? (
              <Pressable
                onPress={() => setAvatarUrl(null)}
                disabled={pending || picking}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  opacity: pending || picking ? 0.45 : 1,
                }}
              >
                <Text style={{ color: tokens.destructive }}>{t("Remove")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Name")}</Text>
        <TextInput
          autoFocus
          value={name}
          maxLength={60}
          onChangeText={setName}
          onSubmitEditing={() => void save()}
          placeholder={t("Workspace name")}
          placeholderTextColor={tokens.mutedForeground}
          returnKeyType="done"
          style={{
            marginTop: 8,
            backgroundColor: tokens.muted,
            borderRadius: 11,
            padding: 14,
            color: tokens.foreground,
            fontSize: 16,
          }}
        />
        {error ? <Text style={{ color: tokens.destructive, marginTop: 14 }}>{error}</Text> : null}
        <Pressable
          onPress={() => void save()}
          disabled={!name.trim() || pending || picking || !space}
          style={{
            marginTop: 20,
            backgroundColor: tokens.primary,
            borderRadius: 11,
            padding: 14,
            alignItems: "center",
            opacity: !name.trim() || pending || picking || !space ? 0.4 : 1,
          }}
        >
          <Text style={{ color: tokens.primaryForeground, fontSize: 16, fontWeight: "600" }}>
            {pending ? t("Saving…") : t("Save workspace")}
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}
