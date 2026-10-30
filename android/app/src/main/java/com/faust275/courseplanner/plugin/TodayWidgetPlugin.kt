package com.faust275.courseplanner.plugin

import com.faust275.courseplanner.bridge.DataBridge
import com.faust275.courseplanner.widget.WidgetMutations
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "TodayWidget")
class TodayWidgetPlugin : Plugin() {
    @PluginMethod
    fun update(call: PluginCall) {
        val json = call.getString("json") ?: call.getString("snapshot") ?: ""
        if (json.isNotEmpty()) {
            DataBridge(context).pushSnapshot(json)
        }
        val ret = JSObject()
        ret.put("ok", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun pushSnapshot(call: PluginCall) {
        update(call)
    }

    @PluginMethod
    fun getPendingWidgetMutations(call: PluginCall) {
        val mutations = WidgetMutations.consumePending(context)
        val arr = JSArray()
        for (m in mutations) {
            val item = JSObject()
            item.put("id", m.optString("id"))
            item.put("done", m.optBoolean("done"))
            item.put("timestamp", m.optLong("timestamp"))
            item.put("version", m.optLong("version"))
            arr.put(item)
        }
        val ret = JSObject()
        ret.put("mutations", arr)
        call.resolve(ret)
    }
}
