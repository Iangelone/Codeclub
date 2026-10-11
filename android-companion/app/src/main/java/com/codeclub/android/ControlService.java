package com.codeclub.android;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.KeyguardManager;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

/** Observation-bound control. Device text is data, never authorization or instructions. */
public final class ControlService extends AccessibilityService {
    private static volatile ControlService instance;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private final Map<String, AccessibilityNodeInfo> nodes = new LinkedHashMap<>();
    private String snapshotId;
    private String screenSignature;
    private long observedAt;
    private int generation;
    @Override protected void onServiceConnected() { instance = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { generation++; clearSnapshot(); }
    @Override public void onDestroy() { instance = null; generation++; clearSnapshot(); super.onDestroy(); }
    static boolean available() { return instance != null; }
    static void cancel() { MAIN.post(() -> { if (instance != null) { instance.generation++; instance.clearSnapshot(); } }); }
    private void clearSnapshot() { nodes.clear(); snapshotId = null; screenSignature = null; }
    private static JSONObject failure(String message) { try { return new JSONObject().put("ok", false).put("error", message); } catch (Exception ignored) { return new JSONObject(); } }
    /** Dispatch on the accessibility thread only while locally enabled and unpaused. */
    static void execute(String operation, JSONObject request, boolean paused, Consumer<JSONObject> callback) {
        MAIN.post(() -> {
            ControlService service = instance;
            if (paused || (service != null && new SecretStore(service).paused())) { callback.accept(failure("Control paused on the phone.")); return; }
            if (service == null) { callback.accept(failure("Enable Codeclub Android Use in Accessibility settings on the phone.")); return; }
            try { service.perform(operation, request == null ? new JSONObject() : request, callback); }
            catch (Exception error) { callback.accept(failure("Android operation rejected. Observe again before retrying.")); }
        });
    }
    private JSONArray hierarchy(AccessibilityNodeInfo root, boolean retain) throws Exception {
        JSONArray elements = new JSONArray(); if (retain) nodes.clear();
        collect(root, elements, retain, 0); return elements;
    }
    private void collect(AccessibilityNodeInfo node, JSONArray elements, boolean retain, int depth) throws Exception {
        if (node == null || elements.length() >= 1000 || depth > 50) return;
        Rect bounds = new Rect(); node.getBoundsInScreen(bounds);
        String ref = "a" + elements.length();
        String text = node.isPassword() ? "[redacted]" : String.valueOf(node.getText() == null ? "" : node.getText());
        String description = node.isPassword() ? "[redacted]" : String.valueOf(node.getContentDescription() == null ? "" : node.getContentDescription());
        elements.put(new JSONObject().put("ref", ref).put("text", text.substring(0, Math.min(1000, text.length()))).put("description", description.substring(0, Math.min(1000, description.length()))).put("resourceId", node.getViewIdResourceName() == null ? "" : node.getViewIdResourceName()).put("className", String.valueOf(node.getClassName())).put("clickable", node.isClickable()).put("enabled", node.isEnabled()).put("focused", node.isFocused()).put("password", node.isPassword()).put("bounds", new JSONArray(new int[]{bounds.left, bounds.top, bounds.right, bounds.bottom})));
        if (retain) nodes.put(ref, node);
        for (int index = 0; index < node.getChildCount(); index++) collect(node.getChild(index), elements, retain, depth + 1);
    }
    private JSONObject observe() throws Exception {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) { clearSnapshot(); return failure("This screen does not expose accessibility controls. Unlock the phone or enable Accessibility."); }
        JSONArray elements = hierarchy(root, true);
        snapshotId = UUID.randomUUID().toString(); observedAt = android.os.SystemClock.elapsedRealtime(); screenSignature = elements.toString();
        android.util.DisplayMetrics metrics = new android.util.DisplayMetrics(); getSystemService(android.view.WindowManager.class).getDefaultDisplay().getRealMetrics(metrics);
        return new JSONObject().put("ok", true).put("snapshotId", snapshotId).put("elements", elements).put("width", metrics.widthPixels).put("height", metrics.heightPixels).put("perception", "accessibility");
    }
    private void screenshot(Consumer<JSONObject> callback) {
        int current = generation;
        takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
            @Override public void onSuccess(ScreenshotResult screenshot) {
                android.hardware.HardwareBuffer buffer = screenshot.getHardwareBuffer();
                try {
                    if (current != generation) { callback.accept(failure("Capture cancelled.")); return; }
                    Bitmap hardware = Bitmap.wrapHardwareBuffer(buffer, screenshot.getColorSpace());
                    if (hardware == null) throw new Exception("No display");
                    Bitmap bitmap = hardware.copy(Bitmap.Config.ARGB_8888, false); hardware.recycle();
                    ByteArrayOutputStream out = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                    JSONObject state = observe();
                    if (!state.optBoolean("ok")) { clearSnapshot(); snapshotId = UUID.randomUUID().toString(); observedAt = android.os.SystemClock.elapsedRealtime(); state = new JSONObject().put("ok", true).put("snapshotId", snapshotId).put("elements", new JSONArray()).put("perception", "screenshot").put("accessibilityError", "Semantic controls unavailable; protected screens may reject capture."); }
                    state.put("width", bitmap.getWidth()).put("height", bitmap.getHeight()).put("mimeType", "image/png").put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)); bitmap.recycle(); callback.accept(state);
                } catch (Exception error) { callback.accept(failure("Screenshot unavailable on this Android screen.")); }
                finally { buffer.close(); }
            }
            @Override public void onFailure(int code) { callback.accept(failure("Android rejected screenshot capture; protected screens and capture rate limits apply.")); }
        });
    }
    private void perform(String operation, JSONObject request, Consumer<JSONObject> callback) throws Exception {
        if ("get_state".equals(operation)) { callback.accept(observe()); return; }
        if ("screenshot".equals(operation)) { screenshot(callback); return; }
        if ("lock".equals(operation)) {
            clearSnapshot(); boolean dispatched = performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
            MAIN.postDelayed(() -> { try { boolean locked = getSystemService(KeyguardManager.class).isKeyguardLocked(); callback.accept(new JSONObject().put("ok", dispatched && locked).put("locked", locked).put("dispatched", dispatched)); } catch (Exception ignored) { callback.accept(failure("Lock verification failed.")); } }, 500); return;
        }
        if ("unlock".equals(operation)) { unlock(request, callback); return; }
        if (!"action".equals(operation)) { callback.accept(failure("Unsupported Android companion operation.")); return; }
        String action = request.optString("action");
        if ("key".equals(action) && "wake".equals(request.optString("key"))) { wake(); clearSnapshot(); laterResult(true, callback); return; }
        if (snapshotId == null || !snapshotId.equals(request.optString("snapshotId")) || android.os.SystemClock.elapsedRealtime() - observedAt > 60000) { callback.accept(failure("Observe this phone again; snapshot is missing or expired.")); return; }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (screenSignature == null && "key".equals(action) && android.os.SystemClock.elapsedRealtime() - observedAt <= 5000) {
            int key = navigationKey(request.optString("key"));
            if (key < 0) { callback.accept(failure("Only navigation is available on this observed screen.")); return; }
            boolean dispatched = performGlobalAction(key); clearSnapshot(); laterResult(dispatched, callback); return;
        }
        if (root == null || screenSignature == null || !screenSignature.equals(hierarchy(root, false).toString())) { clearSnapshot(); callback.accept(failure("Android screen changed. Observe again before acting.")); return; }
        boolean dispatched;
        if ("tap".equals(action) && request.has("ref")) {
            AccessibilityNodeInfo node = nodes.get(request.optString("ref"));
            if (node == null || !node.isEnabled() || node.isPassword() || !node.refresh()) { callback.accept(failure("Observed control is unavailable or protected.")); return; }
            if (node.isClickable()) { dispatched = node.performAction(AccessibilityNodeInfo.ACTION_CLICK); clearSnapshot(); laterResult(dispatched, callback); return; }
            Rect bounds = new Rect(); node.getBoundsInScreen(bounds); clearSnapshot(); gesture(bounds.centerX(), bounds.centerY(), bounds.centerX(), bounds.centerY(), 80, callback); return;
        }
        if ("tap".equals(action) || "swipe".equals(action)) {
            // Coordinate actions require a semantic screen comparison above; screenshots alone are insufficient.
            int x = request.getInt("x"), y = request.getInt("y"), endX = request.optInt("endX", x), endY = request.optInt("endY", y);
            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics(); getSystemService(android.view.WindowManager.class).getDefaultDisplay().getRealMetrics(metrics);
            if (x < 0 || y < 0 || endX < 0 || endY < 0 || x >= metrics.widthPixels || endX >= metrics.widthPixels || y >= metrics.heightPixels || endY >= metrics.heightPixels) { callback.accept(failure("Coordinates are outside the display.")); return; }
            int duration = "tap".equals(action) ? 80 : request.optInt("durationMs", 350);
            if (duration < 50 || duration > 2000) { callback.accept(failure("Unsupported gesture duration.")); return; }
            clearSnapshot(); gesture(x, y, endX, endY, duration, callback); return;
        }
        if ("type".equals(action)) {
            AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            String text = request.optString("text");
            if (focused == null || focused.isPassword() || !focused.isEditable() || text.isEmpty() || text.length() > 2000) { callback.accept(failure("Focus an unprotected editable field before typing.")); return; }
            Bundle args = new Bundle(); args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, String.valueOf(focused.getText() == null ? "" : focused.getText()) + text);
            dispatched = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        } else if ("key".equals(action)) {
            int key = navigationKey(request.optString("key"));
            if (key < 0) { callback.accept(failure("This companion supports Back, Home and Recents; other hardware keys require ADB.")); return; }
            dispatched = performGlobalAction(key);
        } else { callback.accept(failure("Unsupported Android action.")); return; }
        clearSnapshot(); laterResult(dispatched, callback);
    }
    private static int navigationKey(String key) { return switch (key) { case "back" -> GLOBAL_ACTION_BACK; case "home" -> GLOBAL_ACTION_HOME; case "recents" -> GLOBAL_ACTION_RECENTS; default -> -1; }; }
    private void wake() {
        PowerManager.WakeLock wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "Codeclub:android-use"); wake.acquire(1500); wake.release();
    }
    private void unlock(JSONObject request, Consumer<JSONObject> callback) throws Exception {
        clearSnapshot(); wake();
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        if (!keyguard.isKeyguardLocked()) { callback.accept(new JSONObject().put("ok", true).put("unlocked", true).put("alreadyUnlocked", true)); return; }
        // Android may hide its secure keyguard from Accessibility. Never invent coordinates or bypass it.
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.findAccessibilityNodeInfosByViewId("com.android.systemui:id/key_enter").isEmpty()) { callback.accept(failure("Android does not expose a supported PIN keypad. Unlock on the phone or use ADB.")); return; }
        callback.accept(failure("Secure PIN input is unavailable through this companion. Unlock on the phone or use ADB."));
    }
    private void gesture(int x, int y, int endX, int endY, int duration, Consumer<JSONObject> callback) {
        int current = generation;
        Path path = new Path(); path.moveTo(x, y); if (x != endX || y != endY) path.lineTo(endX, endY);
        boolean accepted = dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path, 0, duration)).build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription gesture) { MAIN.postDelayed(() -> { if (current == generation) dispatchResult(true, callback); else callback.accept(failure("Gesture completed during cancellation. Observe again.")); }, 350); }
            @Override public void onCancelled(GestureDescription gesture) { callback.accept(uncertain("Android cancelled the gesture. Observe before retrying.")); }
        }, MAIN);
        if (!accepted) callback.accept(failure("Android rejected the gesture."));
    }
    private static JSONObject uncertain(String message) { JSONObject result=failure(message);try{result.put("dispatched",true);}catch(Exception ignored){}return result; }
    private void laterResult(boolean dispatched,Consumer<JSONObject> callback) {
        int current=generation;
        MAIN.postDelayed(()->{if(current!=generation)callback.accept(uncertain("Action cancelled after dispatch. Observe again."));else dispatchResult(dispatched,callback);},350);
    }
    private void dispatchResult(boolean dispatched, Consumer<JSONObject> callback) {
        try { callback.accept(new JSONObject().put("ok", dispatched).put("dispatched", dispatched).put("state", observe()).put("verification", "Inspect returned state; dispatch alone does not prove completion.")); }
        catch (Exception ignored) { callback.accept(uncertain("Action dispatched; resulting state unavailable. Observe before retrying.")); }
    }
}
