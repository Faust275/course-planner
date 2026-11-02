package com.faust275.courseplanner;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;
import com.faust275.courseplanner.plugin.HealthConnectPlugin;
import com.faust275.courseplanner.plugin.TodayWidgetPlugin;
import com.faust275.courseplanner.plugin.NotifyPlugin;
import com.faust275.courseplanner.plugin.BackupExportPlugin;
import com.faust275.courseplanner.plugin.VaultPlugin;
import com.faust275.courseplanner.plugin.HealthSyncWorker;
import com.faust275.courseplanner.bridge.DataBridge;
import android.os.Bundle;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    private static final String EXTRA_ROUTE = "cp_route";

    /**
     * 存活的 WebView 句柄（供 WorkManager 后台同步任务 HealthSyncWorker 在进程存活时驱动既有
     * 的 JS 同步链路）。进程销毁时置空，避免泄漏；onResume 时刷新。
     */
    private static volatile WebView sSyncWebView = null;

    /** 供 HealthSyncWorker 读取当前存活的 WebView（进程回收后返回 null） */
    public static WebView getSyncWebView() {
        return sSyncWebView;
    }

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

        // 注册 15 分钟周期的健康后台同步（WorkManager 跨重启自动保留，幂等）。
        // 尊重设置页开关：用户若关闭过，SharedPreferences 里为 false，则不登记。
        if (HealthSyncWorker.isEnabled(this)) {
            HealthSyncWorker.schedule(this);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // WebView 在 Capacitor 启动后才会就绪，这里兜底刷新句柄，确保后台同步能取到
        if (getBridge() != null && getBridge().getWebView() != null) {
            sSyncWebView = getBridge().getWebView();
        }
    }

    @Override
    public void onDestroy() {
        sSyncWebView = null;
        super.onDestroy();
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
