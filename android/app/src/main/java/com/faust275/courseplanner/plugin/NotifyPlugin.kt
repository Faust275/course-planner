package com.faust275.courseplanner.plugin

/**
 * 原生系统闹钟通知插件（Kotlin）
 * --------------------------------------------------
 * Web 侧 assets/js/remind.js 只能发页面内 toast，锁屏就没了。装成 App 后，
 * 同一份提醒数据改走系统闹钟：remind.js 会把未来 14 天的上课/待办到期算好，
 * 通过 Capacitor 调到这里，由 AlarmManager 精确排程，到点由 NotifyReceiver 发通知。
 *
 * 与 Web 侧的接口契约（改签名必须先改 settings.js / remind.js）：
 *   available()                  -> { notifications: Boolean, exact: Boolean }
 *   requestPermission()          -> { granted: Boolean, exact: Boolean }（Android 13+ 弹系统授权框）
 *   openSettings()               -> 跳系统「通知」设置页
 *   schedule({ items: [...] })   -> { scheduled: Int, exact: Boolean }
 *     items 元素：{ id:int, at:long(毫秒时间戳), title:String, body:String }
 *   cancelAll()                  -> { cancelled: true }
 *   notifyPermissions()          -> 同 available()，保留给老调用方
 *
 * 重启/覆盖安装后闹钟会被系统清空，BootReceiver 会读这里缓存的 items 重新排一遍。
 */
import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.provider.AlarmClock
import com.faust275.courseplanner.MainActivity
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject

/** 排程逻辑集中在这里，插件和开机接收器共用一份。 */
object NotifyScheduler {
    const val CHANNEL_ID = "cp_remind"
    const val EXTRA_TITLE = "cp_title"
    const val EXTRA_BODY = "cp_body"
    const val EXTRA_ID = "cp_id"
    const val EXTRA_ROUTE = "cp_route"
    const val ACTION_SNOOZE = "com.faust275.courseplanner.NOTIFY_SNOOZE"
    const val ACTION_DISMISS = "com.faust275.courseplanner.NOTIFY_DISMISS"
    const val ACTION_DAILY = "com.faust275.courseplanner.NOTIFY_DAILY"

    // 与 remind.js 的 1000 + n 对齐；上限放宽到 400 条以容纳 14 天窗口
    const val ID_BASE = 1000
    const val ID_MAX = 1400

    private const val PREFS = "cp_notify"
    private const val KEY_ITEMS = "items"
    private const val PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    fun alarmManager(ctx: Context): AlarmManager? =
        ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    fun notificationManager(ctx: Context): NotificationManager? =
        ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

    fun notificationsEnabled(ctx: Context): Boolean {
        val nm = notificationManager(ctx) ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) nm.areNotificationsEnabled() else true
    }

    fun canScheduleExact(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return alarmManager(ctx)?.canScheduleExactAlarms() ?: false
    }

    /** 通知渠道：Android 8+ 不建渠道，通知根本不会显示。 */
    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = notificationManager(ctx) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "上课与待办提醒", NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "课表上课提醒与待办到期提醒"
                    enableVibration(true)
                }
        )
    }

    private fun pendingIntent(ctx: Context, id: Int, title: String, body: String, route: String = ""): PendingIntent? {
        val intent = Intent(ctx, NotifyReceiver::class.java).apply {
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_BODY, body)
            putExtra(EXTRA_ROUTE, route)
        }
        return PendingIntent.getBroadcast(ctx, id, intent, PI_FLAGS)
    }

    /** 把一批提醒排进系统闹钟，返回成功排入的条数。 */
    fun schedule(ctx: Context, items: JSONArray): Int {
        val am = alarmManager(ctx) ?: return 0
        if (!notificationsEnabled(ctx)) return 0
        ensureChannel(ctx)
        val exact = canScheduleExact(ctx)
        var ok = 0
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            val id = it.optInt("id", ID_BASE + i)
            if (id < ID_BASE || id >= ID_MAX) continue
            val at = it.optLong("at", 0L)
            if (at <= System.currentTimeMillis()) continue
            val pi = pendingIntent(
                ctx, id,
                it.optString("title", "提醒"),
                it.optString("body", ""),
                it.optString("route", "")
            ) ?: continue
            try {
                if (exact) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } else {
                    // 没有精确闹钟权限时退化为窗口闹钟，保底能响
                    am.setWindow(AlarmManager.RTC_WAKEUP, at - 30_000L, 60_000L, pi)
                }
                ok++
            } catch (se: SecurityException) {
                // 个别 ROM 会限制闹钟排程，跳过这一条，别让整次同步崩掉
            }
        }
        return ok
    }

    fun cancelAll(ctx: Context) {
        val am = alarmManager(ctx) ?: return
        for (id in ID_BASE until ID_MAX) {
            val pi = pendingIntent(ctx, id, "", "") ?: continue
            try { am.cancel(pi) } catch (e: Exception) { /* 忽略 */ }
        }
    }

    fun saveItems(ctx: Context, json: String?) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ITEMS, json ?: "[]").apply()
        } catch (e: Exception) { /* 忽略 */ }
    }

    fun loadItems(ctx: Context): String? = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ITEMS, null)
    } catch (e: Exception) { null }

    /**
     * 开机 / 覆盖安装后重排：系统会清空 AlarmManager，这里从缓存把未来事件重新排一遍。
     * 过期的条目由 schedule() 自己过滤。
     */
    fun reapply(ctx: Context) {
        val raw = loadItems(ctx) ?: return
        val arr = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        if (arr.length() == 0) return
        if (!notificationsEnabled(ctx)) return
        schedule(ctx, arr)
    }

    /** 后台兜底用的重复闹钟（每 N 小时把未来 14 天重排一遍），不依赖 WorkManager */
    fun dailyPendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, DailyRescheduleReceiver::class.java).apply { action = ACTION_DAILY }
        return PendingIntent.getBroadcast(ctx, 991001, intent, PI_FLAGS)
    }
}

@CapacitorPlugin(
    name = "Notify",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")
    ]
)
class NotifyPlugin : Plugin() {

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(status())
    }

    /** 老调用方（设置页早期版本）用的名字，保留兼容。 */
    @PluginMethod
    fun notifyPermissions(call: PluginCall) {
        call.resolve(status())
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(status())
            return
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(status())
            return
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback")
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED
        if (granted) {
            // 刚授权就补排一次，用户不用再点「重排」
            NotifyScheduler.reapply(context)
        }
        val ret = status()
        ret.put("granted", granted)
        call.resolve(ret)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:" + context.packageName)
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("无法打开通知设置", e)
        }
    }

    /** 打开系统「电池优化」列表，让用户把本应用设为「不限制后台」 */
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            // 个别 ROM 没有这个页面，退回应用详情页
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:" + context.packageName)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(fallback)
                call.resolve()
            } catch (e2: Exception) {
                call.reject("无法打开电池设置", e2)
            }
        }
    }

    /** 调起系统闹钟（就寝提醒用）：优先静默创建，失败则打开系统闹钟界面让用户确认 */
    @PluginMethod
    fun setSystemAlarm(call: PluginCall) {
        val hour = call.getInt("hour")
        if (hour == null || hour < 0 || hour > 23) {
            call.reject("小时不合法")
            return
        }
        val minute = (call.getInt("minute") ?: 0).coerceIn(0, 59)
        val label = call.getString("label") ?: "就寝提醒"
        try {
            val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, hour)
                putExtra(AlarmClock.EXTRA_MINUTES, minute)
                putExtra(AlarmClock.EXTRA_MESSAGE, label)
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            try {
                val fallback = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                    putExtra(AlarmClock.EXTRA_HOUR, hour)
                    putExtra(AlarmClock.EXTRA_MINUTES, minute)
                    putExtra(AlarmClock.EXTRA_MESSAGE, label)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(fallback)
                call.resolve(JSObject().put("ok", true))
            } catch (e2: Exception) {
                call.reject("无法打开系统闹钟", e2)
            }
        }
    }

    @PluginMethod
    fun schedule(call: PluginCall) {
        val items: JSArray = call.getArray("items") ?: JSArray()
        if (!NotifyScheduler.notificationsEnabled(context)) {
            // 权限没开：把清单留着，用户去授权后 BootReceiver/下次启动还能补排
            NotifyScheduler.saveItems(context, items.toString())
            call.resolve(JSObject().put("scheduled", 0).put("skipped", true)
                .put("exact", NotifyScheduler.canScheduleExact(context)))
            return
        }
        val n = NotifyScheduler.schedule(context, items)
        NotifyScheduler.saveItems(context, items.toString())
        call.resolve(JSObject().put("scheduled", n).put("exact", NotifyScheduler.canScheduleExact(context)))
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        NotifyScheduler.cancelAll(context)
        NotifyScheduler.saveItems(context, "[]")
        call.resolve(JSObject().put("cancelled", true))
    }

    /**
     * 可选的后台兜底：每 N 小时自动重排一次系统提醒。
     * 用 setInexactRepeating 而不是 WorkManager，免得为一个兜底再拉一份依赖。
     */
    @PluginMethod
    fun setDailyReschedule(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        val hours = (call.getInt("hours") ?: 24).coerceIn(1, 168)
        val am = NotifyScheduler.alarmManager(context)
        if (am == null) {
            call.reject("AlarmManager 不可用")
            return
        }
        val pi = NotifyScheduler.dailyPendingIntent(context)
        try { am.cancel(pi) } catch (e: Exception) { /* 忽略 */ }
        if (enabled) {
            val interval = hours * 3600_000L
            try {
                am.setInexactRepeating(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + interval,
                    interval,
                    pi
                )
            } catch (e: Exception) {
                call.reject("设置失败：" + (e.message ?: ""), e)
                return
            }
        }
        call.resolve(JSObject().put("enabled", enabled).put("hours", hours))
    }

    private fun status(): JSObject = JSObject()
        .put("notifications", NotifyScheduler.notificationsEnabled(context))
        .put("exact", NotifyScheduler.canScheduleExact(context))
}

/**
 * Manifest 里声明的 .plugin.NotifyReceiver —— 闹钟到点后由它把通知发出去。
 */
class NotifyReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val nm = NotifyScheduler.notificationManager(ctx) ?: return
        val id = intent.getIntExtra(NotifyScheduler.EXTRA_ID, NotifyScheduler.ID_BASE)
        val title = intent.getStringExtra(NotifyScheduler.EXTRA_TITLE) ?: "提醒"
        val body = intent.getStringExtra(NotifyScheduler.EXTRA_BODY) ?: ""
        val route = intent.getStringExtra(NotifyScheduler.EXTRA_ROUTE) ?: ""

        // 通知上的按钮：知道了 = 直接收掉；10 分钟后再提醒 = 用同一条内容重排一次
        when (intent.action) {
            NotifyScheduler.ACTION_DISMISS -> {
                nm.cancel(id)
                return
            }
            NotifyScheduler.ACTION_SNOOZE -> {
                nm.cancel(id)
                val am = NotifyScheduler.alarmManager(ctx) ?: return
                val again = Intent(ctx, NotifyReceiver::class.java).apply {
                    putExtra(NotifyScheduler.EXTRA_ID, id)
                    putExtra(NotifyScheduler.EXTRA_TITLE, title)
                    putExtra(NotifyScheduler.EXTRA_BODY, body)
                    putExtra(NotifyScheduler.EXTRA_ROUTE, route)
                }
                val pi = PendingIntent.getBroadcast(
                    ctx, id, again,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val at = System.currentTimeMillis() + 10 * 60 * 1000L
                try {
                    if (NotifyScheduler.canScheduleExact(ctx)) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                    } else {
                        am.setWindow(AlarmManager.RTC_WAKEUP, at - 30_000L, 60_000L, pi)
                    }
                } catch (e: SecurityException) { /* 忽略 */ }
                return
            }
        }

        NotifyScheduler.ensureChannel(ctx)
        if (!NotifyScheduler.notificationsEnabled(ctx)) return

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.Notification.Builder(ctx, NotifyScheduler.CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            android.app.Notification.Builder(ctx)
        }
        // 点通知直接回 App（默认落在「今日」）
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (route.isNotEmpty()) putExtra(NotifyScheduler.EXTRA_ROUTE, route)
        }
        val pi = PendingIntent.getActivity(
            ctx, id, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        builder
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .addAction(
                android.R.drawable.ic_popup_reminder, "10 分钟后再提醒",
                actionIntent(ctx, id, NotifyScheduler.ACTION_SNOOZE, title, body, route, 1)
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel, "知道了",
                actionIntent(ctx, id, NotifyScheduler.ACTION_DISMISS, title, body, route, 2)
            )
        nm.notify(id, builder.build())
    }

    private fun actionIntent(
        ctx: Context, id: Int, action: String,
        title: String, body: String, route: String, slot: Int
    ): PendingIntent {
        val i = Intent(ctx, NotifyReceiver::class.java).apply {
            this.action = action
            putExtra(NotifyScheduler.EXTRA_ID, id)
            putExtra(NotifyScheduler.EXTRA_TITLE, title)
            putExtra(NotifyScheduler.EXTRA_BODY, body)
            putExtra(NotifyScheduler.EXTRA_ROUTE, route)
        }
        return PendingIntent.getBroadcast(
            ctx, id * 10 + slot, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}

/**
 * 开机 / 覆盖安装后重排闹钟。系统重启会清空 AlarmManager，
 * 没有这个接收器，用户重启一次手机就再也收不到提醒。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                try { NotifyScheduler.reapply(context) } catch (e: Exception) { /* 忽略 */ }
            }
        }
    }
}

/** 兜底重排的重复闹钟到点后，把缓存的提醒重新排一遍 */
class DailyRescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try { NotifyScheduler.reapply(context) } catch (e: Exception) { /* 忽略 */ }
    }
}
