// background.js — Service Worker
// 跨标签页消息路由：bridge.js (任意标签页) → 找到中控页 → 转发 → 回传结果

// 支持的中控台页面（chrome.tabs.query 的 url 支持模式数组）
var CONTROL_URLS = [
  "https://buyin.jinritemai.com/dashboard/live/control*",
  "https://eos.douyin.com/livesite/live/current*",
  "https://fxg.jinritemai.com/ffa/content-tool/live/control*",
  // 视频号：弹幕页与商品页是两个独立页面。两个都列进来，
  // 跨页链路（弹幕页面板 → 商品页执行讲解）靠这里的 tabs.query 找目标页。
  "https://channels.weixin.qq.com/platform/live/liveBuild*",
  "https://channels.weixin.qq.com/platform/live/commodity/onsale/index*",
];

var WX_HOST = "channels.weixin.qq.com";
var WX_COMMENT_RE = /\/platform\/live\/liveBuild/;
var WX_GOODS_RE = /\/platform\/live\/commodity\/onsale\/index/;
// 商品页的直达 URL：视频号商品页可以直接打开，不需要先有标签页当跳板
var WX_GOODS_URL = "https://channels.weixin.qq.com/platform/live/commodity/onsale/index";

// 哪些动作属于「商品侧」——视频号必须发到商品页，发到弹幕页会静默失败
// （页面在、动作不认识、10s 后才超时，很难查）
var GOODS_ACTIONS = ["explain", "cancel_explain", "explain_start", "explain_stop", "list_products"];

/**
 * 选目标 tab。
 * ⚠️ 不能简单地取 tabs[0]：视频号两个页面都开着时，tabs[0] 可能是弹幕页，
 *    把「讲解」指令发过去 = 静默失败。所以顺序是：
 *    ① 用**发送方所在站点**先分组（弹幕页发来的指令，只该派给同站点的页）
 *    ② 视频号内再按"动作属于哪一侧"选页
 * 其它三个站点是单页全能 → 行为与以前一致（取同族第一个）。
 */
function pickTargetTab(senderTab, tabs, action, params) {
  if (!tabs || tabs.length === 0) return null;
  var senderUrl = (senderTab && senderTab.url) || "";
  var senderIsWx = senderUrl.indexOf(WX_HOST) !== -1;
  var sameFamily = tabs.filter(function (t) {
    return ((t.url || "").indexOf(WX_HOST) !== -1) === senderIsWx;
  });
  if (!senderIsWx) return sameFamily[0] || tabs[0] || null;
  // params.side 是显式提示：有些动作（如 get_status 轮询商品页的运行状态）
  // 名字上看不出属于哪一侧，靠调用方点名更可靠
  var wantGoods = GOODS_ACTIONS.indexOf(action) !== -1 || (params && params.side === "goods");
  var re = wantGoods ? WX_GOODS_RE : WX_COMMENT_RE;
  for (var i = 0; i < sameFamily.length; i++) {
    if (re.test(sameFamily[i].url || "")) return sameFamily[i];
  }
  return null;   // 视频号：缺那一侧 → 交给调用方决定要不要自动打开
}

// 视频号商品页缺页时自动补开（后台打开、不抢焦点），等它真的"能应答"再转发指令。
// 为什么不直接开完就发：content script 是 document_end 注入、inject.js 还延时 500ms，
// 立刻发必然打空 → 表现是"页面明明开了却没反应"。所以按"能否应答"轮询。
function openGoodsTabAndSend(msg, sendResponse) {
  chrome.tabs.create({ url: WX_GOODS_URL, active: false }, function (tab) {
    if (chrome.runtime.lastError || !tab || tab.id == null) {
      sendResponse({ success: false, error: "无法打开视频号商品页：" + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || "未知原因") });
      return;
    }
    var tries = 0;
    (function ping() {
      tries++;
      chrome.tabs.sendMessage(tab.id, { action: "get_status", params: {} }, function (r) {
        var err = chrome.runtime.lastError;   // 必须读一下，否则控制台报 Unchecked runtime.lastError
        if (!err && r) {
          chrome.tabs.sendMessage(tab.id, msg, function (resp) {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse(resp);
            }
          });
          return;
        }
        if (tries >= 30) {   // 约 15s
          sendResponse({ success: false, error: "商品页已打开但仍未就绪（可能未登录或加载失败）" });
          return;
        }
        setTimeout(ping, 500);
      });
    })();
  });
}

// 监听来自 bridge.js / content.js 的消息
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.action || msg._zkbInternal) return false;

  chrome.tabs.query({ url: CONTROL_URLS }, function (tabs) {
    if (!tabs || tabs.length === 0) {
      sendResponse({ success: false, error: "中控页面未打开" });
      return;
    }

    var target = pickTargetTab(sender.tab, tabs, msg.action, msg.params);

    // 视频号缺商品页：只有「启动自动讲解」才替他打开（主人选的"自动后台打开并接管"）。
    // 其余商品侧动作（如列表轮询）**不自动开页** —— 否则一打开弹幕页的讲解 tab
    // 就会自己蹦出个标签页，"按需弹出"退化成"开页即弹"。
    if (!target && msg.action === "explain_start") {
      openGoodsTabAndSend(msg, sendResponse);
      return;
    }
    if (!target) {
      sendResponse({ success: false, error: "目标中控页面未打开（视频号请确认对应页面已开启）" });
      return;
    }

    chrome.tabs.sendMessage(target.id, msg, function (response) {
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
