package com.codeclub.android;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** The orb is drawn once per size change and does not allocate during paint. */
final class OrbView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path shape = new Path();
    OrbView(Context context) { super(context); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }
    @Override protected void onSizeChanged(int width,int height,int oldWidth,int oldHeight) {
        float s=Math.min(width,height)*.36f,cx=width/2f,cy=height/2f; shape.reset();
        for(int i=0;i<=120;i++) { double a=i*Math.PI*2/120; float r=s*(1+.13f*(float)Math.cos(a*5)); float x=cx+r*(float)Math.sin(a),y=cy-r*(float)Math.cos(a); if(i==0)shape.moveTo(x,y);else shape.lineTo(x,y); }
        shape.close();paint.setShader(new LinearGradient(0,cy-s,0,cy+s,new int[]{0xffffffff,0xffeffbff,0xff8bc7ff,0xff235ce1},new float[]{0,.5f,.73f,1},Shader.TileMode.CLAMP));
    }
    @Override protected void onDraw(Canvas canvas) { super.onDraw(canvas);canvas.drawPath(shape,paint); }
}
