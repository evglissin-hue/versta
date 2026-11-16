import type { NavEngine, NavOptions, Pack } from "../types";

export const DEFAULT_NAV_OPTIONS: NavOptions = {
  maxAccuracy: 80, offRouteDistance: 45, offRouteDelay: 8, cueNowDistance: 15, cueApproachSeconds: 12, cueApproachMin: 60, asideLead: 40,
};

/** STUB. The navigation executor replaces this file. */
export function createNavEngine(_pack: Pack, _opts: Partial<NavOptions> = {}): NavEngine {
  throw new Error("createNavEngine is not implemented yet");
}
