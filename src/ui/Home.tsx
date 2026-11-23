import { useEffect } from "preact/hooks";
import { About } from "./About";
import { Menu } from "./Menu";
import { FirstRide, Routes } from "./Routes";
import { SettingsPage } from "./SettingsPage";
import { netDown, pages } from "./uistate";

/** The home side: the top page of the stack, and the first-ride sheet that Continue and Ride both open. */
export function Home() {
  useEffect(() => {
    const up = (): void => { netDown.value = false; };
    const down = (): void => { netDown.value = true; };
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  const page = pages.value[pages.value.length - 1];
  return (
    <>
      {page === "routes" ? <Routes /> : page === "settings" ? <SettingsPage /> : page === "about" ? <About /> : <Menu />}
      <FirstRide />
    </>
  );
}
