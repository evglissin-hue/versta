import { isNative } from "../native/platform";
import { PageBar } from "./PageBar";
import { RELEASES } from "./Routes";

export function About() {
  const simOn = new URLSearchParams(location.search).get("sim") === "1";
  return (
    <main class="home about" data-testid="about-page">
      <PageBar title="About" />
      <p>Versta is the old Russian measure of road, a little over a kilometre. The app follows your ride by GPS, speaks the turns and tells the stories of the places as you pass.</p>
      <p>Your progress and ride recordings stay on this device.</p>
      <p class="about-small">Pictures are public domain works from Wikimedia Commons. Map data &copy; OpenStreetMap contributors. Map tiles by OpenFreeMap. Sound credits are in Sound check, under Settings.</p>
      {isNative() ? null : <p><a class="linkbtn" href={RELEASES} target="_blank" rel="noopener" data-testid="android-link">Android app</a> keeps guiding with the screen off.</p>}
      {simOn
        ? <p>Simulation is on: Ride starts a pretend ride. <a class="linkbtn" href={import.meta.env.BASE_URL}>Use real GPS</a></p>
        : <p><a class="linkbtn" href={`${import.meta.env.BASE_URL}?sim=1&speed=5&scale=8`}>Simulate a ride</a> rides a route by itself, without GPS, for trying Versta at home.</p>}
    </main>
  );
}
