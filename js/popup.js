document.addEventListener("DOMContentLoaded", function () {
  var status = document.getElementById("status");
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    var url = tabs[0].url || "";
    var isBuyin = url.indexOf("buyin.jinritemai.com/dashboard/live/control") !== -1;
    var isEos = url.indexOf("eos.douyin.com/livesite/live/current") !== -1;
    var isFxg = url.indexOf("fxg.jinritemai.com/ffa/content-tool/live/control") !== -1;
    // 视频号是两个页面：面板只在弹幕页；商品页不建面板，但加载待命、接收弹幕页的跨页指令
    var isWxComment = url.indexOf("channels.weixin.qq.com/platform/live/liveBuild") !== -1;
    var isWxGoods = url.indexOf("channels.weixin.qq.com/platform/live/commodity/onsale/index") !== -1;
    if (isBuyin || isEos || isFxg || isWxComment || isWxGoods) {
      status.textContent = isEos
        ? "✅当前在抖音团购中控台，面板已注入"
        : (isFxg
          ? "✅当前在抖店直播中控台，面板已注入"
          : (isWxComment
            ? "✅当前在视频号弹幕页，面板已注入"
            : (isWxGoods
              ? "ℹ️当前是视频号商品页（讲解由弹幕页控制，本页已待命）"
              : "✅当前在抖音直播中控台，面板已注入")));
      status.style.color = isWxGoods ? "#1677ff" : "#52c41a";
    } else {
      status.textContent = "⚠️请打开抖音/抖店/团购中控台，或视频号直播中控台";
      status.style.color = "#faad14";
    }
  });
  document.getElementById("reload").onclick = function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) { chrome.tabs.reload(tabs[0].id); window.close(); }
    });
  };
});
