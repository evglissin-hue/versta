package app.versta.ride;

import android.content.Context;
import android.os.PowerManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Holds a partial wake lock (CPU only, the screen may sleep) while a ride is being followed, so the page keeps
 * running its timers and the voice keeps speaking with the phone locked. Released when the ride stops.
 */
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {
    // A safety net: no ride lasts longer, and a lock that is never released must not drain the battery forever.
    private static final long MAX_HOLD_MS = 8L * 60L * 60L * 1000L;
    private PowerManager.WakeLock lock;

    @PluginMethod
    public synchronized void acquire(PluginCall call) {
        if (lock == null) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "versta:ride");
            lock.setReferenceCounted(false);
        }
        lock.acquire(MAX_HOLD_MS);
        call.resolve();
    }

    @PluginMethod
    public synchronized void release(PluginCall call) {
        releaseLock();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        releaseLock();
    }

    private synchronized void releaseLock() {
        if (lock != null && lock.isHeld()) lock.release();
    }
}
