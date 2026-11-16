import type { Pack } from "../types";

export interface MapViewProps {
  pack: Pack;
  /** Keep the camera on the rider. The map sets it false itself when the rider drags the map. */
  follow: boolean;
  onFollowChange(follow: boolean): void;
  onStopTap(stop: number): void;
}

/** STUB. The map executor replaces this file. Reads `nav` and `settings` from ../state. */
export function MapView(_props: MapViewProps) {
  return <div class="map-stub">Map goes here</div>;
}
