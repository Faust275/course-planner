package com.faust275.courseplanner.plugin

/**
 * 把备份文件写到系统「下载」目录（Downloads/CoursePlanner/）。
 * ----------------------------------------------------------
 * 为什么要它：WebView 里触发下载只能落到 App 私有目录，用户根本找不到；
 * 一旦换机/卸载，备份等于不存在。Android 10+ 用 MediaStore 写入公共下载目录，
 * 不需要任何存储权限；Android 9 及以下退回 App 专属外部目录（无需权限）。
 *
 * 只负责「落盘」，内容由 JS 生成（Store.exportJSON），密钥剥离逻辑仍在 JS 侧。
 */
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "BackupExport")
class BackupExportPlugin : Plugin() {

    @PluginMethod
    fun saveToDownloads(call: PluginCall) {
        val content = call.getString("content")
        if (content.isNullOrEmpty()) {
            call.reject("备份内容为空")
            return
        }
        val rawName = call.getString("name") ?: ("course-planner-" + System.currentTimeMillis() + ".json")
        val name = rawName.replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fa5]"), "_")

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/CoursePlanner")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: run { call.reject("无法创建文件"); return }
                resolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                call.resolve(JSObject().put("ok", true)
                    .put("path", "下载/CoursePlanner/" + name))
            } else {
                val dir = File(
                    context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    "CoursePlanner"
                )
                dir.mkdirs()
                val f = File(dir, name)
                f.writeText(content, Charsets.UTF_8)
                call.resolve(JSObject().put("ok", true)
                    .put("path", f.absolutePath))
            }
        } catch (e: Exception) {
            call.reject("保存失败：" + (e.message ?: e.javaClass.simpleName), e)
        }
    }
}
