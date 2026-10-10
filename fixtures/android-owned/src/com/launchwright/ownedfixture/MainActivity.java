// SPDX-License-Identifier: AGPL-3.0-only
// Owned synthetic Android fixture: no permissions, network, accounts or user data.
package com.launchwright.ownedfixture;
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
public final class MainActivity extends Activity {
  private static final int BACKGROUND=Color.rgb(12,27,43);
  private static final int TEAL=Color.rgb(70,207,190);
  private static final int WHITE=Color.rgb(236,246,250);
  private static final int MUTED=Color.rgb(171,194,208);
  private int dp(float value) {
    return (int)(value*getResources().getDisplayMetrics().density+0.5f);
  }
  private TextView text(String value,int size,int color,boolean bold) {
    TextView view=new TextView(this);view.setText(value);view.setTextSize(size);
    view.setTextColor(color);
    if(bold)view.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
    return view;
  }
  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(BACKGROUND);
    getWindow().setNavigationBarColor(BACKGROUND);
    ScrollView scroll=new ScrollView(this);
    scroll.setFillViewport(true);scroll.setBackgroundColor(BACKGROUND);
    LinearLayout frame=new LinearLayout(this);
    frame.setOrientation(LinearLayout.VERTICAL);
    frame.setPadding(dp(30),dp(48),dp(30),dp(36));
    scroll.addView(frame);
    TextView kicker=text("LAUNCHWRIGHT  /  OWNED TEST",11,TEAL,true);
    kicker.setLetterSpacing(0.12f);
    frame.addView(kicker);
    TextView heading=text("Android emulator capture",29,WHITE,true);
    LinearLayout.LayoutParams h=new LinearLayout.LayoutParams(-1,-2);
    h.topMargin=dp(34);frame.addView(heading,h);
    View accent=new View(this);accent.setBackgroundColor(TEAL);
    LinearLayout.LayoutParams a=new LinearLayout.LayoutParams(dp(102),dp(4));
    a.topMargin=dp(32);frame.addView(accent,a);
    TextView sub=text("One owned, synthetic application screen for bounded screenshot acceptance.",17,MUTED,false);
    LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);
    p.topMargin=dp(38);frame.addView(sub,p);
    TextView proof=text("EMULATOR ONLY\n\nNo user account\nNo credentials\nNo network\nNo customer data",17,WHITE,false);
    proof.setGravity(Gravity.START);
    proof.setPadding(dp(24),dp(26),dp(24),dp(26));
    GradientDrawable card=new GradientDrawable();
    card.setColor(Color.rgb(27,51,70));card.setCornerRadius(dp(9));
    proof.setBackground(card);
    LinearLayout.LayoutParams c=new LinearLayout.LayoutParams(-1,-2);
    c.topMargin=dp(40);frame.addView(proof,c);
    TextView footer=text("R48 reads pixels only; Semwright Driver Host and Platform authority remain UNKNOWN.",12,MUTED,false);
    LinearLayout.LayoutParams f=new LinearLayout.LayoutParams(-1,-2);
    f.topMargin=dp(36);frame.addView(footer,f);
    setContentView(scroll);
  }
}
