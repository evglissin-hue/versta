import { PageBar } from "./PageBar";
import { SettingsBody } from "./Settings";

export function SettingsPage() {
  return (
    <main class="home" data-testid="settings-page">
      <PageBar title="Settings" />
      <SettingsBody />
    </main>
  );
}
