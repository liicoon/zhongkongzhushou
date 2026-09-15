// background.js — Service Worker
// 跨标签页消息路由：bridge.js (任意标签页) → 找到中控页 → 转发 → 回传结果

// 支持的中控台页面（chrome.tabs.query 的 url 支持模式数组）
var CONTROL_URLS = [
  "https://buyin.jinritemai.com/dashboard/live/control*",
  "https://eos.douyin.com/livesite/live/current*",
];

// 监听来自 bridge.js content script 的消息
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.action || msg._zkbInternal) return false;

  // 找到中控页 tab
  chrome.tabs.query({ url: CONTROL_URLS }, function (tabs) {
    if (!tabs || tabs.length === 0) {
      sendResponse({ success: false, error: "中控页面未打开" });
      return;
    }

    // 取第一个匹配的 tab，转发消息到 content.js
    chrome.tabs.sendMessage(tabs[0].id, msg, function (response) {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message,
        });
      } else {
        sendResponse(response);
      }
    });
  });

  return true; // 异步响应
});
