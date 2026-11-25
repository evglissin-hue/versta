package app.versta.ride;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

/** Every rule of the live update on the JVM: promote, trial, rollback, a new APK, stage, restart, reset. */
public class UpdateStateTest {
    private static final String A = "aaaaaaaaaaaaaaaa";
    private static final String B = "bbbbbbbbbbbbbbbb";
    private static final long APK = 13;

    /** Folders on disk: complete when listed. */
    private final Set<String> complete = new HashSet<>();
    private final UpdateState.Disk disk = complete::contains;

    private UpdateState fresh() {
        UpdateState s = new UpdateState();
        s.boot(APK, disk);
        return s;
    }

    @Test
    public void aFirstLaunchRunsTheApksOwnCode() {
        UpdateState s = fresh();
        assertEquals("", s.current);
        assertFalse(s.trial);
    }

    @Test
    public void aStagedBundleBecomesCurrentOnTrialAtTheNextLaunch() {
        complete.add(A);
        UpdateState s = fresh();
        assertTrue(s.stage(A, disk));
        assertEquals("", s.current);
        s.boot(APK, disk);
        assertEquals(A, s.current);
        assertEquals("", s.next);
        assertTrue(s.trial);
        assertEquals(1, s.launches);
        s.ready();
        assertFalse(s.trial);
        s.boot(APK, disk);
        assertEquals(A, s.current);
        assertFalse(s.trial);
    }

    @Test
    public void aTrialThatNeverSaysReadyIsRolledBackAfterTwoLaunches() {
        complete.add(A);
        UpdateState s = fresh();
        s.stage(A, disk);
        s.boot(APK, disk); // launch 1, no ready
        s.boot(APK, disk); // launch 2, no ready
        assertEquals(A, s.current);
        s.boot(APK, disk); // rolled back before launch 3
        assertEquals("", s.current);
        assertTrue(s.bad.contains(A));
        assertFalse(s.stage(A, disk));
    }

    @Test
    public void aRollbackFallsBackToTheBundleBefore() {
        complete.add(A);
        complete.add(B);
        UpdateState s = fresh();
        s.stage(A, disk);
        s.boot(APK, disk);
        s.ready();
        s.stage(B, disk);
        s.boot(APK, disk);
        assertEquals(B, s.current);
        assertEquals(A, s.previous);
        assertTrue(s.readyTimedOut(disk));
        assertEquals(A, s.current);
        assertFalse(s.trial);
        assertTrue(s.bad.contains(B));
        assertFalse(s.readyTimedOut(disk));
    }

    @Test
    public void aNewApkStartsFromItsOwnCode() {
        complete.add(A);
        UpdateState s = fresh();
        s.stage(A, disk);
        s.boot(APK, disk);
        s.ready();
        s.boot(APK + 1, disk);
        assertEquals("", s.current);
        assertEquals("", s.previous);
        assertEquals(APK + 1, s.apk);
    }

    @Test
    public void anIncompleteOrMalformedBundleIsNeverUsed() {
        UpdateState s = fresh();
        assertFalse(s.stage(A, disk));            // no bundle.json yet
        assertFalse(s.stage("../../etc", disk));
        assertFalse(s.stage(null, disk));
        complete.add(A);
        s.stage(A, disk);
        complete.remove(A);                        // the folder went away before the launch
        s.boot(APK, disk);
        assertEquals("", s.current);
        assertEquals("", s.next);
    }

    @Test
    public void aCurrentBundleWhoseFolderVanishedIsRolledBack() {
        complete.add(A);
        UpdateState s = fresh();
        s.stage(A, disk);
        s.boot(APK, disk);
        s.ready();
        complete.remove(A);
        s.boot(APK, disk);
        assertEquals("", s.current);
    }

    @Test
    public void restartSwitchesNowOnTrialAndCountsThisLoad() {
        complete.add(A);
        UpdateState s = fresh();
        assertFalse(s.restart(disk));
        s.stage(A, disk);
        assertTrue(s.restart(disk));
        assertEquals(A, s.current);
        assertTrue(s.trial);
        assertEquals(1, s.launches);
    }

    @Test
    public void resetGoesBackToTheApkAndNeverOffersThatBundleAgain() {
        complete.add(A);
        UpdateState s = fresh();
        s.stage(A, disk);
        s.boot(APK, disk);
        s.ready();
        s.reset();
        assertEquals("", s.current);
        assertTrue(s.bad.contains(A));
        assertFalse(s.stage(A, disk));
    }

    @Test
    public void unstageKeepsTheCodeInUse() {
        complete.add(A);
        UpdateState s = fresh();
        s.stage(A, disk);
        s.unstage();
        s.boot(APK, disk);
        assertEquals("", s.current);
    }

    @Test
    public void badListsSurviveTheirTextForm() {
        UpdateState s = new UpdateState();
        s.badFrom(A + "," + B);
        assertEquals(A + "," + B, s.badText());
        s.badFrom("");
        assertEquals("", s.badText());
    }
}
