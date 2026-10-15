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

// 把 chrome.tabs.sendMessage 的原始报错翻成"能直接照做"的话。
// 最常见的两种都不是本次消息的问题，而是**环境状态**问题：
//   ① receiving end does not exist —— 目标页没加载扩展脚本（典型：扩展刚重新加载过，
//      但目标页没刷新 → 旧 content script 已失效、新脚本未注入）
//   ② Extension context invalidated —— 本脚本(background)所属的扩展实例已失效
// 这两种等多久都等不回来，必须直接告诉用户"去刷新页面"。
function friendlyTabErr(raw) {
  var msg = String(raw || "");
  if (/receiving end does not exist|could not establish connection/i.test(msg)) {
    return "目标页没有应答（该页未加载扩展脚本）—— 扩展可能刚重新加载过，请刷新目标页面后重试";
  }
  if (/context invalidated/i.test(msg)) {
    return "扩展已重新加载，本脚本已失效 —— 请刷新页面后重试";
  }
  return msg || "未知错误";
}

function isNoReceiverErr(msg) {
  return /receiving end does not exist|could not establish connection/i.test(String(msg || ""));
}

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
  var wantGoods = isWxGoodsSide(action, params);
  var re = wantGoods ? WX_GOODS_RE : WX_COMMENT_RE;
  for (var i = 0; i < sameFamily.length; i++) {
    if (re.test(sameFamily[i].url || "")) return sameFamily[i];
  }
  return null;   // 视频号：缺那一侧 → 交给调用方决定要不要自动打开
}

// 目标页「商品已就绪」再发指令。判据 = 能应答 **且** 目标页自己实时扫到了商品
// （productCount > 0 —— 由 inject.js 的 get_status 现场扫描得到，不是读缓存）。
// maxTries 决定等多久（间隔 1s）。
function waitGoodsReadyAndSend(tabId, msg, sendResponse, maxTries) {
  var tries = 0;
  var answered = 0;     // 累计"能应答"次数
  var noReceiver = 0;   // 累计"连接收端都没有"次数
  (function ping() {
    tries++;
    chrome.tabs.sendMessage(tabId, { action: "get_status", params: {} }, function (r) {
      var err = chrome.runtime.lastError;   // 必须读一下，否则控制台报 Unchecked runtime.lastError
      // ⚠️ 这里**不能**因为"没有接收端"就立刻放弃：目标页是刚 create 出来的新标签页时，
      //    冷启动前几次 ping 必然拿到 Receiving end does not exist（content script 还没注入）
      //    —— 那正是本函数要等的场景（tests/verify-bg-wxch.mjs【4】组钉着这条）。
      //    所以只**记账**，等收口时再用它区分病因（"页面没加载脚本" vs "有脚本但没商品"）。
      if (err && isNoReceiverErr(err.message)) noReceiver++;
      else if (!err) answered++;
      if (!err && r && r.success && r.productCount > 0) {
        chrome.tabs.sendMessage(tabId, msg, function (resp) {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: friendlyTabErr(chrome.runtime.lastError.message) });
          } else {
            sendResponse(resp);
          }
        });
        return;
      }
      // 间隔 1s（不是 500ms）：目标页 scanProducts() 带 1s 结果缓存，
      // 问得比缓存还快就拿不到新数据 → 永远看不到"商品刚渲染出来"的那一刻。
      if (tries >= maxTries) {
        if (answered === 0 && noReceiver > 0) {
          // 从头到尾没人应答 = 目标页上根本没有可用的扩展脚本。等多久都不会好，
          // 最可能的原因就是"扩展刚重新加载，但这个页面没刷新"（2026-10-12 真机踩到，
          // 页面上残留的旧 content script 调 chrome.* 会抛 Extension context invalidated）。
          sendResponse({
            success: false,
            error: friendlyTabErr("Receiving end does not exist."),
          });
          return;
        }
        sendResponse({
          success: false,
          error: "商品页在，但一直没读到商品（已等约 " + maxTries + "s）：可能未登录 / " +
            "这场直播没有商品 / 商品列表还没渲染出来。请切到商品页确认列表里有没有商品行",
        });
        return;
      }
      setTimeout(ping, 1000);
    });
  })();
}

// 视频号商品页缺页时自动补开（后台打开、不抢焦点），等它真的"**能干活**"再转发指令。
//
// ⚠️ 判据必须是「商品已就绪」，**不能**是「能应答」——2026-10-12 真机实测踩到，
//    两个坑叠在一起，表现极难查：
//     ① content script 一注入就能应答（那时 Vue 应用还没渲染出商品表格）；
//     ② content.js 的 10s 超时回包是 {success:false, error:"timeout (10s)"}，
//        它是个 truthy 对象，原来的 `!err && r` 会把它当成"就绪"。
//    → explain_start 打在空列表上 → 目标页 scanProducts() 返回 0 →
//      AutoExplain.start 第一行就 return（running 保持 false）→
//      弹幕页只看到「启动失败：目标页未能启动」，而商品页**不建面板、日志静默**，
//      一条线索都留不下。
//    正确判据 = 目标页能应答 **且** 它自己实时扫到了商品（productCount > 0）。
function openGoodsTabAndSend(msg, sendResponse) {
  chrome.tabs.create({ url: WX_GOODS_URL, active: false }, function (tab) {
    if (chrome.runtime.lastError || !tab || tab.id == null) {
      sendResponse({ success: false, error: "无法打开视频号商品页：" + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || "未知原因") });
      return;
    }
    // 冷启动要加载整个微前端 + Vue 应用 + 拉商品接口 → 给足 25s
    waitGoodsReadyAndSend(tab.id, msg, sendResponse, 25);
  });
}

// 某个动作是否属于「视频号商品侧」
function isWxGoodsSide(action, params) {
  return GOODS_ACTIONS.indexOf(action) !== -1 || (params && params.side === "goods");
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

    // ⚠️ 目标页「存在」≠「可用」（2026-10-12 真机**第二次**踩到同一个坑的另一半）：
    //    "等就绪"原来只加在「缺页自动打开」那条路上 → **已经打开**的商品页
    //    （用户手动开的，或上一次点击开出来、还留在那儿的）会被**直接转发**；
    //    此时 Vue 可能还没渲染出商品表 → 目标页扫到 0 个商品 → 启动失败。
    //    实测日志正好印证：报的是「目标页扫到 0 个商品」，**不是**「等 25s 没读到商品」
    //    —— 说明压根没走等待路径。
    //    这里对已存在的商品页也等，但只等 8s（页面已经在加载了；8s 还扫不到商品，
    //    基本就是这场真没有商品，让用户早点看到结论）。
    //    只对 explain_start 等：list_products 是面板"瞄一眼"，不该卡 8 秒。
    if (msg.action === "explain_start" && target.url && WX_GOODS_RE.test(target.url)) {
      waitGoodsReadyAndSend(target.id, msg, sendResponse, 8);
      return;
    }

    chrome.tabs.sendMessage(target.id, msg, function (response) {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: friendlyTabErr(chrome.runtime.lastError.message),
        });
      } else {
        sendResponse(response);
      }
    });
  });

  return true; // 异步响应
});
