package app.supply.mobile;
import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.net.Uri;
import android.content.Intent;
import android.view.View;
import android.view.WindowInsets;
import android.widget.*;
import android.webkit.*;

public class MainActivity extends Activity {
 private static final String URL="https://supplyteam.ru/?mobile=1#mobile";
 private static final String HOST="supplyteam.ru";
 private PermissionRequest cameraRequest;
 private WebView web;
 private FrameLayout root;
 private LinearLayout offline;
 private boolean trusted(Uri uri){return "https".equals(uri.getScheme())&&(HOST.equals(uri.getHost())||"77-87-212-236.sslip.io".equals(uri.getHost()))&&(uri.getPort()==-1||uri.getPort()==443);}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(9,9,11));setContentView(root);
  root.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);}else{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());}return insets;});
  web=new WebView(this);web.setBackgroundColor(Color.rgb(9,9,11));root.addView(web,new FrameLayout.LayoutParams(-1,-1));
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){Uri uri=request.getUrl();if(trusted(uri))return false;if(request.isForMainFrame()&&"https".equals(uri.getScheme())){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}}return true;}
   @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){hideOffline();}
   @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showOffline();}
   @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=400)showOffline();}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{
    if(!trusted(request.getOrigin())||request.getResources().length!=1||!PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(request.getResources()[0])){request.deny();return;}
    if(cameraRequest!=null){request.deny();return;}
    if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED){request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});return;}
    cameraRequest=request;requestPermissions(new String[]{Manifest.permission.CAMERA},7001);
   });}
   @Override public void onPermissionRequestCanceled(PermissionRequest request){runOnUiThread(()->{if(cameraRequest==request)cameraRequest=null;});}
  });
  if(state==null||web.restoreState(state)==null)web.loadUrl(URL);
  if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->goBack());
 }
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){
  super.onRequestPermissionsResult(code,permissions,results);
  if(code==7001&&cameraRequest!=null){PermissionRequest request=cameraRequest;cameraRequest=null;
   if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED&&trusted(request.getOrigin()))request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});else request.deny();}
 }
 private void hideOffline(){if(offline!=null){root.removeView(offline);offline=null;}web.setVisibility(View.VISIBLE);}
 private void showOffline(){
  if(offline!=null)return;web.setVisibility(View.GONE);offline=new LinearLayout(this);offline.setOrientation(LinearLayout.VERTICAL);offline.setGravity(android.view.Gravity.CENTER);offline.setPadding(40,40,40,40);offline.setBackgroundColor(Color.rgb(9,9,11));
  TextView title=new TextView(this);title.setText("Нет подключения");title.setTextColor(Color.WHITE);title.setTextSize(24);offline.addView(title);
  TextView text=new TextView(this);text.setText("Проверьте интернет и попробуйте снова.");text.setTextColor(Color.LTGRAY);text.setTextSize(15);text.setGravity(17);text.setPadding(0,20,0,32);offline.addView(text);
  Button retry=new Button(this);retry.setText("Повторить");retry.setOnClickListener(v->{hideOffline();web.loadUrl(URL);});offline.addView(retry);root.addView(offline,new FrameLayout.LayoutParams(-1,-1));
 }
 private void goBack(){web.evaluateJavascript("(function(){var close=document.querySelector('[role=dialog] [aria-label=\"Закрыть камеру\"], [role=dialog] [aria-label=\"Закрыть заметки\"], [role=dialog] button[aria-label=\"Закрыть\"]');if(close){close.click();return true;}return false;})()",result->{if(!"true".equals(result)){if(web.canGoBack())web.goBack();else finish();}});}
 @Override public void onBackPressed(){goBack();}
 @Override protected void onSaveInstanceState(Bundle state){web.saveState(state);super.onSaveInstanceState(state);}
 @Override protected void onPause(){CookieManager.getInstance().flush();super.onPause();}
 @Override protected void onDestroy(){if(cameraRequest!=null){cameraRequest.deny();cameraRequest=null;}root.removeAllViews();web.destroy();super.onDestroy();}
}
