package app.versta.ride;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATIONS_REQUEST = 4101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live in the app itself must be registered before the bridge starts.
        registerPlugin(KeepAwakePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        // Live updates of the web code: promote or roll back a downloaded bundle, then serve its files over the APK's.
        AppUpdatePlugin.boot(this);
        bridgeBuilder.setRouteProcessor(new OverlayRoutes());
        super.onCreate(savedInstanceState);

        // The hardware volume buttons control the media stream, which is what the stories and the bed play on.
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        // Android 13 and later: without this permission the "Following your ride." notification is hidden.
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATIONS_REQUEST);
        }
    }
}
