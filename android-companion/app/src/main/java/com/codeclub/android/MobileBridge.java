package com.codeclub.android;
import org.json.*;
import java.util.UUID;
import android.os.SystemClock;

/** Acknowledged messages survive disconnects; retries keep the same request identity. */
final class MobileBridge {
    private static JSONObject desktop=new JSONObject(),selection=new JSONObject(),control;
    private static String pendingOperation;
    private static String pendingId,pendingMessage;
    private static long pendingAt;
    private static String error="";
    /** Drop transient protocol state when the user changes or removes a pairing. */
    static synchronized void clear(){desktop=new JSONObject();selection=new JSONObject();control=null;pendingId=null;pendingMessage=null;pendingOperation=null;error="";}
    /** Return cached desktop state and delivery status without exposing pairing credentials. */
    static synchronized JSONObject snapshot(SecretStore store,String language){
        try{JSONArray outbox=store.outbox().optJSONArray("messages");return new JSONObject().put("desktop",desktop).put("linked",store.read()!=null).put("connected","connected".equals(ConnectionService.state)).put("paused",store.paused()).put("accessibility",ControlService.available()).put("language",language).put("error",error).put("localOutbox",outbox==null?new JSONArray():outbox);}catch(Exception ignored){return new JSONObject();}
    }
    /** Persist sends before transport; approval and stop requests remain transient. */
    static synchronized void request(SecretStore store,JSONObject request){
        try{
            if("send".equals(request.optString("operation"))){
                String text=request.getString("text"),id=request.getString("id"),chat=request.getString("chatKey");
                if(text.trim().isEmpty()||text.length()>16000||!id.matches("[-\\w]{16,80}")||chat.length()!=64)return;
                JSONObject saved=store.outbox();JSONArray messages=saved.optJSONArray("messages");if(messages==null)messages=new JSONArray();
                if(request.has("retryId")){JSONArray kept=new JSONArray();for(int i=0;i<messages.length();i++){JSONObject old=messages.getJSONObject(i);if(!old.optBoolean("failed")||!old.optString("id").equals(request.optString("retryId")))kept.put(old);}messages=kept;}
                if(messages.length()>=100){error="QUEUE_FULL";return;}
                for(int i=0;i<messages.length();i++)if(id.equals(messages.getJSONObject(i).optString("id")))return;
                messages.put(new JSONObject().put("operation","send").put("id",id).put("chatKey",chat).put("text",text));store.outbox(new JSONObject().put("messages",messages));error="";
            }else if("sync".equals(request.optString("operation"))){selection=request;}else if("control".equals(request.optString("operation"))){if(!"connected".equals(ConnectionService.state)){error="OFFLINE";return;}control=request;}
            pump(store);
        }catch(Exception ignored){error="STORAGE_UNAVAILABLE";}
    }
    /** Allow one request at a time, prioritizing control and retaining stable send identities. */
    private static void pump(SecretStore store)throws Exception{
        if(!"connected".equals(ConnectionService.state))return;
        if(pendingId!=null&&SystemClock.elapsedRealtime()-pendingAt<10000)return;
        pendingId=null;pendingMessage=null;
        JSONArray messages=store.outbox().optJSONArray("messages");JSONObject request=null;
        if(messages!=null)for(int i=0;i<messages.length();i++)if(!messages.getJSONObject(i).optBoolean("submitted")){request=messages.getJSONObject(i);pendingMessage=request.getString("id");break;}
        if(control!=null){request=control;control=null;pendingMessage=null;}
        if(request==null){request=new JSONObject(selection.toString());request.put("operation","sync");}
        pendingOperation=request.optString("operation");
        pendingId=UUID.randomUUID().toString();pendingAt=SystemClock.elapsedRealtime();
        if(!ConnectionService.sendApp(new JSONObject().put("type","app_request").put("id",pendingId).put("request",request).toString()))pendingId=null;
    }
    /** Remove outbox text only after desktop acceptance; failed messages need explicit retry. */
    static synchronized void result(SecretStore store,JSONObject result){
        if(!result.optString("id").equals(pendingId))return;
        try{
            if(result.optBoolean("ok")){
                if("control".equals(pendingOperation)){error="";pendingId=null;return;}
                JSONArray messages=store.outbox().optJSONArray("messages"),remaining=new JSONArray();
                if(pendingMessage==null){desktop=result.getJSONObject("result");JSONArray statuses=desktop.optJSONArray("outbox");if(messages!=null)for(int i=0;i<messages.length();i++){JSONObject message=messages.getJSONObject(i);String state="";if(statuses!=null)for(int j=0;j<statuses.length();j++)if(message.optString("id").equals(statuses.getJSONObject(j).optString("id")))state=statuses.getJSONObject(j).optString("state");if(!"accepted".equals(state)){if("failed".equals(state)){message.put("failed",true);message.put("submitted",true);}remaining.put(message);}}}
                else{if(messages!=null)for(int i=0;i<messages.length();i++){JSONObject message=messages.getJSONObject(i);if(pendingMessage.equals(message.optString("id")))message.put("submitted",true);remaining.put(message);}}
                JSONObject updated=new JSONObject().put("messages",remaining);if(!updated.toString().equals(store.outbox().toString()))store.outbox(updated);error="";
            }else{error=result.optString("error","REQUEST_REJECTED");if(pendingMessage!=null&&!"DESKTOP_BUSY".equals(error)){JSONArray messages=store.outbox().optJSONArray("messages");if(messages!=null)for(int i=0;i<messages.length();i++){JSONObject message=messages.getJSONObject(i);if(pendingMessage.equals(message.optString("id"))){message.put("failed",true);message.put("submitted",true);}}store.outbox(new JSONObject().put("messages",messages==null?new JSONArray():messages));}}
        }catch(Exception ignored){error="SYNC_FAILED";}
        pendingId=null;pendingMessage=null;
    }
}
