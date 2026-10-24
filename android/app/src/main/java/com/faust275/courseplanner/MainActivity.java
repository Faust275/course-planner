package com.faust275.courseplanner;

import com.getcapacitor.BridgeActivity;
import com.faust275.courseplanner.plugin.HealthConnectPlugin;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 注册健康联动（Health Connect）原生插件
        registerPlugin(HealthConnectPlugin.class);
    }
}
