package app.versta.ride;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.ProcessedRoute;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;

import org.junit.After;
import org.junit.Test;

/** How the overlay answers Capacitor's local server, with and without a downloaded bundle. */
public class OverlayRoutesTest {
    private final OverlayRoutes routes = new OverlayRoutes();

    @After
    public void noBundle() {
        AppUpdatePlugin.activeDir = null;
    }

    private static void put(File dir, String path, String text) throws IOException {
        File f = new File(dir, path);
        f.getParentFile().mkdirs();
        try (FileWriter w = new FileWriter(f)) { w.write(text); }
    }

    @Test
    public void withoutABundleEveryPathMapsAsCapacitorsDefault() {
        ProcessedRoute r = routes.process("", "/assets/index-abc.js");
        assertEquals("public/assets/index-abc.js", r.getPath());
        assertTrue(r.isAsset());
        assertTrue(r.isIgnoreAssetPath());
        ProcessedRoute start = routes.process("public", "/index.html");
        assertEquals("public/index.html", start.getPath());
        assertTrue(start.isAsset());
    }

    @Test
    public void capacitorsOwnFileAndContentUrlsPassThrough() {
        String file = "/_capacitor_file_/data/user/0/app.versta.ride/files/packs/x/v/pack.json";
        assertEquals(file, routes.process("", file).getPath());
        String content = "/_capacitor_content_/media/1";
        assertEquals(content, routes.process("", content).getPath());
    }

    @Test
    public void aBundleServesItsFilesOverTheApksAndTheRestFromTheApk() throws IOException {
        File dir = Files.createTempDirectory("bundle").toFile();
        put(dir, "index.html", "<html>v2</html>");
        put(dir, "assets/app-2.js", "code");
        AppUpdatePlugin.activeDir = dir;
        ProcessedRoute js = routes.process("", "/assets/app-2.js");
        assertEquals("/_capacitor_file_" + new File(dir, "assets/app-2.js").getAbsolutePath(), js.getPath());
        // every answer to a request says asset, so requests side by side never flip the server's shared flag
        assertTrue(js.isAsset());
        ProcessedRoute start = routes.process("public", "/index.html");
        assertEquals(new File(dir, "index.html").getAbsolutePath(), start.getPath());
        assertFalse(start.isAsset());
        ProcessedRoute sound = routes.process("", "/sounds/fx/gull.mp3");
        assertEquals("public/sounds/fx/gull.mp3", sound.getPath());
        assertTrue(sound.isAsset());
    }

    @Test
    public void aPathCannotClimbOutOfTheBundle() throws IOException {
        File root = Files.createTempDirectory("bundles").toFile();
        File dir = new File(root, "aaaaaaaaaaaaaaaa");
        dir.mkdirs();
        put(root, "secret.txt", "no");
        AppUpdatePlugin.activeDir = dir;
        assertEquals("public/../secret.txt", routes.process("", "/../secret.txt").getPath());
    }
}
