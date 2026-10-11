package com.codeclub.android;

import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509TrustManager;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.MediaType;
import okhttp3.Response;

/** The scanned secret authenticates pairing; the pinned certificate authenticates the desktop. */
final class Pairing {
    static JSONObject parse(String code) throws Exception {
        if (code == null || !code.startsWith("CC1.") || code.length() > 8192) throw new Exception("Invalid pairing code");
        JSONObject data = new JSONObject(new String(Base64.decode(code.substring(4), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), java.nio.charset.StandardCharsets.UTF_8));
        if (data.getInt("v") != 1 || data.getLong("expiresAt") < System.currentTimeMillis() || !data.getString("fingerprint").matches("[a-f0-9]{64}") || !data.getString("token").matches("[A-Za-z0-9_-]{43}") || data.getInt("port") < 1 || data.getInt("port") > 65535) throw new Exception("Invalid pairing code");
        JSONArray hosts = data.getJSONArray("hosts"); if (hosts.length() == 0 || hosts.length() > 12) throw new Exception("Invalid host list");
        for (int i = 0; i < hosts.length(); i++) {
            String host = hosts.getString(i);
            if (!host.matches("(10\\..*|192\\.168\\..*|172\\.(1[6-9]|2[0-9]|3[01])\\..*|127\\.0\\.0\\.1)") || !host.matches("[0-9.]{7,15}")) throw new Exception("Only local network addresses are allowed");
            String[] octets = host.split("\\."); if (octets.length != 4) throw new Exception("Invalid address");
            for (String octet : octets) if (Integer.parseInt(octet) > 255) throw new Exception("Invalid address");
        }
        return data;
    }
    static OkHttpClient client(String fingerprint) throws Exception {
        X509TrustManager trust = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException("Client certificates unsupported"); }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException {
                try {
                    if (chain.length == 0) throw new Exception("Missing certificate");
                    chain[0].checkValidity();
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
                    StringBuilder hex = new StringBuilder(); for (byte value : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                    if (!MessageDigest.isEqual(hex.toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII), fingerprint.getBytes(java.nio.charset.StandardCharsets.US_ASCII))) throw new Exception("Certificate mismatch");
                } catch (Exception error) { throw new java.security.cert.CertificateException("Desktop certificate verification failed"); }
            }
        };
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(null, new javax.net.ssl.TrustManager[]{trust}, null);
        return new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).sslSocketFactory(tls.getSocketFactory(), trust).hostnameVerifier((host, session) -> host.matches("[0-9.]+")) .connectTimeout(5, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).build();
    }
    /** Validate the scanned offer and exchange its one-time token for a persistent peer secret. */
    static JSONObject connect(String code, SecretStore store) throws Exception {
        JSONObject data = parse(code);
        OkHttpClient client = client(data.getString("fingerprint"));
        try {
            JSONArray hosts = data.getJSONArray("hosts");
            for (int i = 0; i < hosts.length(); i++) {
                String host = hosts.getString(i);
                JSONObject body = new JSONObject().put("pairId", data.getString("pairId")).put("token", data.getString("token")).put("deviceId", store.deviceId());
                Request request = new Request.Builder().url("https://" + host + ":" + data.getInt("port") + "/pair").post(RequestBody.create(body.toString(), MediaType.get("application/json"))).build();
                try (Response response = client.newCall(request).execute()) {
                    if (!response.isSuccessful() || response.body() == null) throw new Exception("Pairing rejected");
                    JSONObject result = new JSONObject(response.body().string());
                    if (!result.getString("secret").matches("[A-Za-z0-9_-]{43}") || !result.getString("deviceId").equals(store.deviceId())) throw new Exception("Invalid pairing response");
                    return new JSONObject().put("host", host).put("port", data.getInt("port")).put("fingerprint", data.getString("fingerprint")).put("secret", result.getString("secret")).put("deviceId", store.deviceId());
                } catch (java.io.IOException error) { if (i == hosts.length() - 1) throw error; }
            }
            throw new Exception("Desktop unavailable");
        } finally { client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll(); }
    }
}
