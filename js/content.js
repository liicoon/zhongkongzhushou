(function () {
  "use strict";

  // ====================== 注入脚本 ======================
  function injectScript(url) {
    var s = document.createElement("script");
    s.src = chrome.runtime.getURL(url);
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }

  function injectCSS(url) {
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = chrome.runtime.getURL(url);
    document.head.appendChild(l);
  }

  var HOST = window.location.host;
  var PATH = window.location.pathname || "";

  // Supported consoles:
  //   buyin.jinritemai.com/dashboard/live/control      抖音直播中控台
  //   eos.douyin.com/livesite/live/current             抖音团购中控台
  //   fxg.jinritemai.com/ffa/content-tool/live/control 抖店直播中控台（与 buyin 同源）
  // (manifest matches already restrict this script — double-check here so a
  // future manifest change cannot silently widen the blast radius.)
  // 注意用 pathname（不含 ? 查询串）判断：抖店入口 URL 常带 btm_* 埋点参数，
  // 那些参数每次点击都不同，不能参与站点判断。
  var SUPPORTED =
    (HOST === "buyin.jinritemai.com" && PATH.indexOf("/dashboard/live/control") === 0) ||
    (HOST === "eos.douyin.com" && PATH.indexOf("/livesite/live/current") === 0) ||
    (HOST === "fxg.jinritemai.com" && PATH.indexOf("/ffa/content-tool/live/control") === 0);

  if (SUPPORTED) {
    injectCSS("css/panel.css");
    injectScript("js/probe.js");
    // inject.js 延时加载，让 probe 先运行收集信息
    setTimeout(function () {
      injectScript("js/inject.js");
    }, 500);

    // ====================== 跨标签页消息桥接 ======================
    // background.js (onMessageExternal) → content.js → inject.js (window.postMessage)
    // inject.js 执行后通过 window.postMessage 回传结果，content.js 再 sendResponse
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.action) return false;

      var reqId = "zkb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

      // 转发给 inject.js
      window.postMessage({
        source: "zkb-bridge",
        id: reqId,
        action: msg.action,
        params: msg.params || {},
      }, "*");

      // 监听 inject.js 的回复
      function onResp(e) {
        if (e.data && e.data.source === "zkb-response" && e.data.id === reqId) {
          window.removeEventListener("message", onResp);
          sendResponse(e.data.result);
        }
      }
      window.addEventListener("message", onResp);

      // 10 秒超时
      setTimeout(function () {
        window.removeEventListener("message", onResp);
        sendResponse({ success: false, error: "timeout (10s)" });
      }, 10000);

      return true; // 异步响应
    });
  }
})();
