(function () {
  "use strict";

  // ====================== chrome.* 报错的人话化 + 防刷屏 ======================
  // 典型场景：扩展重新加载（开发时改一行就重载）后，**已打开的页面不会自动刷新** ——
  // 页面上残留的旧 content script 仍在运行，而它持有的 chrome.* 已失效：
  //   chrome.runtime.sendMessage → 同步抛 "Uncaught Error: Extension context invalidated."
  // 危害不只是控制台飘红：**回调不会执行** → 不会回 zkb-outbound-response →
  // 中控页只能干等到自己的超时（弹幕页 explain_start 是 45s）→ 表现为"点了没反应 /
  // 启动失败"，极易被误判成功能坏了（2026-10-12 真机排障时就被这条干扰过）。
  var _staleWarned = false;
  function friendlyRuntimeErr(raw) {
    var msg = String(raw || "");
    if (/context invalidated/i.test(msg)) {
      return "扩展已重新加载，本页面上的脚本已失效 —— 请刷新本页后重试（扩展更新后必须先刷新页面）";
    }
    if (/receiving end does not exist|could not establish connection/i.test(msg)) {
      return "未能连上扩展后台（background 未就绪或已被回收）—— 请刷新本页后重试";
    }
    return msg || "未知错误";
  }
  function warnStaleOnce() {
    if (_staleWarned) return;
    _staleWarned = true;
    console.warn(
      "[中控助手] 扩展已重新加载，但本页仍在跑旧脚本（chrome.* 已失效）。" +
        "请刷新本页面；在刷新前，面板里的所有操作都会失败。"
    );
  }

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
  //   channels.weixin.qq.com/platform/live/liveBuild            视频号直播中控台·弹幕页
  //   channels.weixin.qq.com/platform/live/commodity/onsale/index 视频号直播中控台·商品页
  //     ⚠️ 视频号把弹幕与商品拆成**两个独立页面**（能力不重叠），所以是**两个 path**，
  //        不能只写 /platform/live/ 这个公共前缀 —— 那会把视频号后台其它 live 子页也放进来。
  // (manifest matches already restrict this script — double-check here so a
  // future manifest change cannot silently widen the blast radius.)
  // 注意用 pathname（不含 ? 查询串）判断：抖店入口 URL 常带 btm_* 埋点参数，
  // 那些参数每次点击都不同，不能参与站点判断。
  var SUPPORTED =
    (HOST === "buyin.jinritemai.com" && PATH.indexOf("/dashboard/live/control") === 0) ||
    (HOST === "eos.douyin.com" && PATH.indexOf("/livesite/live/current") === 0) ||
    (HOST === "fxg.jinritemai.com" && PATH.indexOf("/ffa/content-tool/live/control") === 0) ||
    (HOST === "channels.weixin.qq.com" && PATH.indexOf("/platform/live/liveBuild") === 0) ||
    (HOST === "channels.weixin.qq.com" && PATH.indexOf("/platform/live/commodity/onsale/index") === 0);

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

    // ====================== 出站：中控页 → background → 另一个中控页 ======================
    // 为什么需要它：inject.js 跑在**页面上下文**，拿不到 chrome.* API，
    // 而视频号把弹幕/商品拆成两个页面 —— 弹幕页的面板必须能**主动**给商品页发指令。
    // 原来只有「外部页 → 中控页」这一个入站方向（bridge.js 在中控页会直接 return），
    // 中控页自己从来发不出去 → 这里补一条对称的出站通道。
    window.addEventListener("message", function (e) {
      if (!e.data || e.data.source !== "zkb-outbound") return;
      var outId = e.data.id;
      // ⚠️ 必须 try/catch：扩展重载后本页残留的旧脚本会让 sendMessage **同步抛**
      //    "Extension context invalidated."（见文件头的说明）。抛了就没人回包 →
      //    中控页干等到超时。这里捕获后**立刻**回一个带明确指引的失败结果。
      try {
        chrome.runtime.sendMessage(
          { action: e.data.action, params: e.data.params || {} },
          function (resp) {
            // 读一下 lastError，否则 Chrome 会在控制台报 "Unchecked runtime.lastError"
            if (chrome.runtime.lastError) {
              resp = { success: false, error: friendlyRuntimeErr(chrome.runtime.lastError.message) };
            }
            window.postMessage({ source: "zkb-outbound-response", id: outId, result: resp || null }, "*");
          }
        );
      } catch (ex) {
        warnStaleOnce();
        window.postMessage({
          source: "zkb-outbound-response",
          id: outId,
          result: { success: false, error: friendlyRuntimeErr(ex && ex.message) },
        }, "*");
      }
    });
  }
})();
