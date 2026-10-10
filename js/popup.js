document.addEventListener("DOMContentLoaded", function () {
  var status = document.getElementById("status");
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    var url = tabs[0].url || "";
    var isBuyin = url.indexOf("buyin.jinritemai.com/dashboard/live/control") !== -1;
    var isEos = url.indexOf("eos.douyin.com/livesite/live/current") !== -1;
    var isFxg = url.indexOf("fxg.jinritemai.com/ffa/content-tool/live/control") !== -1;
    if (isBuyin || isEos || isFxg) {
      status.textContent = isEos
        ? "✅当前在抖音团购中控台，面板已注入"
        : (isFxg
          ? "✅当前在抖店直播中控台，面板已注入"
          : "✅当前在抖音直播中控台，面板已注入");
      status.style.color = "#52c41a";
    } else {
      status.textContent = "⚠️请打开抖音直播中控台、抖店中控台或团购中控台";
      status.style.color = "#faad14";
    }
  });
  document.getElementById("reload").onclick = function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) { chrome.tabs.reload(tabs[0].id); window.close(); }
    });
  };
});
