import {
  type PluginSurfaceProps,
  useSettings,
  useTranslation,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import {
  baseUrlProblem,
  DEFAULT_SERVICE_URL,
  threadshareSettings,
} from "../shared/settings";
import { messages } from "./messages";

export function ThreadshareSettingsScreen({ theme }: PluginSurfaceProps) {
  const { t } = useTranslation(messages);
  const settings = useSettings(threadshareSettings);
  const [draft, setDraft] = useState<string | null>(null);

  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
    );
  }

  const saved = settings.values;
  const baseUrl = draft ?? saved.baseUrl;
  const problem = draft === null ? null : baseUrlProblem(draft);
  const changed = baseUrl.trim() !== saved.baseUrl;

  return (
    <SettingsSection
      title={t("settingsTitle")}
      info={t("settingsInfo", { service: baseUrl.trim() || DEFAULT_SERVICE_URL })}
    >
      <SettingsCard>
        <SettingsInput
          label={t("settingsService")}
          hint={t("settingsServiceHint")}
          placeholder={t("settingsServicePlaceholder")}
          initialValue={saved.baseUrl}
          error={problem ?? settings.saveError}
          onChangeText={setDraft}
        />
        <SettingsAction
          label={t("settingsSave")}
          actionLabel={settings.saving ? t("settingsSaving") : t("settingsSave")}
          disabled={!changed || problem !== null || settings.saving}
          onPress={async () => {
            if (await settings.save({ baseUrl: baseUrl.trim() }, settings.revision)) {
              setDraft(null);
            }
          }}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
