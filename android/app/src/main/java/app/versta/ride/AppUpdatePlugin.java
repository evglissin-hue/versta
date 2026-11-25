package app.versta.ride;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Live updates of the app's web code (docs/build/it7-35-app-updates.md). The web code downloads a newer bundle into
 * filesDir/app/&lt;id&gt;/ (only the files that differ from the APK's own, with bundle.json written last) and stages it
 * here. At the next launch, before the bridge starts, {@link #boot} makes it current on trial, and
 * {@link OverlayRoutes} serves its files over the APK's. A trial bundle that does not call ready() within 30 s in the
 * foreground, or that has launched twice without doing so, is rolled back to the bundle before it or to the APK's own
 * code. A new APK always starts from its own code. The rules are in {@link UpdateState}; this class keeps it in
 * SharedPreferences and answers the web code.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    /** Raise together with "level" in src/update/native-api.json whenever native code or plugins change. */
    public static final int NATIVE_LEVEL = 1;

    static final String PREFS = "versta-update";
    private static final long READY_TIMEOUT_MS = 30_000L;

    /** The bundle folder served over the APK's files, or null for the APK's own code. Read by {@link OverlayRoutes}. */
    static volatile File activeDir;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable watchdog = this::readyTimedOut;

    /* ------------------------------------------------------------------ the state, in SharedPreferences */

    static File folder(Context ctx, String id) {
        return new File(new File(ctx.getFilesDir(), "app"), id);
    }

    private static UpdateState.Disk disk(Context ctx) {
        return id -> {
            File dir = folder(ctx, id);
            return dir.isDirectory() && new File(dir, "bundle.json").isFile();
        };
    }

    private static UpdateState load(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        UpdateState s = new UpdateState();
        s.current = p.getString("current", "");
        s.next = p.getString("next", "");
        s.previous = p.getString("previous", "");
        s.trial = p.getBoolean("trial", false);
        s.launches = p.getInt("launches", 0);
        s.apk = p.getLong("apk", Long.MIN_VALUE);
        s.badFrom(p.getString("bad", ""));
        return s;
    }

    /** Saved at once (commit, not apply): a launch that crashes right after must still have counted. */
    private static void save(Context ctx, UpdateState s) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("current", s.current).putString("next", s.next).putString("previous", s.previous)
            .putBoolean("trial", s.trial).putInt("launches", s.launches).putLong("apk", s.apk)
            .putString("bad", s.badText()).commit();
        activeDir = s.current.isEmpty() ? null : folder(ctx, s.current);
    }

    private static long versionCode(Context ctx) {
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) {
            return -1;
        }
    }

    private static String versionName(Context ctx) {
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return p.versionName == null ? "" : p.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Called by MainActivity before the bridge starts: start clean after a new APK, promote a staged bundle on trial,
     * roll back a trial that keeps failing, and set the folder the overlay serves. Never throws: if anything goes
     * wrong here the app runs its own code.
     */
    static synchronized void boot(Context ctx) {
        try {
            UpdateState s = load(ctx);
            s.boot(versionCode(ctx), disk(ctx));
            save(ctx, s);
        } catch (Exception e) {
            activeDir = null;
        }
    }

    /* ------------------------------------------------------------------ the watchdog for a trial bundle */

    @Override
    public void load() {
        armWatchdog();
    }

    @Override
    protected void handleOnResume() {
        armWatchdog();
    }

    @Override
    protected void handleOnPause() {
        main.removeCallbacks(watchdog);
    }

    private void armWatchdog() {
        main.removeCallbacks(watchdog);
        if (load(getContext()).trial) main.postDelayed(watchdog, READY_TIMEOUT_MS);
    }

    private void readyTimedOut() {
        Context ctx = getContext();
        boolean rolled;
        synchronized (AppUpdatePlugin.class) {
            UpdateState s = load(ctx);
            rolled = s.readyTimedOut(disk(ctx));
            if (rolled) save(ctx, s);
        }
        if (rolled && getBridge() != null) getBridge().reload();
    }

    /* ------------------------------------------------------------------ the web code's calls */

    @PluginMethod
    public void info(PluginCall call) {
        Context ctx = getContext();
        UpdateState s = load(ctx);
        JSObject r = new JSObject();
        r.put("level", NATIVE_LEVEL);
        r.put("versionCode", versionCode(ctx));
        r.put("versionName", versionName(ctx));
        r.put("current", s.current.isEmpty() ? JSObject.NULL : s.current);
        r.put("next", s.next.isEmpty() ? JSObject.NULL : s.next);
        r.put("previous", s.previous.isEmpty() ? JSObject.NULL : s.previous);
        r.put("trial", s.trial);
        JSArray bad = new JSArray();
        for (String b : s.bad) bad.put(b);
        r.put("bad", bad);
        call.resolve(r);
    }

    @PluginMethod
    public void stage(PluginCall call) {
        Context ctx = getContext();
        boolean ok;
        synchronized (AppUpdatePlugin.class) {
            UpdateState s = load(ctx);
            ok = s.stage(call.getString("id"), disk(ctx));
            if (ok) save(ctx, s);
        }
        if (ok) call.resolve();
        else call.reject("That bundle cannot be used.");
    }

    @PluginMethod
    public void unstage(PluginCall call) {
        Context ctx = getContext();
        synchronized (AppUpdatePlugin.class) {
            UpdateState s = load(ctx);
            s.unstage();
            save(ctx, s);
        }
        call.resolve();
    }

    @PluginMethod
    public void ready(PluginCall call) {
        Context ctx = getContext();
        synchronized (AppUpdatePlugin.class) {
            UpdateState s = load(ctx);
            s.ready();
            save(ctx, s);
        }
        main.removeCallbacks(watchdog);
        call.resolve();
    }

    @PluginMethod
    public void restart(PluginCall call) {
        Context ctx = getContext();
        boolean ok;
        synchronized (AppUpdatePlugin.class) {
            UpdateState s = load(ctx);
            ok = s.restart(disk(ctx));
            if (ok) save(ctx, s);
        }
        if (!ok) {
            call.reject("Nothing is staged.");
            return;
        }
        call.resolve();
        armWatchdog();
        main.post(() -> { if (getBridge() != null) getBridge().reload(); });
    }

    @PluginMethod
    public void reset(PluginCall call) {
        Context ctx = getContext();
        synchronized (AppUpdatePlugin.class) {
            UpdateState s = load(ctx);
            s.reset();
            save(ctx, s);
        }
        main.removeCallbacks(watchdog);
        call.resolve();
        main.post(() -> { if (getBridge() != null) getBridge().reload(); });
    }
}
