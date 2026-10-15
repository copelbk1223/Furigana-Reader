package com.reader.app;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                // Return true so Android does not kill the entire host process with SIGKILL
                if (webView != null) {
                    webView.post(() -> {
                        try {
                            recreate();
                        } catch (Exception ignored) {}
                    });
                }
                return true;
            }
        });

        super.onCreate(savedInstanceState);
    }
}
