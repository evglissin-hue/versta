package app.versta.ride;

import com.getcapacitor.Bridge;
import com.getcapacitor.ProcessedRoute;
import com.getcapacitor.RouteProcessor;

import java.io.File;
import java.io.IOException;

/**
 * Serves the app's web files: from the downloaded bundle in use when it has the file, else from the APK's own
 * assets (docs/build/it7-35-app-updates.md). Without a bundle every path maps exactly as Capacitor's default does.
 *
 * How Capacitor's WebViewLocalServer reads the answer: for a request it calls process("", path) and opens the result
 * as a file when the path starts with /_capacitor_file_ (whatever isAsset says), as an asset otherwise
 * (ignoreAssetPath: the path is used as given). For the start page it calls process(basePath, "/index.html") and
 * opens a file when isAsset is false. Every answer to process("", path) therefore says isAsset true, so requests
 * running side by side never see each other's value of the server's shared isAsset field.
 */
public class OverlayRoutes implements RouteProcessor {
    private static final String ASSETS = "public";

    @Override
    public ProcessedRoute process(String basePath, String path) {
        ProcessedRoute r = new ProcessedRoute();
        r.setIgnoreAssetPath(true);
        r.setAsset(true);
        if (path == null || path.isEmpty()) path = "/";
        // Capacitor's own URLs for files and content (downloaded routes, shared files) pass through untouched.
        if (path.startsWith(Bridge.CAPACITOR_FILE_START) || path.startsWith(Bridge.CAPACITOR_CONTENT_START)) {
            r.setPath(path);
            return r;
        }
        File f = bundleFile(path);
        boolean startPage = basePath != null && !basePath.isEmpty();
        if (f != null) {
            if (startPage) {
                r.setAsset(false);
                r.setPath(f.getAbsolutePath());
            } else {
                r.setPath(Bridge.CAPACITOR_FILE_START + f.getAbsolutePath());
            }
            return r;
        }
        r.setPath(ASSETS + (path.startsWith("/") ? path : "/" + path));
        return r;
    }

    /** The file of the bundle in use for this path, or null when there is no bundle or it does not have the file. */
    private static File bundleFile(String path) {
        File dir = AppUpdatePlugin.activeDir;
        if (dir == null) return null;
        File f = new File(dir, path);
        if (!f.isFile()) return null;
        try {
            String root = dir.getCanonicalPath() + File.separator;
            return f.getCanonicalPath().startsWith(root) ? f : null;
        } catch (IOException e) {
            return null;
        }
    }
}
