package com.faust275.courseplanner.plugin

/**
 * 把吃饭照片存进系统相册（Pictures/CoursePlanner/）。
 * ----------------------------------------------------------
 * 为什么需要它：照片原本只躺在 App 自己的 IndexedDB 里，用户看不见、
 * 也带不走（备份刻意不含照片）。写进相册才是用户真正能管的东西——
 * 能翻、能分享、能跟着 iCloud / Google Photos 一起走。
 *
 * Android 10+ 用 MediaStore 写公共相册，不需要任何存储权限；
 * Android 9 及以下写公共目录必须申请 WRITE_EXTERNAL_STORAGE，
 * 这里不弹权限，退回 App 专属目录并回 legacy=true 让界面如实说明。
 */
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "SaveToGallery")
class SaveToGalleryPlugin : Plugin() {

    @PluginMethod
    fun saveImage(call: PluginCall) {
        val b64 = call.getString("base64")
        if (b64.isNullOrEmpty()) {
            call.reject("图片内容为空")
            return
        }
        val rawName = call.getString("name") ?: ("cp-meal-" + System.currentTimeMillis() + ".jpg")
        val name = rawName.replace(Regex("[^A-Za-z0-9._\\-]"), "_")

        val bytes: ByteArray
        try {
            bytes = Base64.decode(b64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("图片数据无法解码", e)
            return
        }
        if (bytes.isEmpty()) {
            call.reject("图片内容为空")
            return
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CoursePlanner")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: run { call.reject("无法在相册创建图片"); return }
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                call.resolve(JSObject().put("ok", true).put("legacy", false)
                    .put("path", "相册/CoursePlanner/" + name))
            } else {
                val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "CoursePlanner")
                dir.mkdirs()
                val f = File(dir, name)
                f.writeBytes(bytes)
                call.resolve(JSObject().put("ok", true).put("legacy", true)
                    .put("path", f.absolutePath))
            }
        } catch (e: Exception) {
            call.reject("保存失败：" + (e.message ?: e.javaClass.simpleName), e)
        }
    }
}
