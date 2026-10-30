package com.faust275.courseplanner.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class CourseItem(val start: String, val end: String, val name: String, val location: String)
data class TodoItem(
    val id: String = "",
    val title: String,
    val due: String,
    val time: String,
    val remainDays: Int?,
    val done: Boolean = false
)
data class ExamItem(val name: String, val date: String, val start: String, val location: String)

data class WidgetSnapshot(
    val updatedAt: Long,
    val today: String,
    val weekday: String,
    val courses: List<CourseItem>,
    val nextTodo: TodoItem?,
    val nextExam: ExamItem?
)

/**
 * 桌面小组件后台操作脏标记与变更事务队列 (Mutation Log)
 */
object WidgetMutations {
    private const val PREF_NAME = "widget_mutations"
    private const val KEY_MUTATIONS = "pending_mutations"
    private const val KEY_VERSION = "mutation_version"

    @Synchronized
    fun recordToggle(context: Context, todoId: String, done: Boolean): Long {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val version = prefs.getLong(KEY_VERSION, 0L) + 1
        val raw = prefs.getString(KEY_MUTATIONS, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }

        val mut = JSONObject().apply {
            put("id", todoId)
            put("done", done)
            put("timestamp", System.currentTimeMillis())
            put("version", version)
        }
        arr.put(mut)
        prefs.edit()
            .putLong(KEY_VERSION, version)
            .putString(KEY_MUTATIONS, arr.toString())
            .apply()
        return version
    }

    @Synchronized
    fun consumePending(context: Context): List<JSONObject> {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_MUTATIONS, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        val list = mutableListOf<JSONObject>()
        for (i in 0 until arr.length()) {
            list.add(arr.getJSONObject(i))
        }
        prefs.edit().putString(KEY_MUTATIONS, "[]").apply()
        return list
    }
}

/**
 * 读取 / 解析网页写入的 JSON 快照。
 * 文件位于 App 私有目录，Widget 独立进程可直接读取。
 */
object WidgetData {
    const val FILE_NAME = "widget_data.json"

    fun load(context: Context): WidgetSnapshot? {
        return try {
            val file = File(context.filesDir, FILE_NAME)
            if (!file.exists()) return null
            parse(file.readText())
        } catch (e: Exception) {
            null
        }
    }

    fun updateTodoStatus(context: Context, todoId: String, done: Boolean): Boolean {
        return try {
            val file = File(context.filesDir, FILE_NAME)
            if (!file.exists()) return false
            val o = JSONObject(file.readText())
            val todoObj = o.optJSONObject("nextTodo")
            if (todoObj != null && (todoObj.optString("id") == todoId || todoId.isEmpty())) {
                todoObj.put("done", done)
                o.put("updatedAt", System.currentTimeMillis())
                file.writeText(o.toString())
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    fun parse(json: String): WidgetSnapshot? {
        return try {
            val o = JSONObject(json)
            val courses = mutableListOf<CourseItem>()
            val arr = o.optJSONArray("courses") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val c = arr.getJSONObject(i)
                courses.add(
                    CourseItem(
                        c.optString("start"),
                        c.optString("end"),
                        c.optString("name"),
                        c.optString("location")
                    )
                )
            }

            var todo: TodoItem? = null
            o.optJSONObject("nextTodo")?.let { t ->
                val rd = if (t.has("remainDays") && !t.isNull("remainDays")) t.getInt("remainDays") else null
                todo = TodoItem(
                    t.optString("id"),
                    t.optString("title"),
                    t.optString("due"),
                    t.optString("time"),
                    rd,
                    t.optBoolean("done", false)
                )
            }

            var exam: ExamItem? = null
            o.optJSONObject("nextExam")?.let { e ->
                exam = ExamItem(
                    e.optString("name"),
                    e.optString("date"),
                    e.optString("start"),
                    e.optString("location")
                )
            }

            WidgetSnapshot(
                o.optLong("updatedAt", 0),
                o.optString("today"),
                o.optString("weekday"),
                courses,
                todo,
                exam
            )
        } catch (e: Exception) {
            null
        }
    }
}
