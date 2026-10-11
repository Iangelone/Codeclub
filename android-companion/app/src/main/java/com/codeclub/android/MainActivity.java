package com.codeclub.android;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** A local, user-controlled companion. Pairing codes never enter logs or plain preferences. */
public final class MainActivity extends ComponentActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private android.webkit.WebView browser;
    private SecretStore store;
    private LinearLayout body;
    private TextView status, activity, permission;
    private Button scan, paste, pause, disconnect;
    private volatile boolean pairing;
    private volatile boolean destroyed;
    private final ActivityResultLauncher<ScanOptions> scanner = registerForActivityResult(new ScanContract(), result -> {
        if (result.getContents() != null) pair(result.getContents());
    });
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable surface(int color, int radius) { GradientDrawable shape = new GradientDrawable(); shape.setColor(color); shape.setCornerRadius(dp(radius)); shape.setStroke(dp(1), 0xff242424); return shape; }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); store = new SecretStore(this);
        getWindow().setStatusBarColor(0xff111111); getWindow().setNavigationBarColor(0xff111111);
        android.webkit.WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        browser=new android.webkit.WebView(this);browser.setBackgroundColor(0xff111111);
        browser.getSettings().setJavaScriptEnabled(true);browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(false);browser.getSettings().setAllowContentAccess(false);
        browser.getSettings().setAllowFileAccessFromFileURLs(false);browser.getSettings().setAllowUniversalAccessFromFileURLs(false);
        browser.setWebViewClient(new android.webkit.WebViewClient(){@Override public boolean shouldOverrideUrlLoading(android.webkit.WebView view,android.webkit.WebResourceRequest request){return true;}});
        browser.addJavascriptInterface(new Object(){
            @android.webkit.JavascriptInterface public String snapshot(){try{return MobileBridge.snapshot(store,getResources().getConfiguration().getLocales().get(0).getLanguage()).put("pairing",pairing).toString();}catch(Exception ignored){return "{}";}}
            @android.webkit.JavascriptInterface public void request(String input){if(input==null||input.length()>100000)return;handler.post(()->{try{JSONObject request=new JSONObject(input);switch(request.optString("action")){case "scan"->scanner.launch(new ScanOptions().setCaptureActivity(PortraitCaptureActivity.class).setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt(getString(R.string.pair_hint)).setBeepEnabled(false).setOrientationLocked(true));case "paste"->pasteCode();case "settings"->showSettings();default->MobileBridge.request(store,request);}}catch(Exception ignored){}});}
        },"Codeclub");
        setContentView(browser);browser.setOnApplyWindowInsetsListener((view,insets)->{browser.setPadding(0,insets.getSystemWindowInsetTop(),0,insets.getSystemWindowInsetBottom());return insets;});
        browser.loadUrl("file:///android_asset/mobile.html");
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},21);
    }
    /** Keep connection and permission actions in the compact native overflow menu. */
    private void showSettings(){
        String[] options={getString(store.paused()?R.string.resume:R.string.pause),getString(R.string.accessibility),getString(R.string.scan),getString(R.string.paste),getString(R.string.disconnect)};
        style(new AlertDialog.Builder(this).setTitle(R.string.app_name).setItems(options,(dialog,index)->{switch(index){case 0->{store.paused(!store.paused());ControlService.cancel();startConnection();}case 1->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));case 2->scanner.launch(new ScanOptions().setCaptureActivity(PortraitCaptureActivity.class).setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt(getString(R.string.pair_hint)).setBeepEnabled(false).setOrientationLocked(true));case 3->pasteCode();case 4->style(new AlertDialog.Builder(this).setTitle(R.string.forget_title).setMessage(R.string.forget_hint).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.disconnect,(confirmation,which)->{stopService(new Intent(this,ConnectionService.class));store.clear();}).create());}}).create());
    }
    private void style(AlertDialog dialog) { dialog.show(); if(dialog.getWindow()!=null)dialog.getWindow().setBackgroundDrawable(surface(0xff191919,24)); if(dialog.getButton(AlertDialog.BUTTON_POSITIVE)!=null)dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(0xff8bc7ff);if(dialog.getButton(AlertDialog.BUTTON_NEGATIVE)!=null)dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(0xffaaaaaa); }
    private void pasteCode() {
        EditText input=new EditText(this); input.setSingleLine(false); input.setMaxLines(4); input.setTextSize(13); input.setTextColor(0xffeeeeee); input.setHint("CC1.…"); input.setHintTextColor(0xff777777); input.setPadding(dp(16),dp(12),dp(16),dp(12)); input.setBackground(surface(0xff161616,14)); input.setAutofillHints((String[])null); input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(8192)});
        LinearLayout wrap=new LinearLayout(this); wrap.setPadding(dp(24),dp(16),dp(24),dp(8)); wrap.addView(input,new LinearLayout.LayoutParams(-1,-2));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(R.string.paste).setView(wrap).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.connect,null).create(); style(dialog);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view->{String code=input.getText().toString().trim();try{Pairing.parse(code);}catch(Exception error){input.setError(getString(R.string.invalid_code));return;}input.setText("");dialog.dismiss();pair(code);});
    }
    /** Pair off the UI thread and keep an existing connection recoverable on failure. */
    private void pair(String code) {
        if(pairing)return;
        try{Pairing.parse(code);}catch(Exception error){style(new AlertDialog.Builder(this).setMessage(R.string.invalid_code).setPositiveButton(android.R.string.ok,null).create());return;}
        pairing=true; stopService(new Intent(this,ConnectionService.class)); 
        executor.execute(()->{
            boolean success=false;
            try { JSONObject connection=Pairing.connect(code,store); if(!destroyed){store.clear();store.save(connection);store.paused(false);success=true;} }
            catch(Exception ignored) { }
            boolean completed=success;
            handler.post(()->{if(destroyed)return;pairing=false;if(completed)startConnection();else {startConnection();style(new AlertDialog.Builder(this).setMessage(R.string.pair_error).setPositiveButton(android.R.string.ok,null).create());}});
        });
    }
    private void startConnection(){if(store.read()!=null)try{startForegroundService(new Intent(this,ConnectionService.class));}catch(IllegalStateException ignored){ConnectionService.state="offline";}}
        @Override protected void onResume(){super.onResume();if(!pairing)startConnection();}
    @Override protected void onPause(){super.onPause();}
    @Override protected void onDestroy(){destroyed=true;handler.removeCallbacksAndMessages(null);executor.shutdownNow();if(browser!=null){browser.removeJavascriptInterface("Codeclub");browser.destroy();}super.onDestroy();}
}
