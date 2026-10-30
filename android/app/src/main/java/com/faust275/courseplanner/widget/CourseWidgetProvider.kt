package com.faust275.courseplanner.widget

import com.faust275.courseplanner.R
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/**
 * 桌面小组件基类（默认 2×4 完整日程看板）及 1×2 / 2×2 / 1×4 多尺寸 Provider 实现。
 * 支持桌面直接勾选完成待办（后台免拉起 App 闭环），并记录脏标记供前台消费。
 */
open class CourseWidgetProvider : AppWidgetProvider() {

    /** 子类可重写以指定各自尺寸的布局；默认使用 2×4 完整看板。 */
    protected open val layoutRes: Int = R.layout.widget_layout

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) updateAppWidget(context, appWidgetManager, id, layoutRes)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_TOGGLE_TODO) {
            val todoId = intent.getStringExtra("todo_id") ?: ""
            if (todoId.isNotEmpty()) {
                val snap = WidgetData.load(context)
                val curDone = snap?.nextTodo?.done ?: false
                val newDone = !curDone
                // 1. 记入版本化 Mutation Log
                WidgetMutations.recordToggle(context, todoId, newDone)
                // 2. 本地快照就地更新状态
                WidgetData.updateTodoStatus(context, todoId, newDone)
                // 3. 通知全部多尺寸小组件实例刷新视图（免拉起 App 跨尺寸同步）
                val mgr = AppWidgetManager.getInstance(context)
                val providers = listOf(
                    CourseWidgetProvider::class.java to R.layout.widget_layout,
                    CourseWidgetProv1x2A::class.java to R.layout.widget_layout_1x2,
                    CourseWidgetProv2x2B::class.java to R.layout.widget_layout_2x2,
                    CourseWidgetProv1x4C::class.java to R.layout.widget_layout_1x4
                )
                for ((cls, layout) in providers) {
                    val cn = ComponentName(context, cls)
                    val ids = mgr.getAppWidgetIds(cn)
                    for (id in ids) {
                        updateAppWidget(context, mgr, id, layout)
                    }
                }
            }
            return
        }

        if (intent.action == AppWidgetManager.ACTION_APPWIDGET_UPDATE) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, this.javaClass))
            onUpdate(context, mgr, ids)
        }
    }

    companion object {
        const val ACTION_TOGGLE_TODO = "com.faust275.courseplanner.ACTION_TOGGLE_TODO"

        /** 快照不是今天的（跨午夜后 App 没再打开过）：标题和课程都可能过期。 */
        private fun isStale(snap: WidgetSnapshot): Boolean =
            snap.today.isNotEmpty() && snap.today != LocalDate.now().toString()

        private fun computeDynamicHeaderTitle(snap: WidgetSnapshot): String {
            if (isStale(snap)) return "打开 App 同步今日课程"
            if (snap.courses.isEmpty()) return "今日无课"
            val now = LocalTime.now()
            val nowHm = String.format("%02d:%02d", now.hour, now.minute)
            val ongoing = snap.courses.firstOrNull { c ->
                c.start.isNotEmpty() && c.end.isNotEmpty() && c.start <= nowHm && nowHm <= c.end
            }
            if (ongoing != null) {
                return "上课中 · ${ongoing.name}"
            }
            val nextCourse = snap.courses
                .filter { c -> c.start.isNotEmpty() && c.start > nowHm }
                .minByOrNull { c -> c.start }
            if (nextCourse != null) {
                return "下节 ${nextCourse.start} · ${nextCourse.name}"
            }
            return "今日课程已结束"
        }

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            layoutRes: Int = R.layout.widget_layout
        ) {
            val views = RemoteViews(context.packageName, layoutRes)
            val snap = WidgetData.load(context)

            if (snap != null) {
                views.setTextViewText(R.id.widget_title, computeDynamicHeaderTitle(snap))
                views.setTextViewText(
                    R.id.widget_date,
                    if (isStale(snap)) "数据停在 ${snap.today} · 打开 App 同步"
                    else "${snap.weekday} · ${snap.today}"
                )
            } else {
                views.setTextViewText(R.id.widget_title, "课程规划助手")
                views.setTextViewText(R.id.widget_date, "打开 App 一次以同步")
            }

            val serviceIntent = Intent(context, CourseWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = android.net.Uri.parse("widget://course/$appWidgetId")
            }
            views.setRemoteAdapter(R.id.widget_list, serviceIntent)
            views.setEmptyView(R.id.widget_list, R.id.widget_empty)

            val todo = snap?.nextTodo
            val exam = snap?.nextExam
            if (todo != null) {
                val isDone = todo.done
                views.setTextViewText(R.id.todo_label, if (isDone) "✓ 已完成待办" else "下一个待办")
                val remain = when (todo.remainDays) {
                    null -> ""
                    0 -> "今天"
                    1 -> "明天"
                    else -> "${todo.remainDays} 天后"
                }
                views.setTextViewText(R.id.todo_title, if (isDone) "✓ ${todo.title}" else todo.title)
                views.setTextViewText(R.id.todo_remain, if (isDone) "已达成" else remain)

                // 绑定免拉起桌面打勾 Intent
                if (todo.id.isNotEmpty()) {
                    val toggleIntent = Intent(context, CourseWidgetProvider::class.java).apply {
                        action = ACTION_TOGGLE_TODO
                        putExtra("todo_id", todo.id)
                    }
                    val toggleFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                    else PendingIntent.FLAG_UPDATE_CURRENT
                    val pendingToggle = PendingIntent.getBroadcast(
                        context,
                        todo.id.hashCode(),
                        toggleIntent,
                        toggleFlags
                    )
                    views.setOnClickPendingIntent(R.id.todo_label, pendingToggle)
                    views.setOnClickPendingIntent(R.id.todo_remain, pendingToggle)
                }
            } else if (exam != null && exam.date.isNotEmpty()) {
                views.setTextViewText(R.id.todo_label, "近期考试")
                val days = try {
                    ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(exam.date)).toInt()
                } catch (_: Exception) { null }
                val remain = when {
                    days == null -> exam.date
                    days <= 0 -> "今天"
                    days == 1 -> "明天"
                    else -> "${days} 天后"
                }
                views.setTextViewText(R.id.todo_title, exam.name)
                views.setTextViewText(R.id.todo_remain, remain)
            } else {
                views.setTextViewText(R.id.todo_label, "待办事项")
                views.setTextViewText(R.id.todo_title, "暂无待办")
                views.setTextViewText(R.id.todo_remain, "")
            }

            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            else PendingIntent.FLAG_UPDATE_CURRENT
            val pending = PendingIntent.getActivity(context, 0, launch, flags)
            views.setOnClickPendingIntent(R.id.widget_root, pending)

            // 绑定课程列表项点击进入 App 的 PendingIntentTemplate，激活 ListView 点击响应
            val listClickFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            else PendingIntent.FLAG_UPDATE_CURRENT
            val listClickPending = PendingIntent.getActivity(context, 1001, launch, listClickFlags)
            views.setPendingIntentTemplate(R.id.widget_list, listClickPending)

            appWidgetManager.updateAppWidget(appWidgetId, views)
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list)
        }
    }
}

/** 1×2 迷你胶囊小组件（1行×2列） */
class CourseWidgetProv1x2A : CourseWidgetProvider() {
    override val layoutRes: Int = R.layout.widget_layout_1x2
}

/** 2×2 紧凑方卡小组件（2行×2列） */
class CourseWidgetProv2x2B : CourseWidgetProvider() {
    override val layoutRes: Int = R.layout.widget_layout_2x2
}

/** 1×4 横向通栏小组件（1行×4列） */
class CourseWidgetProv1x4C : CourseWidgetProvider() {
    override val layoutRes: Int = R.layout.widget_layout_1x4
}
