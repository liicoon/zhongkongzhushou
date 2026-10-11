/**
 * zkb-client.js — 中控助手跨标签页 SDK
 *
 * 用法（三选一）：
 *
 * 1. 直接引入（扩展已安装时自动可用）：
 *    <script src="zkb-client.js"></script>
 *    ZKB.ready().then(() => ZKB.explain(0))
 *
 * 2. ES Module import：
 *    import ZKB from "./zkb-client.js"
 *    await ZKB.ready()
 *    await ZKB.explain(0)
 *
 * 3. 不引入此文件，直接用原生 API（扩展注入的）：
 *    await window.__ZKB__.explain(0)
 *
 * 前提：Chrome 已安装"直播中控小助手"扩展，且中控台页面已打开。
 */

(function (global) {
  "use strict";

  if (global.ZKB && global.ZKB.__sdk) return; // 防止重复加载

  var READY_TIMEOUT = 10000; // 等待 API 就绪的超时时间 (ms)
  var CALL_TIMEOUT = 15000; // 单次调用超时 (ms)

  // ---- 内部工具 ----

  function getApi() {
    return global.__ZKB__ || null;
  }

  /**
   * 等待 window.__ZKB__ 注入完成（扩展加载后自动注入到所有页面）
   * @param {number} timeout 超时毫秒，默认 10s
   * @returns {Promise<void>} 就绪后 resolve；超时 reject
   */
  function ready(timeout) {
    timeout = timeout || READY_TIMEOUT;
    var api = getApi();
    if (api) return Promise.resolve();

    return new Promise(function (resolve, reject) {
      var start = Date.now();
      var timer = setInterval(function () {
        if (getApi()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error("ZKB API 等待超时，请确认扩展已安装且启用"));
        }
      }, 200);
    });
  }

  /**
   * 检查 API 是否已就绪（同步）
   */
  function isReady() {
    return !!getApi();
  }

  /**
   * 包装调用：自动检查 API 可用性 + 超时 + 错误归一化
   */
  function wrapCall(fnName) {
    return function () {
      var api = getApi();
      if (!api) {
        return Promise.reject({
          success: false,
          error: "ZKB API 未就绪，请确认扩展已安装且中控台页面已打开",
        });
      }

      var args = Array.prototype.slice.call(arguments);

      // 超时保护
      var timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () {
          reject({ success: false, error: "调用超时 (" + CALL_TIMEOUT + "ms)" });
        }, CALL_TIMEOUT);
      });

      var callPromise = api[fnName].apply(api, args);

      return Promise.race([callPromise, timeoutPromise]).then(function (result) {
        if (result && result.success === false) {
          throw result; // 业务错误也走 catch
        }
        return result;
      });
    };
  }

  // ---- 事件系统 ----

  var listeners = {};

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(function (fn) {
      return fn !== callback;
    });
  }

  function emit(event, data) {
    var fns = listeners[event] || [];
    for (var i = 0; i < fns.length; i++) {
      try {
        fns[i](data);
      } catch (e) {
        console.error("[ZKB] 事件回调异常:", e);
      }
    }
  }

  // ---- 轮询状态变化（可选） ----

  var pollTimer = null;
  var lastStatus = null;

  /**
   * 启动状态轮询，检测到变化时触发 "statuschange" 事件
   * @param {number} interval 轮询间隔，默认 3s
   */
  function startStatusPolling(interval) {
    stopStatusPolling();
    interval = interval || 3000;
    pollTimer = setInterval(function () {
      if (!isReady()) return;
      getStatus().then(function (result) {
        if (result && result.success) {
          var snapshot = JSON.stringify(result);
          if (lastStatus && snapshot !== lastStatus) {
            emit("statuschange", result);
          }
          lastStatus = snapshot;
        }
      }).catch(function () {});
    }, interval);
  }

  function stopStatusPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---- API 方法 ----

  var api = {
    __sdk: true,
    version: "1.0.0",

    // 生命周期
    ready: ready,
    isReady: isReady,

    // 事件
    on: on,
    off: off,
    startStatusPolling: startStatusPolling,
    stopStatusPolling: stopStatusPolling,

    // 业务接口（全部返回 Promise）
    /**
     * 获取商品列表
     * @returns {Promise<{success, count, products: [{index, id, name, price, stock}]}>}
     */
    listProducts: wrapCall("listProducts"),

    /**
     * 讲解指定商品
     * @param {number} index 商品序号 (0-based)
     * @returns {Promise<{success, index, name, action}>}
     */
    explain: wrapCall("explain"),

    /**
     * 取消讲解指定商品
     * @param {number} index 商品序号 (0-based)
     * @returns {Promise<{success}>}
     */
    cancelExplain: wrapCall("cancelExplain"),

    /**
     * 发送弹幕
     * @param {string} text 弹幕内容
     * @returns {Promise<{success, text}>}
     */
    comment: wrapCall("comment"),

    /**
     * 获取运行状态
     * @returns {Promise<{success, autoExplainRunning, autoCommentRunning, ...}>}
     */
    getStatus: wrapCall("getStatus"),
  };

  global.ZKB = api;
})(typeof window !== "undefined" ? window : this);

// ES Module export
if (typeof module !== "undefined" && module.exports) {
  module.exports = window.ZKB;
}
