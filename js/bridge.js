// bridge.js — 跨标签页桥接 content script (运行在所有页面)
// 任意标签页 → window.__ZKB__ → bridge-inject.js → bridge.js → background → 中控页

(function () {
  "use strict";

  // 中控页不需要这个桥接（content.js 已处理）
  //   buyin.jinritemai.com/dashboard/live/control  抖音直播中控台
  //   eos.douyin.com/livesite/live/current         抖音团购中控台
  var _zkbHost = window.location.host;
  var _zkbPath = window.location.pathname || "";
  if (
    (_zkbHost === "buyin.jinritemai.com" && _zkbPath.indexOf("/dashboard/live/control") === 0) ||
    (_zkbHost === "eos.douyin.com" && _zkbPath.indexOf("/livesite/live/current") === 0)
  ) {
    return;
  }

  // 注入 bridge-inject.js 到页面上下文（创建 window.__ZKB__）
  var s = document.createElement("script");
  s.src = chrome.runtime.getURL("js/bridge-inject.js");
  s.onload = function () { s.remove(); };
  (document.head || document.documentElement).appendChild(s);

  // 监听来自页面 (bridge-inject.js) 的调用请求
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.source !== "zkb-call") return;

    // 转发给 background → 中控页
    chrome.runtime.sendMessage(
      { action: e.data.action, params: e.data.params || {} },
      function (response) {
        // 把结果回传给页面
        window.postMessage(
          { source: "zkb-response", id: e.data.id, result: response },
          "*"
        );
      }
    );
  });
})();
