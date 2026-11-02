package com.faust275.courseplanner.plugin

import android.content.Context
import com.faust275.courseplanner.MainActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * 真·后台健康同步（WorkManager 周期任务）
 * -------------------------------------
 * 设计目标：把「拉取 Health Connect 的睡眠 / 每日活动量 / 锻炼记录 → 落盘到 Store」
 * 不再绑死在「用户手动打开 App」，而是按 15 分钟间隔（WorkManager 允许的最小间隔）
 * 自动触发一次既有同步链路。
 *
 * 现实约束（与 HANDOFF 评估结论一致，性价比权衡后的取舍）：
 *  - 本 App 的健康数据落盘逻辑（Store.addSleep / addMetrics / addWorkouts）在 JS 侧，
 *    必须在 WebView 存活时才能执行；因此 Worker 仅在「App 进程存活（前台，或被系统缓存的后台）」
 *    时通过 MainActivity 持有的 WebView 触发既有的 HealthConnect.autoSync() + persistAllToStore()。
 *  - 进程被回收后的「纯后台读取」需要受限权限 READ_HEALTH_DATA_IN_BACKGROUND，
 *    且该权限在未经 Google Play 审核前等价于前台读取；国内 ROM 对后台保活普遍不友好。
 *    故进程死亡时 Worker 直接 no-op，真正的数据同步顺延到下一次 App 启动时的既有 autoSync()。
 *  - READ_HEALTH_DATA_IN_BACKGROUND 已在 Manifest 声明，但完整生效需通过 Google Play 审核，
 *    否则仅作为「声明」存在，不改变上述行为。
 */
class HealthSyncWorker(
    private val appContext: Context,
    private val params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            // 1) 先确认 Health Connect 可用；不可用直接成功（无需同步，也不重试）
            val status = HealthConnectClient.getSdkStatus(appContext)
            if (status != HealthConnectClient.SDK_AVAILABLE) {
                return Result.success()
            }

            // 2) 取 MainActivity 持有的「存活 WebView」；进程已被回收则为 null → no-op
            val webView = MainActivity.getSyncWebView()
            if (webView == null) {
                // 进程未存活：不在后台伪造数据，交给下次启动时的 autoSync() 补齐
                return Result.success()
            }

            // 3) 在主线程驱动既有 JS 同步链路（fire-and-forget，不阻塞 Worker 线程）
            //    仅当 HealthConnect / persistAllToStore 存在时才执行，环境缺失时静默跳过。
            val js = (
                "try{" +
                "if(window.HealthConnect&&HealthConnect.autoSync){" +
                "HealthConnect.autoSync().then(function(ok){" +
                "if(ok&&HealthConnect.persistAllToStore){" +
                "HealthConnect.persistAllToStore({toastOnSleepAdd:false});" +
                "}" +
                "});" +
                "}" +
                "}catch(e){}"
            )
            webView.post {
                try {
                    webView.evaluateJavascript(js, null)
                } catch (_: Exception) {
                    // WebView 已销毁等瞬时异常：忽略，下一轮周期再试
                }
            }

            Result.success()
        } catch (e: Exception) {
            // 瞬时异常（如 Health Connect 临时不可用）→ 让 WorkManager 重试一次
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_NAME = "health-sync-periodic"
        private const val PREFS = "cp_sync_prefs"
        private const val KEY_ENABLED = "background_sync_enabled"

        /**
         * 是否启用后台同步。默认开启；用户可在设置页关闭。
         * 用 SharedPreferences 持久化，使开关跨 App 重启依然有效（否则每次启动都重新登记、覆盖用户选择）。
         */
        fun isEnabled(context: Context): Boolean {
            val sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return sp.getBoolean(KEY_ENABLED, true)
        }

        /**
         * 持久化开关并登记 / 取消周期任务。这是设置页开关的调用入口：
         * 开启 → 登记 15 分钟周期任务；关闭 → 取消（进程存活时也停止后台拉取）。
         */
        fun setEnabled(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENABLED, enabled)
                .apply()
            if (enabled) schedule(context) else cancel(context)
        }

        /** 注册 / 刷新 15 分钟周期的后台同步任务（幂等：重复调用只会更新，不会叠加） */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES)
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        /** 取消后台同步（设置里提供开关时调用） */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME)
        }
    }
}
