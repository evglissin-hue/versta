package app.versta.ride;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * The live update's state and every rule that changes it, with no Android in it, so the JVM unit tests can run all of
 * it (android/app/src/test/java/app/versta/ride/UpdateStateTest.java). AppUpdatePlugin loads it from
 * SharedPreferences, calls one rule and saves it straight back.
 *
 * Bundle ids are versions: 16 hex characters. A bundle is usable when its id is well formed, it is not marked bad,
 * and its folder is complete (the web code writes bundle.json last).
 */
final class UpdateState {
    /** A trial bundle that has launched this many times without calling ready() is rolled back at the next launch. */
    static final int MAX_TRIAL_LAUNCHES = 2;
    private static final Pattern ID = Pattern.compile("^[0-9a-f]{16}$");

    /** Whether the folder of a bundle is complete. */
    interface Disk { boolean complete(String id); }

    /** The bundle in use ("" for the APK's own code), the one staged for the next start, and the one before current. */
    String current = "";
    String next = "";
    String previous = "";
    /** current has not called ready() since it became current. */
    boolean trial;
    /** Launches of current while on trial. */
    int launches;
    /** The APK version code these bundles were made for. */
    long apk = Long.MIN_VALUE;
    /** Bundles that failed to start or that the rider turned away from: never used again. */
    final List<String> bad = new ArrayList<>();

    boolean usable(String id, Disk disk) {
        return id != null && ID.matcher(id).matches() && !bad.contains(id) && disk.complete(id);
    }

    /** At launch, before the bridge starts. */
    void boot(long apkCode, Disk disk) {
        if (apk != apkCode) {
            // a new APK: its own code first; bundles made for the old one are forgotten
            apk = apkCode;
            current = "";
            next = "";
            previous = "";
            trial = false;
            launches = 0;
        }
        if (!next.isEmpty()) {
            if (usable(next, disk)) {
                previous = current;
                current = next;
                trial = true;
                launches = 0;
            }
            next = "";
        }
        if (!current.isEmpty() && !usable(current, disk)) {
            rollback(disk);
        } else if (trial) {
            if (launches >= MAX_TRIAL_LAUNCHES) rollback(disk);
            else launches++;
        }
    }

    /** Mark current bad and fall back to the bundle before it, or to the APK's own code. */
    void rollback(Disk disk) {
        if (!current.isEmpty() && !bad.contains(current)) bad.add(current);
        current = !previous.isEmpty() && usable(previous, disk) ? previous : "";
        previous = "";
        trial = false;
        launches = 0;
    }

    /** Use bundle id from the next start. False when it cannot be used. */
    boolean stage(String id, Disk disk) {
        if (!usable(id, disk)) return false;
        next = id;
        return true;
    }

    void unstage() {
        next = "";
    }

    /** The code in use has started properly. */
    void ready() {
        trial = false;
        launches = 0;
    }

    /** Switch to the staged bundle now, on trial; this load counts as its first launch. False when nothing usable is staged. */
    boolean restart(Disk disk) {
        if (!usable(next, disk)) return false;
        previous = current;
        current = next;
        next = "";
        trial = true;
        launches = 1;
        return true;
    }

    /** Back to the APK's own code, and never the current bundle again. */
    void reset() {
        if (!current.isEmpty() && !bad.contains(current)) bad.add(current);
        current = "";
        next = "";
        previous = "";
        trial = false;
        launches = 0;
    }

    /** The trial bundle did not call ready() in time. True when that rolled it back. */
    boolean readyTimedOut(Disk disk) {
        if (!trial) return false;
        rollback(disk);
        return true;
    }

    /** bad as stored: ids joined by commas. */
    String badText() {
        StringBuilder b = new StringBuilder();
        for (String id : bad) {
            if (b.length() > 0) b.append(',');
            b.append(id);
        }
        return b.toString();
    }

    void badFrom(String text) {
        bad.clear();
        if (text == null || text.isEmpty()) return;
        for (String id : text.split(",")) if (!id.isEmpty()) bad.add(id);
    }
}
