import { Sheet } from "./Sheet";
import { SettingsBody } from "./Settings";
import { soundOpen } from "./uistate";

export function SoundSheet() {
  return (
    <Sheet title="Sound and settings" onClose={() => { soundOpen.value = false; }} testid="sound-sheet">
      <SettingsBody />
    </Sheet>
  );
}
