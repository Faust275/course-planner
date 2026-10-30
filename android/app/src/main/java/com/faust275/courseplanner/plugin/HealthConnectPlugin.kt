package com.faust275.courseplanner.plugin

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
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
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 健康联动（Android Health Connect）插件（Kotlin 实现）
 * --------------------------------------------------
 * 读取系统级 Health Connect 中的睡眠会话（SleepSessionRecord）、日常活动量与运动会话（ExerciseSessionRecord）。
 * 支持状态诊断（isAvailable）、一键打开系统 Health Connect 权限设置页（openSettings），
 * 以及读取手环同步的锻炼记录（readWorkouts）。
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val STAGE_AWAKE = 1
    private val STAGE_OUT_OF_BED = 3
    private val STAGE_LIGHT = 4
    private val STAGE_DEEP = 5
    private val STAGE_REM = 6

    private var hcClient: HealthConnectClient? = null
    private var hcStatus: Int = -1
    private var lastError: String? = null
    private var permissionLauncher: ActivityResultLauncher<Set<String>>? = null
    private var pendingPermissionCall: PluginCall? = null

    override fun load() {
        refreshStatus()
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
            lastError = e.message
        }
    }

    private fun refreshStatus() {
        val ctx: Context = context
        try {
            hcStatus = HealthConnectClient.getSdkStatus(ctx)
            hcClient = if (hcStatus == HealthConnectClient.SDK_AVAILABLE) {
                HealthConnectClient.getOrCreate(ctx)
            } else {
                null
            }
        } catch (e: Exception) {
            hcClient = null
            lastError = e.message
        }
    }

    private fun statusLabel(code: Int): String {
        return when (code) {
            HealthConnectClient.SDK_AVAILABLE -> "可用"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "需安装或更新 Health Connect"
            HealthConnectClient.SDK_UNAVAILABLE -> "当前系统不支持 Health Connect"
            else -> "未知状态($code)"
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        if (hcClient == null) refreshStatus()
        val ret = JSObject()
        ret.put("available", hcClient != null)
        ret.put("status", hcStatus)
        ret.put("statusLabel", statusLabel(hcStatus))
        if (lastError != null) ret.put("error", lastError)
        call.resolve(ret)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val ret = JSObject()
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            ret.put("opened", true)
            call.resolve(ret)
        } catch (e: Exception) {
            try {
                val manageIntent = HealthConnectClient.getHealthConnectManageDataIntent(context)
                manageIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(manageIntent)
                ret.put("opened", true)
                call.resolve(ret)
            } catch (_: Exception) {
                try {
                    val market = Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=com.google.android.apps.healthdata")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(market)
                    ret.put("opened", true)
                    call.resolve(ret)
                } catch (e2: Exception) {
                    ret.put("opened", false)
                    ret.put("error", e.message ?: "无法打开 Health Connect 设置")
                    call.resolve(ret)
                }
            }
        }
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        if (hcClient == null) refreshStatus()
        val client = hcClient
        if (client == null) {
            call.reject("Health Connect 不可用：${statusLabel(hcStatus)}")
            return
        }
        val launcher = permissionLauncher
        if (launcher == null) {
            call.reject("当前环境无法发起授权，请尝试从系统设置开启 Health Connect 权限")
            return
        }
        val perms = setOf(
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class)
        )
        pendingPermissionCall = call
        activity.runOnUiThread { launcher.launch(perms) }
    }

    @PluginMethod
    fun readSleep(call: PluginCall) {
        if (hcClient == null) refreshStatus()
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
                val records = readAll(client, SleepSessionRecord::class, start, end)
                val sessions = JSArray()
                for (r in records) {
                    val sStart = r.startTime
                    val sEnd = r.endTime
                    val zs = sStart.atZone(zone)
                    val ze = sEnd.atZone(zone)
                    var awakeMin = 0L
                    var lightMin = 0L
                    var deepMin = 0L
                    var remMin = 0L
                    var awakenings = 0
                    for (st in r.stages) {
                        val dur = Duration.between(st.startTime, st.endTime).toMinutes().coerceAtLeast(0L)
                        when (st.stage) {
                            STAGE_AWAKE, STAGE_OUT_OF_BED -> {
                                awakeMin += dur
                                if (dur > 0) awakenings += 1
                            }
                            STAGE_LIGHT -> lightMin += dur
                            STAGE_DEEP -> deepMin += dur
                            STAGE_REM -> remMin += dur
                        }
                    }
                    val inBed = Duration.between(sStart, sEnd).toMinutes().coerceAtLeast(0L)
                    var totalMin = inBed - awakeMin
                    if (totalMin <= 0) totalMin = inBed

                    val s = JSObject()
                    s.put("startTime", sStart.toString())
                    s.put("endTime", sEnd.toString())
                    s.put("date", ze.toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE))
                    s.put("start", String.format("%02d:%02d", zs.hour, zs.minute))
                    s.put("end", String.format("%02d:%02d", ze.hour, ze.minute))
                    s.put("totalMinutes", totalMin)
                    s.put("awakeMinutes", awakeMin)
                    if (deepMin > 0) s.put("deepMinutes", deepMin)
                    if (lightMin > 0) s.put("lightMinutes", lightMin)
                    if (remMin > 0) s.put("remMinutes", remMin)
                    if (awakenings > 0) s.put("awakenings", awakenings)
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

    @PluginMethod
    fun readMetrics(call: PluginCall) {
        if (hcClient == null) refreshStatus()
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

    @PluginMethod
    fun readWorkouts(call: PluginCall) {
        if (hcClient == null) refreshStatus()
        val client = hcClient
        if (client == null) {
            val empty = JSObject()
            empty.put("workouts", JSArray())
            call.resolve(empty)
            return
        }
        val days = (call.getInt("days", 14) ?: 14).coerceIn(1, 60)
        val zone = ZoneId.systemDefault()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val end = Instant.now()
                val start = end.minus(Duration.ofDays(days.toLong()))
                val records = readAll(client, ExerciseSessionRecord::class, start, end)
                val workouts = JSArray()
                for (r in records) {
                    val zs = r.startTime.atZone(zone)
                    val ze = r.endTime.atZone(zone)
                    val dur = Duration.between(r.startTime, r.endTime).toMinutes().coerceAtLeast(1L)
                    val w = JSObject()
                    w.put("date", zs.toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE))
                    w.put("start", String.format("%02d:%02d", zs.hour, zs.minute))
                    w.put("end", String.format("%02d:%02d", ze.hour, ze.minute))
                    w.put("durationMinutes", dur)
                    w.put("exerciseType", r.exerciseType.toString())
                    if (!r.title.isNullOrBlank()) w.put("title", r.title)
                    workouts.put(w)
                }
                val ret = JSObject()
                ret.put("workouts", workouts)
                activity.runOnUiThread { call.resolve(ret) }
            } catch (e: Exception) {
                val empty = JSObject()
                empty.put("workouts", JSArray())
                activity.runOnUiThread { call.resolve(empty) }
            }
        }
    }

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
