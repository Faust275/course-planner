package com.faust275.courseplanner.bridge

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import com.faust275.courseplanner.widget.WidgetData
import java.io.File

/**
 * 网页侧通过 window.AndroidBridge.pushSnapshot(json) 调用本方法。
 * 把快照写入 App 私有文件，并通过包级广播通知所有尺寸规格的桌面小组件（1x2 / 2x2 / 1x4 / 2x4）立即刷新。
 */
class DataBridge(private val context: Context) {

    @JavascriptInterface
    fun pushSnapshot(json: String) {
        try {
            val file = File(context.filesDir, WidgetData.FILE_NAME)
            file.writeText(json)

            val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                setPackage(context.packageName)
            }
            context.sendBroadcast(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
