package io.github.bloom79.casatrova;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.os.SystemClock;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.net.URISyntaxException;

/**
 * CasaTrova as an installable app: a full-screen WebView on the live site,
 * so listings refresh every morning without reinstalling. Pages under
 * /summerhome stay in the app; everything else (Rightmove, ESPC, maps…)
 * opens in the browser.
 */
public class MainActivity extends Activity {

    private static final String HOST = "bloom79.github.io";
    private static final String PATH = "/summerhome";
    private static final String HOME = "https://" + HOST + PATH + "/";
    private static final long STALE_MS = 3L * 60 * 60 * 1000;
    private static final int REQ_LOCATION = 1;

    private static final String OFFLINE_HTML =
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        + "<body style='margin:0;font-family:sans-serif;background:#0f5f66;color:#fff;"
        + "display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
        + "<div><div style='font-size:52px'>🏠</div><h2>Nessuna connessione</h2>"
        + "<p style='opacity:.85'>CasaTrova ha bisogno di internet per caricare gli annunci.</p>"
        + "<a href='" + HOME + "' style='display:inline-block;margin-top:12px;padding:12px 28px;"
        + "background:#fff;color:#0f5f66;border-radius:24px;font-weight:600;text-decoration:none'>Riprova</a>"
        + "</div></body>";

    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private long loadedAt;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(s.getUserAgentString() + " CasaTrovaApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return route(r.getUrl());
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    v.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "utf-8", null);
                }
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (url != null && url.startsWith("https://")) loadedAt = SystemClock.elapsedRealtime();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocation()) {
                    cb.invoke(origin, true, false);
                } else {
                    geoOrigin = origin;
                    geoCallback = cb;
                    requestPermissions(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
                }
            }

            // target="_blank" and window.open land here: catch the URL in a
            // throwaway WebView and route it like any other link.
            @Override
            public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, Message msg) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    private boolean handled;

                    private void take(WebView p, Uri u) {
                        if (handled || u == null || "about".equals(u.getScheme())) return;
                        handled = true;
                        if (isInternal(u)) web.loadUrl(u.toString()); else openExternal(u);
                        p.stopLoading();
                        p.post(p::destroy);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView p, WebResourceRequest r) {
                        take(p, r.getUrl());
                        return true;
                    }

                    @Override
                    public void onPageStarted(WebView p, String url, android.graphics.Bitmap icon) {
                        if (url != null) take(p, Uri.parse(url));
                    }
                });
                ((WebView.WebViewTransport) msg.obj).setWebView(popup);
                msg.sendToTarget();
                return true;
            }
        });

        web.setDownloadListener((url, ua, cd, mime, len) -> openExternal(Uri.parse(url)));

        if (state != null) {
            web.restoreState(state);
        } else {
            Uri link = getIntent().getData();
            web.loadUrl(link != null && isInternal(link) ? link.toString() : HOME);
        }
    }

    private boolean route(Uri u) {
        if (isInternal(u)) return false;
        openExternal(u);
        return true;
    }

    private static boolean isInternal(Uri u) {
        String path = u.getPath();
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost())
            && path != null && path.startsWith(PATH);
    }

    private void openExternal(Uri u) {
        try {
            Intent i;
            if ("intent".equals(u.getScheme())) {
                i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE);
            }
            startActivity(i);
        } catch (ActivityNotFoundException | URISyntaxException e) {
            Toast.makeText(this, "Impossibile aprire il link", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_LOCATION || geoCallback == null) return;
        boolean granted = false;
        for (int r : results) granted |= r == PackageManager.PERMISSION_GRANTED;
        geoCallback.invoke(geoOrigin, granted, false);
        geoCallback = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri link = intent.getData();
        if (link != null && isInternal(link)) web.loadUrl(link.toString());
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        // Listings change every morning: reload a page left open for hours.
        if (loadedAt > 0 && SystemClock.elapsedRealtime() - loadedAt > STALE_MS) web.reload();
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
