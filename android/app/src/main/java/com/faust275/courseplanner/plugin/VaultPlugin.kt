package com.faust275.courseplanner.plugin

/**
 * 指纹解锁备份密码（可选能力）
 * ----------------------------------------------------------
 * 备份本身仍然用密码加密（AES-GCM），这里只负责：
 *   1. 把「备份密码」用 Android Keystore 的认证型密钥加密后存本机；
 *   2. 每次导出/导入加密备份时，用系统指纹/面容确认后取出密码。
 *
 * 密钥 setUserAuthenticationRequired(true)：没有生物识别就解不开，
 * 换机、删指纹都会失效（失效后要求重新输入密码）。
 * 平台 BiometricPrompt（API 28+），不引入 androidx.biometric 依赖。
 */
import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@CapacitorPlugin(name = "Vault")
class VaultPlugin : Plugin() {

    companion object {
        private const val ALIAS = "cp_vault_key"
        private const val PREFS = "cp_vault"
        private const val KEY_IV = "iv"
        private const val KEY_DATA = "data"
        private const val B64 = Base64.NO_WRAP
    }

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun hasHardware(): Boolean {
        val pm = context.packageManager
        return pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT) ||
            pm.hasSystemFeature(PackageManager.FEATURE_FACE) ||
            pm.hasSystemFeature(PackageManager.FEATURE_IRIS)
    }

    private fun deviceSecure(): Boolean {
        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return km?.isDeviceSecure == true
    }

    private fun supported(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && hasHardware() && deviceSecure()

    /** 当前设备能不能用指纹解锁备份密码 */
    @PluginMethod
    fun available(call: PluginCall) {
        val ok = supported()
        call.resolve(
            JSObject()
                .put("biometric", ok)
                .put("stored", prefs().contains(KEY_DATA))
                .put("reason", if (ok) "" else "设备不支持指纹/面容，或没有设置锁屏密码")
        )
    }

    /** 用指纹确认后，把备份密码加密存到本机 */
    @PluginMethod
    fun save(call: PluginCall) {
        val password = call.getString("password")
        if (password.isNullOrEmpty()) {
            call.reject("密码为空")
            return
        }
        if (!supported()) {
            call.reject("当前设备不支持指纹解锁")
            return
        }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            prompt(cipher, call, "启用指纹解锁备份") { c ->
                val data = c.doFinal(password.toByteArray(Charsets.UTF_8))
                prefs().edit()
                    .putString(KEY_IV, Base64.encodeToString(c.iv, B64))
                    .putString(KEY_DATA, Base64.encodeToString(data, B64))
                    .apply()
                call.resolve(JSObject().put("ok", true))
            }
        } catch (e: Exception) {
            call.reject("无法创建本机密钥：" + (e.message ?: e.javaClass.simpleName), e)
        }
    }

    /** 指纹确认后取出备份密码（没有存过就返回空） */
    @PluginMethod
    fun get(call: PluginCall) {
        if (!prefs().contains(KEY_DATA)) {
            call.resolve(JSObject().put("password", null))
            return
        }
        if (!supported()) {
            call.reject("当前设备不支持指纹解锁")
            return
        }
        try {
            val iv = Base64.decode(prefs().getString(KEY_IV, "") ?: "", B64)
            val data = Base64.decode(prefs().getString(KEY_DATA, "") ?: "", B64)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            prompt(cipher, call, "解锁备份密码") { c ->
                try {
                    val plain = String(c.doFinal(data), Charsets.UTF_8)
                    call.resolve(JSObject().put("password", plain))
                } catch (e: Exception) {
                    clearStored()
                    call.reject("解锁失败（指纹可能已变更），请重新设置", e)
                }
            }
        } catch (e: Exception) {
            clearStored()
            call.reject("解锁失败，请重新设置备份密码", e)
        }
    }

    /** 清除本机保存的密码与密钥 */
    @PluginMethod
    fun clear(call: PluginCall) {
        clearStored()
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS)
        } catch (e: Exception) { /* 忽略 */ }
        call.resolve(JSObject().put("ok", true))
    }

    private fun clearStored() {
        try { prefs().edit().remove(KEY_IV).remove(KEY_DATA).apply() } catch (e: Exception) { /* 忽略 */ }
    }

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val builder = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }
        gen.init(builder.build())
        return gen.generateKey()
    }

    /** 弹系统生物识别框，成功后把「已授权的 Cipher」交给回调 */
    private fun prompt(cipher: Cipher, call: PluginCall, title: String, onOk: (Cipher) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("需要 Android 9 及以上")
            return
        }
        val act = activity
        if (act == null) {
            call.reject("当前没有界面上下文")
            return
        }
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        // 平台 API 要 Executor（不是 Handler），把回调都排到主线程
        val executor = java.util.concurrent.Executor { r -> handler.post(r) }
        val cancel = CancellationSignal()
        var settled = false
        val prompt = BiometricPrompt.Builder(act)
            .setTitle(title)
            .setNegativeButton("取消", executor) { _, _ ->
                if (!settled) {
                    settled = true
                    call.reject("已取消")
                }
            }
            .build()
        act.runOnUiThread {
            prompt.authenticate(
                BiometricPrompt.CryptoObject(cipher),
                cancel,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (settled) return
                        settled = true
                        val c = result.cryptoObject?.cipher
                        if (c == null) {
                            call.reject("认证结果异常")
                            return
                        }
                        try {
                            onOk(c)
                        } catch (e: Exception) {
                            call.reject("操作失败：" + (e.message ?: ""), e)
                        }
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (settled) return
                        settled = true
                        call.reject(errString.toString())
                    }

                    override fun onAuthenticationFailed() {
                        // 单次识别失败允许重试，不在这里结算
                    }
                }
            )
        }
    }
}
