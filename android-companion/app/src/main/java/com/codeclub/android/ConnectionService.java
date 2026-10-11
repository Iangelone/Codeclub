package com.codeclub.android;

import android.app.Service;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import org.json.JSONObject;
import okhttp3.*;
import java.util.concurrent.atomic.AtomicInteger;

/** User-visible connection with bounded reconnection backoff and an immediate local pause. */
public final class ConnectionService extends Service {
    private static volatile ConnectionService instance;
    static boolean sendApp(String message){ConnectionService service=instance;return service!=null&&service.socket!=null&&service.socket.send(message);}
    public static volatile String state = "offline";
    public static volatile String activity = "";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AtomicInteger generation = new AtomicInteger();
    private WebSocket socket;
    private OkHttpClient client;
    private SecretStore store;
    private int failures;
    private boolean destroyed;
    @Override public void onCreate() { super.onCreate(); store = new SecretStore(this);instance=this; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "pause".equals(intent.getAction())) { store.paused(!store.paused()); ControlService.cancel(); }
        if (store.read() == null) { stopSelf(); return START_NOT_STICKY; }
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("connection", getString(R.string.connection), NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pause = PendingIntent.getService(this, 1, new Intent(this, ConnectionService.class).setAction("pause"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(1, new android.app.Notification.Builder(this, "connection").setSmallIcon(R.drawable.orb_icon).setContentTitle("Codeclub").setContentText(getString(store.paused() ? R.string.paused : R.string.notification)).setContentIntent(open).setOngoing(true).addAction(new android.app.Notification.Action.Builder(null, getString(store.paused() ? R.string.resume : R.string.pause), pause).build()).build());
        if (socket == null) { handler.removeCallbacksAndMessages(null); connect(); }
        else hello();
        return START_STICKY;
    }
    private void hello() {
        try { if (socket != null) socket.send(new JSONObject().put("type", "hello").put("v", 1).put("permissions", new JSONObject().put("accessibility", ControlService.available()).put("paused", store.paused())).toString()); } catch (Exception ignored) { }
    }
    /** Connect using the pinned identity; generation guards discard obsolete callbacks. */
    private void connect() {
        JSONObject saved = store.read(); if (saved == null || destroyed) return;
        int current = generation.incrementAndGet(); state = "connecting";
        try {
            if (client != null) { client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll(); }
            client = Pairing.client(saved.getString("fingerprint"));
            Request request = new Request.Builder().url("wss://" + saved.getString("host") + ":" + saved.getInt("port") + "/device").header("Authorization", "Bearer " + saved.getString("secret")).header("x-codeclub-device", saved.getString("deviceId")).build();
            socket = client.newWebSocket(request, new WebSocketListener() {
                @Override public void onOpen(WebSocket ws, Response response) { handler.post(() -> { if (current != generation.get()) { ws.close(1000, "Cancelled"); return; } socket = ws; failures = 0; state = "connected"; hello(); }); }
                @Override public void onMessage(WebSocket ws, String message) {
                    if (current != generation.get() || message.length() > 12000000) return;
                    try {
                        JSONObject command = new JSONObject(message);
                        if("app_result".equals(command.optString("type"))){handler.post(()->MobileBridge.result(store,command));return;}
                        if ("cancel".equals(command.optString("type"))) { ControlService.cancel(); return; }
                        if (!"command".equals(command.optString("type"))) return;
                        String id = command.getString("id"), operation = command.getString("operation");
                        if (id.length() > 80) return;
                        activity = operation;
                        ControlService.execute(operation, command.optJSONObject("request"), store.paused(), result -> {
                            if (current != generation.get()) return;
                            try { ws.send(new JSONObject().put("type", "result").put("id", id).put("result", result).toString()); } catch (Exception ignored) { }
                        });
                    } catch (Exception ignored) { ws.close(4002, "Invalid command"); }
                }
                @Override public void onClosed(WebSocket ws, int code, String reason) { if (code == 4003 || code == 4001) { handler.post(() -> { if (current == generation.get()) { store.clear(); stopSelf(); } }); } else retry(current); }
                @Override public void onFailure(WebSocket ws, Throwable error, Response response) { if (response != null && response.code() == 401) { handler.post(() -> { if(current==generation.get()){store.clear();stopSelf();} }); } else retry(current); }
            });
        } catch (Exception error) { retry(current); }
    }
    /** Reconnect with bounded backoff; reconnection never replays phone control commands. */
    private void retry(int current) {
        handler.post(() -> { if (destroyed || current != generation.get()) return; socket = null; state = "offline"; ControlService.cancel(); handler.postDelayed(this::connect, Math.min(30000, 1000L << Math.min(failures++, 5))); });
    }
    @Override public void onDestroy() { if(instance==this)instance=null;destroyed = true; generation.incrementAndGet(); handler.removeCallbacksAndMessages(null); ControlService.cancel(); if (socket != null) socket.close(1000, "Disconnected"); if (client != null) { client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll(); } state = "offline"; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
