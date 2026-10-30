package com.faust275.courseplanner.widget

import com.faust275.courseplanner.R
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.time.LocalTime

/**
 * 为小组件里的 ListView 提供今日课程列表项。
 * RemoteViewsService 在独立进程中运行，从 WidgetData 读取快照并按系统当前时刻标记课程状态。
 */
class CourseWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return CourseViewFactory(applicationContext, intent)
    }
}

class CourseViewFactory(
    private val context: Context,
    intent: Intent
) : RemoteViewsService.RemoteViewsFactory {

    private val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0)
    private var courses: List<CourseItem> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        courses = WidgetData.load(context)?.courses ?: emptyList()
    }

    override fun onDestroy() {
        courses = emptyList()
    }

    override fun getCount(): Int = courses.size

    override fun getViewAt(position: Int): RemoteViews {
        val c = courses.getOrNull(position)
            ?: return RemoteViews(context.packageName, R.layout.widget_list_item)
        val rv = RemoteViews(context.packageName, R.layout.widget_list_item)
        val now = LocalTime.now()
        val nowHm = String.format("%02d:%02d", now.hour, now.minute)
        val isOngoing = c.start.isNotEmpty() && c.end.isNotEmpty() && c.start <= nowHm && nowHm <= c.end
        val isDone = c.end.isNotEmpty() && c.end < nowHm
        rv.setTextViewText(R.id.item_start, if (isOngoing) "▶ ${c.start}" else c.start)
        val loc = if (c.location.isNotEmpty()) " · ${c.location}" else ""
        val statusSuffix = if (isOngoing) " [上课中]" else if (isDone) " [已结束]" else ""
        rv.setTextViewText(R.id.item_name, c.name + loc + statusSuffix)
        // 点击课程项 → 同样打开 App
        val fill = Intent()
        rv.setOnClickFillInIntent(R.id.item_root, fill)
        return rv
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
}
