package com.faust275.courseplanner.plugin

import android.content.Context
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.response.ReadRecordsResponse
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * 健康联动（Android Health Connect）插件（Kotlin 实现）
 * --------------------------------------------------
 * connect-client 的 API 基于 Kotlin 协程，因此本插件用 Kotlin 编写。
 * 读取系统级 Health Connect 中的睡眠会话（SleepSessionRecord）。
 * 小米运动健康 / 小米手环若开启了「同步到 Health Connect」，其睡眠记录会出现在这里，
 * 无需截图即可一键导入。
 *
 * Health Connect 的 SleepSessionRecord 只细分「清醒 / 离床」阶段，
 * 深睡 / 浅睡 / REM 一般不被写入，故回调仅回传 date/start/end/totalMinutes/awakeMinutes。
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    // 与平台契约一致的稳定值
    private val STAGE_AWAKE = 1
    private val STAGE_OUT_OF_BED = 3

    private var hcClient: HealthConnectClient? = null
    private var permissionLauncher: ActivityResultLauncher<Set<String>>? = null
    private var pendingPermissionCall: PluginCall? = null

    override fun load() {
        val ctx: Context = context
        // getOrCreate 为 suspend 且在不可用时抛异常，load() 内用 runBlocking + try/catch 判定可用性
        hcClient = try {
            runBlocking { HealthConnectClient.getOrCreate(ctx) }
        } catch (e: Exception) {
            null
        }
        try {
            permissionLauncher = activity.registerForActivityResult(
                PermissionController.createRequestPermissionResultContract()
            ) { granted ->
                val ret = JSObject()
                ret.put("granted", granted.isNotEmpty())
                pendingPermissionCall?.resolve(ret)
                pendingPermissionCall = null
            }
        } catch (e: Exception) {
            permissionLauncher = null
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val ret = JSObject()
        ret.put("available", hcClient != null)
        call.resolve(ret)
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        val client = hcClient
        if (client == null) {
            call.reject("Health Connect 不可用，请先在应用商店安装 Health Connect")
            return
        }
        val launcher = permissionLauncher
        if (launcher == null) {
            call.reject("当前环境无法发起授权，请尝试升级或重启 Health Connect")
            return
        }
        val perms = setOf(
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class)
        )
        pendingPermissionCall = call
        activity.runOnUiThread { launcher.launch(perms) }
    }

    @PluginMethod
    fun readSleep(call: PluginCall) {
        val client = hcClient
        if (client == null) {
            call.reject("Health Connect 不可用")
            return
        }
        val days = (call.getInt("days", 14) ?: 14).coerceIn(1, 60)
        val zone = ZoneId.systemDefault()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val end = Instant.now()
                val start = end.minus(Duration.ofDays(days.toLong()))
                val req = ReadRecordsRequest(
                    recordType = SleepSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start, end)
                )
                val resp = client.readRecords(req)
                val sessions = JSArray()
                for (r in resp.records) {
                    val sStart = r.startTime
                    val sEnd = r.endTime
                    val zs = sStart.atZone(zone)
                    val ze = sEnd.atZone(zone)
                    var awakeMin = 0L
                    for (st in r.stages) {
                        val t = st.stage
                        if (t == STAGE_AWAKE || t == STAGE_OUT_OF_BED) {
                            awakeMin += Duration.between(st.startTime, st.endTime).toMinutes()
                        }
                    }
                    val inBed = Duration.between(sStart, sEnd).toMinutes()
                    var totalMin = inBed - awakeMin
                    if (totalMin < 0) totalMin = inBed

                    val s = JSObject()
                    s.put("startTime", sStart.toString())
                    s.put("endTime", sEnd.toString())
                    s.put("date", zs.toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE))
                    s.put("start", String.format("%02d:%02d", zs.hour, zs.minute))
                    s.put("end", String.format("%02d:%02d", ze.hour, ze.minute))
                    s.put("totalMinutes", totalMin)
                    s.put("awakeMinutes", awakeMin)
                    sessions.put(s)
                }
                val ret = JSObject()
                ret.put("sessions", sessions)
                activity.runOnUiThread { call.resolve(ret) }
            } catch (e: Exception) {
                activity.runOnUiThread { call.reject(e.message, e) }
            }
        }
    }

    /**
     * 读取近 days 天的每日活动量汇总（步数 / 活动消耗卡路里 / 距离）。
     *
     * 说明：connect-client 1.1.0 的聚合工厂（AggregateMetric）是 internal 的，
     * 直接调不到，所以这里用 readRecords 逐条读、按本地日期自己累加。
     * 分页由 pageToken 循环处理，避免默认页大小截断。
     */
    @PluginMethod
    fun readMetrics(call: PluginCall) {
        val client = hcClient
        if (client == null) {
            call.reject("Health Connect 不可用")
            return
        }
        val days = (call.getInt("days", 14) ?: 14).coerceIn(1, 60)
        val zone = ZoneId.systemDefault()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val end = Instant.now()
                val start = end.minus(Duration.ofDays(days.toLong()))

                val steps = HashMap<String, Long>()
                val cals = HashMap<String, Double>()
                val dists = HashMap<String, Double>()

                for (r in readAll(client, StepsRecord::class, start, end)) {
                    val k = r.startTime.atZone(zone).toLocalDate().toString()
                    steps[k] = (steps[k] ?: 0L) + r.count
                }
                for (r in readAll(client, ActiveCaloriesBurnedRecord::class, start, end)) {
                    val k = r.startTime.atZone(zone).toLocalDate().toString()
                    cals[k] = (cals[k] ?: 0.0) + r.energy.inKilocalories
                }
                for (r in readAll(client, DistanceRecord::class, start, end)) {
                    val k = r.startTime.atZone(zone).toLocalDate().toString()
                    dists[k] = (dists[k] ?: 0.0) + r.distance.inMeters
                }

                val keys = LinkedHashSet<String>()
                keys.addAll(steps.keys); keys.addAll(cals.keys); keys.addAll(dists.keys)

                val arr = JSArray()
                for (k in keys.sorted()) {
                    val s = JSObject()
                    s.put("date", k)
                    s.put("steps", steps[k] ?: 0L)
                    s.put("calories", Math.round(cals[k] ?: 0.0))
                    s.put("distance", Math.round(dists[k] ?: 0.0))
                    arr.put(s)
                }
                val ret = JSObject()
                ret.put("days", arr)
                activity.runOnUiThread { call.resolve(ret) }
            } catch (e: Exception) {
                activity.runOnUiThread { call.reject(e.message, e) }
            }
        }
    }

    /** 读全一段时间内的所有记录（自动翻页），供 readMetrics 累加用 */
    private suspend fun <T : Record> readAll(
        client: HealthConnectClient,
        type: kotlin.reflect.KClass<T>,
        start: Instant,
        end: Instant
    ): List<T> {
        val out = ArrayList<T>()
        var token: String? = null
        do {
            val resp: ReadRecordsResponse<T> = client.readRecords(
                ReadRecordsRequest(
                    recordType = type,
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                    pageToken = token
                )
            )
            out.addAll(resp.records)
            token = resp.pageToken
        } while (token != null)
        return out
    }
}
