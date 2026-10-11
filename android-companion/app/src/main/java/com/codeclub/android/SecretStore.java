package com.codeclub.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Pairing credentials are encrypted with a non-exportable Android Keystore key. */
final class SecretStore {
    private static final String ALIAS = "codeclub.connection";
    private final SharedPreferences prefs;
    SecretStore(Context context) { prefs = context.getSharedPreferences("codeclub", Context.MODE_PRIVATE); }
    String deviceId() {
        String id = prefs.getString("deviceId", null);
        if (id == null) { id = UUID.randomUUID().toString(); prefs.edit().putString("deviceId", id).apply(); }
        return id;
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    void save(JSONObject connection) throws Exception { saveValue("connection",connection); }
    /** Encrypt each namespace with AES-GCM and a fresh initialization vector. */
    private void saveValue(String name,JSONObject connection) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(cipher.doFinal(connection.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs.edit().putString(name, encrypted).commit()) throw new Exception("Credential storage unavailable");
    }
    JSONObject read() {return readValue("connection");}
    /** Authentication or decoding failures do not return partially decrypted values. */
    private JSONObject readValue(String name) {
        try {
            String saved = prefs.getString(name, null); if (saved == null) return null;
            String[] parts = saved.split("\\.");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception error) { prefs.edit().remove(name).apply(); return null; }
    }
    void clear() { prefs.edit().remove("connection").remove("outbox").apply(); MobileBridge.clear(); }
    JSONObject outbox(){JSONObject value=readValue("outbox");return value==null?new JSONObject():value;}
    void outbox(JSONObject value)throws Exception{saveValue("outbox",value);}
    boolean paused() { return prefs.getBoolean("paused", false); }
    void paused(boolean paused) { prefs.edit().putBoolean("paused", paused).apply(); }
}
