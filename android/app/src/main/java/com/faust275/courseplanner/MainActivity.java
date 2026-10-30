package com.faust275.courseplanner;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;
import com.faust275.courseplanner.plugin.HealthConnectPlugin;
import com.faust275.courseplanner.plugin.TodayWidgetPlugin;
import com.faust275.courseplanner.plugin.NotifyPlugin;
import com.faust275.courseplanner.plugin.BackupExportPlugin;
import com.faust275.courseplanner.plugin.VaultPlugin;
import com.faust275.courseplanner.bridge.DataBridge;
import android.os.Bundle;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    private static final String EXTRA_ROUTE = "cp_route";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册健康联动、桌面小组件与原生系统闹钟通知插件
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(TodayWidgetPlugin.class);
        registerPlugin(NotifyPlugin.class);
        registerPlugin(BackupExportPlugin.class);
        registerPlugin(VaultPlugin.class);
        super.onCreate(savedInstanceState);

        // 注入桌面小组件数据同步桥（window.AndroidBridge.pushSnapshot）
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.addJavascriptInterface(new DataBridge(this), "AndroidBridge");
        }
        applyRoute(getIntent());
    }

    /** 已经打开时再点通知：singleTask 会走这里，而不是重新启动 Activity */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyRoute(intent);
    }

    /**
     * 通知里带的 cp_route → 打开对应页面（上课提醒进课表，待办到期进待办）。
     * 路由白名单只放行字母，避免把外部传入的字符串拼进 JS。
     */
    private void applyRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra(EXTRA_ROUTE);
        if (route == null || !route.matches("[a-z]{1,20}")) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final String js = "try{window.App&&App.go('" + route + "');}catch(e){}";
        // 冷启动时 WebView 里的 App 还没初始化，稍等再执行；WebView 本身会在主线程排队
        getBridge().getWebView().postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(js, null);
                    }
                } catch (Exception ignored) {
                }
            }
        }, 1200);
    }
}
