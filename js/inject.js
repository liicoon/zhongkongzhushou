(function () {
  "use strict";

  // ========================================================================
  //  LOGGER
  // ========================================================================
  var log = {
    _el: null,
    _buf: [],
    init: function (el) { this._el = el; this.flush(); },
    flush: function () {
      if (!this._el) return;
      for (var i = 0; i < this._buf.length; i++) this._append(this._buf[i]);
      this._buf = [];
    },
    _append: function (entry) {
      if (!this._el) return void this._buf.push(entry);
      var d = document.createElement("div");
      d.className = "log-line " + entry.level;
      var now = new Date();
      var ts = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
      d.textContent = "[" + ts + "] " + entry.msg;
      this._el.appendChild(d);
      this._el.scrollTop = this._el.scrollHeight;
      console.log("[中控助手][" + ts + "]", entry.msg);
    },
    info: function (m) { this._append({ level: "info", msg: m }); },
    ok: function (m) { this._append({ level: "success", msg: m }); },
    warn: function (m) { this._append({ level: "warn", msg: "[WARN] " + m }); },
    err: function (m) { this._append({ level: "error", msg: "[ERR] " + m }); },
  };

  // ========================================================================
  //  UTILITIES
  // ========================================================================
  var Utils = {
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },

    // trigger Vue/React synthetic input
    triggerVueInput: function (el, value) {
      if (!el) return;
      var tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") {
        // Use the correct prototype setter based on element type
        var proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, "value");
        try {
          if (setter && setter.set) setter.set.call(el, value);
          else el.value = value;
        } catch (_) {
          el.value = value;
        }
      } else {
        el.textContent = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },

    // click an element using multiple strategies
    clickEl: function (el) {
      if (!el) return false;
      try { el.click(); return true; } catch (_) {}
      try {
        var evt = new MouseEvent("click", { bubbles: true, cancelable: true });
        el.dispatchEvent(evt); return true;
      } catch (_) { return false; }
    },

    // 回车发送（keydown/keypress/keyup 三连，兼容只监听其中一种的组件）
    pressEnter: function (el) {
      if (!el) return false;
      var types = ["keydown", "keypress", "keyup"];
      for (var i = 0; i < types.length; i++) {
        try {
          el.dispatchEvent(new KeyboardEvent(types[i], {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
        } catch (_) {}
      }
      return true;
    },

    // 元素是否可见（隐藏标签页/折叠面板要能区分出来）
    isVisible: function (el) {
      if (!el) return false;
      return el.offsetParent !== null || el.getClientRects().length > 0;
    },

    // check if text matches an explain button (not "求讲解" or other false matches)
    isExplainBtnText: function (text) {
      return text === "讲解" || text === "自动讲解" || text === "取消讲解";
    },

    // parse product indices string like "1-15,18,20" → [0,1,...,14,17,19] (0-based)
    // returns null when input is empty (meaning "all products")
    parseIndices: function (str, maxCount) {
      if (!str || !str.trim()) return null;
      var result = [];
      var parts = str.split(",");
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        var range = part.split("-");
        if (range.length === 2) {
          var start = parseInt(range[0], 10);
          var end = parseInt(range[1], 10);
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            for (var j = start; j <= end; j++) result.push(j);
          }
        } else {
          var num = parseInt(part, 10);
          if (!isNaN(num)) result.push(num);
        }
      }
      // convert 1-based to 0-based and filter out-of-range
      result = result.map(function (v) { return v - 1; }).filter(function (v) {
        return v >= 0 && (maxCount === undefined || v < maxCount);
      });
      // deduplicate and sort
      var seen = {};
      return result.filter(function (v) { return seen[v] ? false : (seen[v] = true); }).sort(function (a, b) { return a - b; });
    },
  };

  // ========================================================================
  //  SITE PROFILE – 多站点适配（直播中控台 / 团购中控台）
  //  三个站点的前端组件库不完全相同，用"站点档案"把差异集中收口在这里，
  //  其余模块只问 Site 是哪个站，不散落 host 判断：
  //    buyin  buyin.jinritemai.com/dashboard/live/control      商品=goodsItem 行（全量渲染）
  //    eos    eos.douyin.com/livesite/live/current             商品=虚拟滚动 list-wrap，评论=评论区
  //    fxg    fxg.jinritemai.com/ffa/content-tool/live/control 抖店中控台：**与 buyin 同源**
  //           （2026-09-30 用真实 DOM 实测：同 id #comment-list-wrapper、同行结构
  //             commentItem/nickname/description、同 tag-a4f4ec 哈希 → 复用 buyin 分支即可）
  //    wxch   channels.weixin.qq.com/platform/live/*            视频号直播中控台：
  //           ⚠️ **弹幕与商品在不同的页面**（能力完全不重叠，2026-10-10 实测：
  //              弹幕页 0 处讲解/价格，商品页 0 处评论/发送），所以同一个站点 id 下
  //              有**两条 path**，再用 Site.page() 区分页级能力。技术栈是
  //              Ant Design(Vue2) + weui-desktop，与前三个站点（lvc2/auxo/rbd）完全不同源，
  //              选择器一个都不能复用 → 各链路的 wxch 分支都是独立实现。
  // ========================================================================
  var Site = {
    _id: null,
    PROFILES: [
      { id: "buyin", host: "buyin.jinritemai.com", path: "/dashboard/live/control", label: "直播中控台" },
      { id: "eos", host: "eos.douyin.com", path: "/livesite/live/current", label: "团购中控台" },
      { id: "fxg", host: "fxg.jinritemai.com", path: "/ffa/content-tool/live/control", label: "抖店中控台" },
      // 用**精确 path** 而不是公共前缀 /platform/live/：那会把视频号后台其它 live 子页也吸进来
      { id: "wxch", host: "channels.weixin.qq.com", path: "/platform/live/liveBuild", label: "视频号中控台" },
      { id: "wxch", host: "channels.weixin.qq.com", path: "/platform/live/commodity/onsale/index", label: "视频号中控台" },
    ],
    detect: function () {
      if (this._id) return this._id;
      var host = window.location.host;
      var path = window.location.pathname || "";
      this._id = "unknown";
      for (var i = 0; i < this.PROFILES.length; i++) {
        var p = this.PROFILES[i];
        if (host === p.host && path.indexOf(p.path) === 0) { this._id = p.id; break; }
      }
      return this._id;
    },
    isEos: function () { return this.detect() === "eos"; },
    isFxg: function () { return this.detect() === "fxg"; },
    isWxch: function () { return this.detect() === "wxch"; },
    // 页级区分（只有视频号需要）：视频号把「弹幕」和「商品」拆成两个页面，
    // 能力不重叠 → 面板与各链路都要按页裁剪。其它站点是单页全能，返回 ""。
    //   "comment" 弹幕页  /platform/live/liveBuild           → 自动发评 / 弹幕回复
    //   "goods"   商品页  /platform/live/commodity/onsale/index → 自动讲解（本轮不建面板）
    page: function () {
      if (!this.isWxch()) return "";
      var path = window.location.pathname || "";
      if (path.indexOf("/platform/live/commodity/onsale/index") === 0) return "goods";
      if (path.indexOf("/platform/live/liveBuild") === 0) return "comment";
      return "";
    },
    // 本页是否具备「弹幕侧」能力（发评 / 关键词回复 / 读弹幕）
    hasCommentSide: function () { return !this.isWxch() || this.page() === "comment"; },
    // 本页是否具备「商品侧」能力（商品扫描 / 讲解）
    hasGoodsSide: function () { return !this.isWxch() || this.page() === "goods"; },
    // 发送按钮的**禁用态是否由框架异步驱动**（填完内容后要等一拍才可点）。
    // buyin 同步；eos / fxg / wxch 实测都是异步 —— 填完立刻点会点在禁用按钮上 →
    // 表现是"点了发送但评论没出来"，静默失败，极难排查。这几个站点必须走
    // 「等一拍 → 重取按钮 → 仍禁用则退回 Enter」的流程。
    // （新站点接入时请**显式回答**"它的禁用态是同步还是异步"，别默认套用。）
    asyncSendState: function () {
      var id = this.detect();
      return id === "eos" || id === "fxg" || id === "wxch";
    },
    supported: function () { return this.detect() !== "unknown"; },
    label: function () {
      var id = this.detect();
      for (var i = 0; i < this.PROFILES.length; i++) {
        if (this.PROFILES[i].id === id) return this.PROFILES[i].label;
      }
      return "未知站点";
    },
    // 面板标题用的站点简称（buyin 保持原来的"直播"，老站点观感不变）
    // 拼出来的标题形如「🎯 <short>中控小助手」：
    //   直播中控小助手 / 团购中控小助手 / 抖店中控小助手 / 视频号直播中控小助手
    short: function () {
      var id = this.detect();
      if (id === "eos") return "团购";
      if (id === "fxg") return "抖店";
      if (id === "wxch") return "视频号直播";
      return "直播";
    },
  };

  // ========================================================================
  //  PROBE ADAPTER – reads window.__DOUYIN_PROBE__ results
  // ========================================================================
  var Probe = {
    data: null,
    ready: function () {
      this.data = window.__DOUYIN_PROBE__ || {};
      return this.data.ready === true;
    },
    getProducts: function () {
      return (this.data && this.data.products) || [];
    },
    getPageType: function () {
      return (this.data && this.data.pageType) || "unknown";
    },
    getNetwork: function () {
      return (this.data && this.data.network) || [];
    },
    hasVue: function () {
      return !!(this.data && this.data.vue);
    },
    getVue: function () {
      return (this.data && this.data.vue) || null;
    },
  };

  // ========================================================================
  //  PAGE CONNECTOR – interacts with Douyin live control page
  // ========================================================================
  var PageAPI = {
    _cache: { products: [], lastScan: 0 },

    // ---------- Product discovery ----------
    // Scan DOM for product rows; cache the result briefly.
    // ONLY rows that actually contain an "讲解" button are treated as products —
    // loose row selectors otherwise pick up nav items / settings rows, which was
    // the root cause of wrong product lists.
    scanProducts: function () {
      // 页级能力守卫：视频号**弹幕页没有商品列表**（实测 0 处讲解/价格/库存）。
      // 直接返回空，不让下面那套通用扫描在 antd 页面上瞎找 ——
      // 通用策略第 3 步会在全页找"讲解"按钮，在这种页面上既浪费又可能误判工具栏。
      if (!Site.hasGoodsSide()) return [];
      var now = Date.now();
      if (now - this._cache.lastScan < 1000) return this._cache.products;
      this._cache.lastScan = now;

      // eos（团购中控台）商品列表是虚拟滚动，扫描逻辑完全不同 → 走独立分支
      if (Site.isEos()) return this._scanProductsEos();

      var products = [];
      var seen = {};

      // Strategy 1: DOM rows that have an explain button
      var rows = this._collectRows();
      var scanIndex = 0;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var btn = this._findExplainBtnInRow(row);
        if (!btn) continue; // not a product row → skip

        var key = this._rowKey(row);
        var name = extractProductName(row);
        if (!key) key = name || ("row_" + r);
        if (key && seen[key]) continue;
        if (key) seen[key] = true;

        products.push({
          id: key,
          name: name,
          // 视频号商品行的价格/库存：价格在 .price-wrap .price（«¥9.9»）；
          // 库存在 .source，但每行有**两个** .source（«库存2904» / «浏览5»）→ 必须按「库存」前缀挑。
          // 其余站点的行里没有这套 class，返回空串 → 行为不变（抖音侧 UI 本来也不读这俩字段）。
          price: Site.isWxch() ? extractWxPrice(row) : "",
          stock: Site.isWxch() ? extractWxStock(row) : "",
          row: row,
          explainBtn: btn,
          scanIndex: scanIndex, // positional fallback for re-location
        });
        scanIndex++;
      }

      // Strategy 2: fallback to probe pre-scanned products (network capture).
      // Only used when the DOM scan found nothing (e.g. list not rendered yet).
      if (products.length === 0) {
        var probeProds = Probe.getProducts();
        for (var i = 0; i < probeProds.length; i++) {
          var p = probeProds[i];
          if (p.id && !seen[p.id]) {
            seen[p.id] = true;
            products.push({ id: p.id, name: p.name, price: p.price, stock: p.stock });
          }
        }
      }

      // Strategy 3: page-wide fallback — walk up from every "讲解" button to its
      // row. Runs only when container-scoped scanning found nothing (e.g. the
      // page renamed its list container classes). Buttons are far fewer than all
      // elements, so this stays cheap.
      if (products.length === 0) {
        var btns = document.querySelectorAll(
          "button.lvc2-grey-btn, button[class*='grey-btn'], button, span, a, div[role='button']"
        );
        var seenRows = {};
        var scanIndex3 = 0;
        for (var b = 0; b < btns.length; b++) {
          var t3 = (btns[b].textContent || "").trim();
          if (!Utils.isExplainBtnText(t3)) continue;
          var row3 = btns[b].closest("[class*='goods-item'], [class*='goodsItem'], [class*='goods_item']") ||
            btns[b].closest("tr") ||
            btns[b].closest("[class*='row']") ||
            btns[b].closest("[class*='item'], [class*='Item']") ||
            btns[b].parentElement;
          if (!row3) continue;
          if (row3.offsetParent === null && row3.getClientRects().length === 0) continue; // hidden panel
          if (seenRows[row3._dy_id]) continue;
          seenRows[row3._dy_id || (row3._dy_id = "row_" + Math.random().toString(36).slice(2))] = true;
          var key3 = this._rowKey(row3);
          var name3 = extractProductName(row3);
          if (!key3) key3 = name3 || ("row_" + b);
          if (key3 && seen[key3]) continue;
          if (key3) seen[key3] = true;
          products.push({
            id: key3,
            name: name3,
            price: "",
            stock: "",
            row: row3,
            explainBtn: btns[b],
            scanIndex: scanIndex3,
          });
          scanIndex3++;
        }
      }

      this._cache.products = products;
      return products;

      // does the text look like a metrics/summary blob rather than a product name?
      // (e.g. "¥2.60到手价0告出¥0.00成交金额0.00%曝光成交率")
      //
      // ⚠️ 判据只能是「汉字为主 vs 数字/符号为主」，绝不能是「首位是不是数字」——
      //    2026-10-08 实测踩到：商品名「26年<品类>…」以**年份**开头，
      //    被旧的 `/^[¥￥\d]/` 整条判成指标串丢掉 → 商品名变空 → 面板显示「未知商品」
      //    （但讲解按钮照点，所以只在"商品获取"上出错，不报任何错）。
      //    凡是"以数字打头就否决"的规则，都会误杀「年份/规格/数字型号」打头的真实商品名。
      //
      // strict=true：额外把「数字打头」也当可疑。**只给第 3 步的整行文本兜底用** ——
      //   那里拿到的是 "10:26:48<商品名>…" 这种整行拼接串，数字打头确实是垃圾特征。
      function isLikelyMetrics(text, strict) {
        var hits = ["到手价", "成交", "金额", "曝光", "转化", "销量", "观看", "订单",
          "佣金", "退款", "退货", "库存", "价格", "优惠", "利润", "人气", "点击",
          "件数", "客单", "讲解"];
        var n = 0;
        for (var i = 0; i < hits.length; i++) {
          if (text.indexOf(hits[i]) !== -1) n++;
        }
        if (n >= 2) return true;                          // 命中 ≥2 个指标词 → 铁定是指标串
        if (/^[¥￥]/.test(text)) return true;             // 货币符号打头 → 金额串
        if (strict && /^[\d¥￥]/.test(text)) return true; // 整行拼接串：数字打头即可疑
        return !/[\u4e00-\u9fa5]/.test(text);             // 一个汉字都没有 → 不可能是商品名
      }

      // 视频号商品行的价格（唯一 .price-wrap .price，文本形如 «¥9.9»）
      function extractWxPrice(row) {
        var el = row.querySelector(".price-wrap .price");
        if (!el) return "";
        var t = (el.textContent || "").trim();
        return /[¥￥]/.test(t) ? t : "";
      }
      // 视频号商品行的库存：每行两个 .source（«库存…» / «浏览…»）→ 只认「库存」打头的那个
      function extractWxStock(row) {
        var els = row.querySelectorAll(".source");
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || "").trim();
          if (/^库存/.test(t)) return t.replace(/^库存\s*/, "");
        }
        return "";
      }

      // extract the product name from a row
      function extractProductName(row) {
        var best = "";
        // 1. structured candidates: name/title classes, img alt, link titles
        var structured = row.querySelectorAll(
          "[class*='product-name'], [class*='goods-name'], [class*='name'], [class*='title'], a[title], img[alt]"
        );
        for (var s = 0; s < structured.length; s++) {
          var st = (structured[s].getAttribute("alt") || structured[s].getAttribute("title") || structured[s].textContent || "").trim();
          if (st.length >= 2 && /[\u4e00-\u9fa5]/.test(st) && !isLikelyMetrics(st) && st.length > best.length) {
            best = st;
          }
        }
        if (best) return best;
        // 2. cell heuristic
        var cells = row.querySelectorAll("td, [class*='cell'], [class*='col']");
        for (var c = 0; c < cells.length; c++) {
          var cell = cells[c];
          var t = (cell.textContent || "").trim();
          if (t.length < 2) continue;
          if (cell.querySelector("button")) continue; // action-button cell
          if (t === "讲解" || t === "自动讲解" || t === "取消讲解") continue;
          if (t.indexOf("讲解") !== -1 && t.length <= 6) continue; // e.g. "语音讲解"
          if (/^[\d.,%¥$￥\s+-]+$/.test(t)) continue; // pure numbers / prices
          if (/[\u4e00-\u9fa5]/.test(t) && !isLikelyMetrics(t) && t.length > best.length) best = t;
          else if (!best && t.length > best.length && !isLikelyMetrics(t)) best = t;
        }
        // 3. fallback only if it doesn't look like metrics garbage
        if (!best) {
          var fb = (row.textContent || "").substring(0, 60).trim();
          return isLikelyMetrics(fb, true) ? "" : fb;  // strict：整行拼接串放宽无关，收紧才安全
        }
        return best;
      }
    },

    // Force a fresh re-scan, bypassing the short cache
    forceScan: function () {
      this._cache.lastScan = 0;
      return this.scanProducts();
    },

    // Find candidate product row elements, scoped to product-ish containers.
    // Scoping avoids a full-page querySelectorAll on busy live pages.
    _collectContainers: function () {
      var selectors = [
        // lvc2 component library (used by the live control page)
        "[class*='lvc2'] [class*='list']",
        "[class*='lvc2'] [class*='table']",
        "[class*='lvc2'] [class*='body']",
        // generic product/goods containers
        "[class*='product'] [class*='list']",
        "[class*='goods'] [class*='list']",
        "[class*='product'] [class*='table']",
        "[class*='goods'] [class*='table']",
        "[class*='table']",
        "[class*='list']",
      ];
      var found = [];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length && j < 30; j++) {
          if (els[j].isConnected) found.push(els[j]);
        }
      }
      // keep only outermost containers (skip ones nested inside another)
      return found.filter(function (c, idx, arr) {
        for (var k = 0; k < arr.length; k++) {
          if (k !== idx && arr[k] !== c && arr[k].contains && arr[k].contains(c)) return false;
        }
        return true;
      }).slice(0, 10);
    },

    // Collect goods rows. Known page structure (from DevTools):
    //   <div class="goodsItem-xxxx rpa_lc__live-goods__goods-item"
    //        data-rbd-draggable-id="3753668893483336118" ...>
    // 页面全量渲染（行是绝对定位，无 data-index），所以按 class 全文档匹配既快又可靠。
    // fxg 的列表容器也是这套结构：
    //   #live-control-goods-list-container > div{overflow:auto; will-change:transform}
    //   > div{height:...} + 行{position:absolute; top:0/216; height:208}
    //   看着像虚拟滚动，但 2026-09-30 主人确认「商品只有 2 个」→ 撑高容器 432px
    //   就是实际行数（432 = 2×216），全量渲染成立，**无需 eos 那样的滚动渲染逻辑**。
    //   （若将来商品变多、发现扫不全，再照 _scanProductsEos 补滚动。）
    // 行 → 商品号的**唯一**解析入口（原来策略 1 与策略 3 各写了一遍属性链，改了必漏一处）。
    // 各站点的商品号落点不同：
    //   buyin/fxg  data-rbd-draggable-id
    //   wxch       **不在 data-* 上** —— 行内 span.id-wrap 的 id 属性 "id-<数字>" + 文本 "ID:<数字>"
    _rowKey: function (row) {
      if (!row || !row.getAttribute) return "";
      return row.getAttribute("data-product-id") || row.getAttribute("data-id") ||
             row.getAttribute("data-rbd-draggable-id") || this._wxProductId(row);
    },
    _wxProductId: function (row) {
      if (!Site.isWxch() || !row || !row.querySelector) return "";
      var el = row.querySelector("span.id-wrap") || row.querySelector("[id^='id-']");
      if (!el) return "";
      var m = (el.id || "").match(/^id-(\d+)$/);
      if (m) return m[1];
      m = (el.textContent || "").match(/ID[:：]\s*(\d+)/);
      return m ? m[1] : "";
    },

    _collectRows: function () {
      // wxch（视频号商品页）：行是 div.table-row-wrap，有稳定 class。
      // 只在商品页有商品行；弹幕页由 hasGoodsSide() 在上游守卫（scanProducts 直接返回空）
      if (Site.isWxch()) {
        var wxRows = document.querySelectorAll(".table-row-wrap");
        var wxOut = [];
        for (var wr = 0; wr < wxRows.length; wr++) {
          // hover 才显示的 .hover-actions（删除/恢复原价）不可见 → 但这些在行内不影响行本身；
          // 这里过滤的是"整行不可见"（面板收起/tab 切走）的情况
          if (!Utils.isVisible(wxRows[wr])) continue;
          wxOut.push(wxRows[wr]);
        }
        return wxOut;
      }
      var rows = [];
      var exact = document.querySelectorAll(
        "[class*='goods-item'], [class*='goodsItem'], [class*='goods_item']"
      );
      for (var i = 0; i < exact.length; i++) {
        var el = exact[i];
        if (!el.isConnected) continue;
        // skip rows inside hidden panels/tabs — they would corrupt the product
        // order and cause mismatched name / button / sequence
        if (el.offsetParent === null && el.getClientRects().length === 0) continue;
        rows.push(el);
      }
      if (rows.length > 0) return rows;
      // fallback: scoped container scan
      var containers = this._collectContainers();
      for (var c = 0; c < containers.length; c++) {
        var els = containers[c].querySelectorAll(
          "tr, [class*='row'], [class*='item'], [class*='Item'], [class*='goods']"
        );
        for (var r = 0; r < els.length; r++) {
          if (!els[r].isConnected) continue;
          if (els[r].offsetParent === null && els[r].getClientRects().length === 0) continue;
          rows.push(els[r]);
        }
      }
      return rows;
    },

    // Find the "讲解" button inside a row.
    // Known page structures (from DevTools):
    //   buyin 老结构: <button class="lvc2-grey-btn" ...>讲解</button>
    //   fxg / doudian: <button class="auxo-btn auxo-btn-sm lvc2-doudian-btn
    //                          [active] greyBtnStyle-<hash>">讲解 / 取消讲解</button>
    //   ⚠️ 同一行还有 预热 / 营销活动 / 下架 / 更多数据 等兄弟按钮，文本不匹配 → 必须配合文本判定
    _findExplainBtnInRow: function (row) {
      if (!row || !row.querySelectorAll) return null;
      // eos（团购中控台）：讲解按钮是 div[class*='talking-btn']（不是 button，
      // 通用扫描抓不到），用专属选择器一步定位；取不到即说明该行不是商品行
      if (Site.isEos()) return this.eosExplainBtn(row);
      // wxch（视频号商品页）：讲解按钮是 **span**，而且两种状态的**元素与文本都不同**：
      //   未讲解 → span.promoting.multi-promoting      «讲解»
      //   讲解中 → span.not-promoting                  «结束讲解»
      //            （另有 div.content-color.recording-btn «00:45» 只是计时显示，点了会开别的弹窗）
      // ⚠️ 通用文本扫描在这站两侧都失配：isExplainBtnText 只认 讲解/自动讲解/取消讲解，
      //    认不出「结束讲解」；而讲解中的主元素文本是「00:45」，更不是讲解。
      // ⚠️ 也不能用 [class*='promoting'] 子串匹配 —— promoting-wrap /
      //    promoting-business-type-dropdown / promoting-dropdown-label（«购买模式»«送礼物模式»）
      //    全都含这个子串。必须**精确 class**（classList）+ 可见性。
      if (Site.isWxch()) {
        var wxEnd = row.querySelector("span.not-promoting");
        if (wxEnd && Utils.isVisible(wxEnd)) return wxEnd;
        var wxStart = row.querySelector("span.promoting");
        if (wxStart && Utils.isVisible(wxStart)) return wxStart;
        return null;
      }
      // 1. known component class first (most reliable)
      //    greyBtnStyle-* 是 2026-09-30 实测的 fxg（抖店中控台）灰色按钮特征 —— 驼峰、无连字符，
      //    原来那三个选择器（lvc2-grey-btn / grey-btn / GreyBtn）在 fxg 上一个都不命中，
      //    定位全靠第 2 步文本扫描兜底。补上它，让"可靠特征优先"这层防线真正生效。旧选择器保留，兼容老站点。
      var known = row.querySelectorAll(
        "button.lvc2-grey-btn, button[class*='grey-btn'], button[class*='GreyBtn'], " +
        "button[class*='greyBtnStyle']"
      );
      for (var i = 0; i < known.length; i++) {
        var t0 = (known[i].textContent || "").trim();
        if (Utils.isExplainBtnText(t0)) return known[i];
      }
      // 2. general text scan
      var els = row.querySelectorAll("button, span, a, div[role='button']");
      for (var j = 0; j < els.length; j++) {
        var t = (els[j].textContent || "").trim();
        if (Utils.isExplainBtnText(t)) return els[j];
      }
      // 3. look for title attribute or aria-label
      for (var k = 0; k < els.length; k++) {
        var label = els[k].getAttribute("title") || els[k].getAttribute("aria-label") || "";
        if (label.indexOf("讲解") !== -1 && label.indexOf("取消") === -1) return els[k];
      }
      return null;
    },

    // ---------- eos（团购中控台）: 团购商品列表（虚拟滚动） ----------
    // 实测结构（2026-09-14，主人贴的真实 DOM）：
    //   div#live-card-list > div.list-wrap-afHxzG
    //   └── div(style: height:633px; overflow:auto)          ← 滚动容器（视口）
    //       └── div(style: height: 总行数 × 行高)             ← 内容高度容器（912px）
    //           └── div[data-rfd-draggable-id][data-index]    ← 一行（绝对定位，height:152）
    //               ├── [class*='drag-number'] input.sort-input-*   ← 序号（maxlength=2，1-based）
    //               ├── [class*='card-name'] [class*='render-1']    ← 商品名
    //               │   （同名文本还有 [class*='fictitious-*'] 量宽副本，不能用）
    //               ├── [class*='poi-'] [class*='render-nXrSFh']    ← 门店名"XX市<门店>…"
    //               ├── [class*='operate-area'] [class*='talking-btn'] [class*='talking-word']
    //               │                                                ← "讲解" / "取消讲解"
    //               └── [class*='stats-'] 曝光/点击/支付订单数/销售额
    // 总行数推算已实测对齐：912 ÷ 152 = 6，与筛选标签「全部(6)」一致 ✓
    // 注意 operate-area 与 stats 是 render-item-* 的兄弟节点，仍在行 div 内 → row.querySelector 可达
    _EOS_ROW_H: 152,

    // 商品面板容器：实测带稳定 id `div#live-card-list`（优先），无 id 时退回 list-wrap 哈希类
    eosWrapEl: function () {
      return document.querySelector("#live-card-list") ||
             document.querySelector("[class*='list-wrap']");
    },

    // 列表区信息：滚动容器 / 内容容器 / 行高 / 总行数
    eosList: function () {
      var wrap = this.eosWrapEl();
      var row = (wrap || document).querySelector("[data-rfd-draggable-id]");
      if (!row) return null;
      if (!wrap) wrap = row.closest("[class*='list-wrap']") || document.body;
      var inner = row.parentElement;                      // 内容高度容器
      var scroller = inner ? inner.parentElement : null;  // 滚动容器
      var rowH = parseFloat(row.style.height) || this._EOS_ROW_H;
      var total = 0;
      if (inner && inner.style && inner.style.height) {
        var h = parseFloat(inner.style.height);
        if (h > 0) total = Math.round(h / rowH);
      }
      // 用已渲染行的最大 data-index 修正总行数（内容高度可能尚未更新）
      var drawn = (wrap || document).querySelectorAll("[data-rfd-draggable-id]");
      for (var i = 0; i < drawn.length; i++) {
        var di = parseInt(drawn[i].getAttribute("data-index"), 10);
        if (!isNaN(di) && di + 1 > total) total = di + 1;
      }
      return { wrap: wrap, scroller: scroller, inner: inner, rowHeight: rowH, total: total };
    },

    // 已渲染（可视区）的行，按 data-index 升序
    eosRows: function () {
      var scope = this.eosWrapEl() || document;
      var list = scope.querySelectorAll("[data-rfd-draggable-id]");
      var out = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].isConnected) out.push(list[i]);
      }
      out.sort(function (a, b) {
        return (parseInt(a.getAttribute("data-index"), 10) || 0) -
               (parseInt(b.getAttribute("data-index"), 10) || 0);
      });
      return out;
    },

    // 按 data-index 找"当前在 DOM 中"的行（虚拟列表里未渲染的行取不到）
    eosFindRow: function (index) {
      var rows = this.eosRows();
      for (var i = 0; i < rows.length; i++) {
        if (parseInt(rows[i].getAttribute("data-index"), 10) === index) return rows[i];
      }
      return null;
    },

    // 滚动列表让指定行进入可视区（虚拟列表必须先渲染才能点得到）
    eosScrollTo: function (index) {
      if (this.eosFindRow(index)) return true; // 已渲染，无需滚动
      var info = this.eosList();
      if (!info || !info.scroller) return false;
      try {
        info.scroller.scrollTop = index * info.rowHeight;
        return true;
      } catch (_) { return false; }
    },

    // 商品名：优先 card-name 内的 render-*（fictitious-* 是量宽用的重复副本）
    eosName: function (row) {
      if (!row || !row.querySelector) return "";
      var el = row.querySelector("[class*='card-name'] [class*='render-1']") ||
               row.querySelector("[class*='card-name']");
      return el ? (el.textContent || "").trim().slice(0, 80) : "";
    },

    // 讲解按钮：div[class*='talking-btn']，文本 "讲解"（未讲解）/ "取消讲解"（讲解中）
    eosExplainBtn: function (row) {
      if (!row || !row.querySelector) return null;
      var btn = row.querySelector("[class*='talking-btn']");
      // 兜底：若操作区与卡片平级（不在行内），仅在"父级只含这一行"时使用，避免取到别行的按钮
      if (!btn && row.parentElement &&
          row.parentElement.querySelectorAll("[data-rfd-draggable-id]").length === 1) {
        btn = row.parentElement.querySelector("[class*='talking-btn']");
      }
      if (!btn) return null;
      return (btn.textContent || "").indexOf("讲解") !== -1 ? btn : null;
    },

    // eos 商品扫描：以 data-index 为主键；未渲染的行补占位项，
    // 让"序号过滤"覆盖整个列表（点击前会自动滚动渲染，见 _eosEnsureRow）
    _scanProductsEos: function () {
      var rows = this.eosRows();
      var byIndex = {};
      var rendered = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var btn = this.eosExplainBtn(row);
        if (!btn) continue; // 不是商品行
        var idx = parseInt(row.getAttribute("data-index"), 10);
        if (isNaN(idx)) idx = rendered;
        byIndex[idx] = {
          id: row.getAttribute("aria-label") || row.getAttribute("data-rfd-draggable-id") || ("eos_" + idx),
          name: this.eosName(row),
          price: "",
          stock: "",
          row: row,
          explainBtn: btn,
          eosIndex: idx,
          scanIndex: idx,
          rendered: true,
        };
        rendered++;
      }

      var info = this.eosList();
      var maxIdx = -1;
      for (var k in byIndex) {
        if (byIndex.hasOwnProperty(k)) {
          var ki = parseInt(k, 10);
          if (ki > maxIdx) maxIdx = ki;
        }
      }
      var total = Math.max(info ? info.total : 0, maxIdx + 1, rendered);
      var products = [];
      for (var j = 0; j < total; j++) {
        if (byIndex[j]) products.push(byIndex[j]);
        else {
          // 未渲染的占位项：名称留空，点击前滚动渲染后再补
          products.push({
            id: "eos_" + j, name: "", price: "", stock: "",
            row: null, explainBtn: null, eosIndex: j, scanIndex: j, rendered: false,
          });
        }
      }
      this._cache.products = products;
      return products;
    },

    // 行是否仍在 DOM 且能取到讲解按钮
    _isRowLive: function (product) {
      if (!(product && product.row)) return false;
      // wxch：行内**可见** span.not-promoting = 正在讲解。
      // 判据用"结束讲解按钮存在"而不是"按钮文本"—— 讲解中时主元素文本是计时器 00:45，靠文本必失配。
      // 表格被 Vue 整块重渲染时 row 会脱节点 → 先按商品号重新定位再判
      if (Site.isWxch()) {
        if (!product.row.isConnected) {
          var r2 = this._wxFindRowById(product.id);
          if (r2) product.row = r2;
        }
        if (!product.row.isConnected) return false;
        var endBtn = product.row.querySelector("span.not-promoting");
        return !!(endBtn && Utils.isVisible(endBtn));
      }
      return !!(product.row.isConnected && this.eosExplainBtn(product.row));
    },

    // wxch：按商品号重新定位行（表格重渲染后 row 会失效）
    _wxFindRowById: function (id) {
      if (!id) return null;
      var rows = document.querySelectorAll(".table-row-wrap");
      for (var i = 0; i < rows.length; i++) {
        if (this._wxProductId(rows[i]) === String(id)) return rows[i];
      }
      return null;
    },

    // wxch：视频号的动作按钮点击后可能弹确认框（弹窗是 .weui-desktop-popper，默认 display:none）。
    // 从静态 DOM 看不出点「讲解」到底弹不弹，所以两条路都走 —— 点完若没变成目标状态，
    // 就找可见弹窗点它的「确定」，再校验一次。
    _wxConfirmDialog: function () {
      var pops = document.querySelectorAll(".weui-desktop-popper");
      for (var i = 0; i < pops.length; i++) {
        if (!Utils.isVisible(pops[i])) continue;
        var btns = pops[i].querySelectorAll("button");
        for (var j = 0; j < btns.length; j++) {
          if ((btns[j].textContent || "").trim() === "确定") { Utils.clickEl(btns[j]); return true; }
        }
      }
      return false;
    },

    // wxch：点 + **校验结果**（返回 Promise<boolean>，与 eos 同契约，调用侧统一 Promise.resolve 收口）
    _wxClickAndVerify: function (product, wantLive) {
      var self = this;
      if (!product || !product.row) return Promise.resolve(false);
      var btn = this._findExplainBtnInRow(product.row);
      if (!btn) return Promise.resolve(false);
      // 已经是目标状态 → 视为成功，不做反向动作（同 clickExplain/cancelExplain 的既有语义）
      if (this._isRowLive(product) === wantLive) return Promise.resolve(true);
      Utils.clickEl(btn);
      return Utils.sleep(350).then(function () {
        if (self._isRowLive(product) === wantLive) return true;
        if (self._wxConfirmDialog()) {
          return Utils.sleep(350).then(function () { return self._isRowLive(product) === wantLive; });
        }
        return false;
      });
    },

    // eos：确保目标行已在 DOM 中（必要时滚动 + 等渲染），返回 Promise<row>
    _eosEnsureRow: function (product) {
      var self = this;
      var idx = product.eosIndex;
      var row = this.eosFindRow(idx);
      if (row) return Promise.resolve(row);
      this.eosScrollTo(idx);
      return Utils.sleep(350).then(function () {
        var r = self.eosFindRow(idx);
        if (r) return r;
        // 二次校正：虚拟列表首次滚动后位置可能被修正
        self.eosScrollTo(idx);
        return Utils.sleep(350).then(function () { return self.eosFindRow(idx); });
      });
    },

    // ---------- Auto Explain ----------
    // Click a product's "讲解" button.
    // The button text changes while explaining (取消讲解 / 讲解中 / 已讲解 …).
    // Any text that still references 讲解 identifies it as an explain button;
    // an already-explaining state is treated as success so we never toggle OFF.
    clickExplain: function (product) {
      // wxch（视频号商品页）：点 span.promoting 开始讲解，**点完校验结果**
      // （点「讲解」是否弹确认框从静态 DOM 看不出来 → 见 _wxConfirmDialog 的两条路）
      if (Site.isWxch()) return this._wxClickAndVerify(product, true);
      // eos（虚拟列表）：目标行未渲染时先滚动渲染、等一帧再点击 → 返回 Promise<boolean>
      if (Site.isEos() && product && typeof product.eosIndex === "number" && !this._isRowLive(product)) {
        var self = this;
        return this._eosEnsureRow(product).then(function (row) {
          if (!row) return false;
          if (!product.name) product.name = self.eosName(row); // 占位项在渲染后补名
          var b = self.eosExplainBtn(row);
          if (!b) return false;
          product.row = row;
          product.explainBtn = b;
          var tt = (b.textContent || "").trim();
          if (tt.indexOf("取消") !== -1) return true; // 已在讲解中 → 视为成功，不反向关掉
          return Utils.clickEl(b);
        });
      }
      var btn = this._locateExplainBtn(product);
      if (!btn) return false;
      var t = (btn.textContent || "").trim();
      var label = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
      // identify as an explain button; exclude other explain modes (语音讲解 / AI讲解)
      var isExplain = Utils.isExplainBtnText(t) ||
        (t.indexOf("讲解") !== -1 && t.indexOf("语音") === -1 && t.indexOf("AI") === -1) ||
        label.indexOf("讲解") !== -1;
      if (!isExplain) return false;
      // already explaining → treat as success, do not toggle it off
      if (t.indexOf("取消") !== -1 || t.indexOf("停止") !== -1 || t.indexOf("结束") !== -1 ||
          t.indexOf("讲解中") !== -1 || t.indexOf("已讲解") !== -1 ||
          label.indexOf("取消") !== -1) {
        return true;
      }
      return Utils.clickEl(btn);
    },

    // Click "取消讲解" — used by single-product mode to pause explaining.
    // No-op success when the product is not currently explaining.
    cancelExplain: function (product) {
      // wxch：结束讲解 = 点 span.not-promoting，点完校验
      if (Site.isWxch()) return this._wxClickAndVerify(product, false);
      // eos（虚拟列表）：同上，先确保目标行已渲染 → 返回 Promise<boolean>
      if (Site.isEos() && product && typeof product.eosIndex === "number" && !this._isRowLive(product)) {
        var self2 = this;
        return this._eosEnsureRow(product).then(function (row) {
          if (!row) return false;
          if (!product.name) product.name = self2.eosName(row);
          var b = self2.eosExplainBtn(row);
          if (!b) return false;
          product.row = row;
          product.explainBtn = b;
          var tt = (b.textContent || "").trim();
          if (tt.indexOf("取消") === -1) return true; // 本来就没在讲解 → 视为成功
          return Utils.clickEl(b);
        });
      }
      var btn = this._locateExplainBtn(product);
      if (!btn) return false;
      var t = (btn.textContent || "").trim();
      var label = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
      var isExplain = Utils.isExplainBtnText(t) ||
        (t.indexOf("讲解") !== -1 && t.indexOf("语音") === -1 && t.indexOf("AI") === -1) ||
        label.indexOf("讲解") !== -1;
      if (!isExplain) return false;
      // not explaining → nothing to cancel, treat as success
      if (t.indexOf("取消") === -1 && t.indexOf("停止") === -1 && t.indexOf("结束") === -1 &&
          t.indexOf("讲解中") === -1 && t.indexOf("已讲解") === -1 &&
          label.indexOf("取消") === -1) {
        return true;
      }
      return Utils.clickEl(btn);
    },

    // locate the explain button, re-scanning when cached DOM refs went stale
    _locateExplainBtn: function (product) {
      // 1. cached button still attached to the document
      if (product.explainBtn && product.explainBtn.isConnected) return product.explainBtn;
      // 2. cached row still attached → search inside it
      if (product.row && product.row.isConnected) {
        var btn2 = this._findExplainBtnInRow(product.row);
        if (btn2) return (product.explainBtn = btn2);
      }
      // 3. row went stale (SPA re-render) → re-locate the row by product id/name
      var row = this._locateRow(product);
      if (row) {
        product.row = row;
        product.explainBtn = null;
        return this._locateExplainBtn(product);
      }
      return null;
    },

    // Re-locate a product row: by id → by name → by positional index.
    // Positional fallback matters because names extracted from metric-heavy rows
    // are unreliable after the SPA re-renders numbers mid-live.
    _locateRow: function (product) {
      // eos（虚拟列表）：data-index 是唯一可靠定位键，直接取当前已渲染的目标行
      if (Site.isEos() && product && typeof product.eosIndex === "number") {
        return this.eosFindRow(product.eosIndex);
      }
      var rows = [];
      var allRows = this._collectRows();
      for (var i = 0; i < allRows.length; i++) {
        if (this._findExplainBtnInRow(allRows[i])) rows.push(allRows[i]);
      }
      var id = product && product.id;
      var name = product && product.name;
      var idx = product && product.scanIndex;
      if (id) {
        for (var a = 0; a < rows.length; a++) {
          // 用统一的 _rowKey（原来自写属性链 → wxch 的商品号不在 data-* 上，会漏）
          if (this._rowKey(rows[a]) === String(id)) return rows[a];
        }
      }
      if (name) {
        for (var b = 0; b < rows.length; b++) {
          if ((rows[b].textContent || "").indexOf(name) !== -1) return rows[b];
        }
      }
      if (typeof idx === "number" && rows[idx]) return rows[idx];
      return null;
    },

    // ---------- Auto Comment ----------

    // eos 评论输入框定位。实测真实结构（2026-09-14，含商品面板对照）：
    //   评论区：div.comment-wrap-sJwP1r
    //           └── div.input-wrap-j6Z8oG > div.text-area-CyjKXV
    //               ├── div.text-input-SqqLWx > textarea.input-EghOjQ
    //               │     placeholder="输入评论，Enter键发送"  maxlength=50
    //               └── div.button-Wc1yvW 「发送」（空输入时带 button-disable-*）
    //   商品面板（必须避开，实测两类误命中）：
    //     #live-card-list [class*='list-wrap'] 内
    //       ├── input.sort-input-Knhzky  序号框（maxlength=2）
    //       └── input[placeholder='搜索商品名称或ID']
    //           外层是 okee-current-live-input-wrapper —— 同样含 "input-wrap" 子串，
    //           会被 [class*='input-wrap'] 命中（"input-wrapper" 包含 "input-wrap"）
    _findEosCommentInput: function () {
      // 0. 评论区外壳精确命中（comment-wrap 是评论区面板真实外壳，最可靠）
      var shell = document.querySelector("[class*='comment-wrap']");
      if (shell) {
        var inShell = shell.querySelector("textarea");
        if (inShell && Utils.isVisible(inShell)) return inShell;
      }
      var list = document.getElementById("comment_all_tab_list_container");
      var scope = list;
      for (var up = 0; up < 4 && scope && scope.parentElement; up++) scope = scope.parentElement;
      if (!scope) scope = document;
      // 1. 实测结构：text-area / input-wrap 内的 textarea（限定在评论区 scope 内，不外溢到商品面板）
      var wrap = (scope.querySelector && scope.querySelector("[class*='text-area']")) ||
                 (scope.querySelector && scope.querySelector("[class*='input-wrap']"));
      if (wrap) {
        var direct = wrap.querySelector("textarea");
        if (direct && Utils.isVisible(direct)) return direct;
      }
      // 2. placeholder 兜底（"输入评论，Enter键发送"）
      var byPh = document.querySelector("textarea[placeholder*='评论']");
      if (byPh && Utils.isVisible(byPh)) return byPh;
      // 3. 面板内启发式扫描（跳过商品面板 / 搜索框 / 序号框）
      var cands = scope.querySelectorAll(
        "textarea, input[type='text'], input:not([type]), [contenteditable='true']"
      );
      for (var i = 0; i < cands.length; i++) {
        var el = cands[i];
        if (el.offsetParent === null && el.getClientRects().length === 0) continue; // 不可见
        if (el.closest && (el.closest("#live-card-list") || el.closest("[class*='list-wrap']"))) continue;
        if ((el.getAttribute("placeholder") || "").indexOf("搜索") !== -1) continue; // 商品搜索框
        var ml = el.getAttribute("maxlength");
        if (ml && parseInt(ml, 10) <= 4) continue;                                   // 序号框
        if (el.disabled || el.readOnly) continue;
        return el;
      }
      return null;
    },

    findCommentInput: function () {
      // eos（团购中控台）：只认评论区专属定位 —— 该站的输入框结构已实测确认。
      // 刻意不回退到下面的通用选择器：商品面板的"搜索商品名称或ID"框 class 是
      // okee-current-live-input，会被 [class*='input'] 系列命中 → 回复会被打进商品搜索框，
      // 比"找不到输入框"更糟（会静默改掉运营看到的商品列表）。
      // 定位失败时返回 null，由 sendComment 打 warn 留痕，主人按日志贴 DOM 再适配。
      if (Site.isEos()) {
        var eosInput = this._findEosCommentInput();
        if (!eosInput) log.warn("未找到评论输入框（评论区面板是否收起？）");
        return eosInput || null;
      }
      // wxch（视频号·弹幕页）：输入框有稳定 class `message-input`，且该页只有一个 textarea。
      // 与 eos 同理**刻意不回退到通用选择器** —— 视频号后台是 antd 页面，还有商品搜索框
      // 等同类控件，通用 [class*='input'] 系列一旦先命中就会打错地方（静默失效，比找不到更糟）。
      if (Site.isWxch()) {
        if (Site.page() !== "comment") return null;     // 商品页没有评论输入区
        var wxInput = document.querySelector("textarea.message-input");
        if (wxInput && Utils.isVisible(wxInput)) return wxInput;
        log.warn("未找到评论输入框（视频号弹幕页的「主播发言」框）");
        return null;
      }
      // Strategy 0（buyin / fxg 共用）：中控台评论输入区有稳定 id `input-comment-block-id`，
      // 用它锚定最可靠。为什么不用通用的 `textarea[class*='input']`？—— 2026-09-30 用 fxg 真实
      // DOM 实测：页面上还有别的同类输入框（商品搜索），一旦它排在评论输入框**之前**就会被先
      // 命中，回复会打进搜索框（与 eos 的 input-wrap 串台同型，静默失效、极难排查）。
      // 校验三件事才采用：① 锚点内确实是 textarea ② 该 textarea 可见 ③ 同一锚点内有
      // inputSuffix 发送按钮。任一不满足 → 原样回退到下面的策略，buyin 现有行为不受影响。
      var anchorEl = document.getElementById("input-comment-block-id");
      if (anchorEl) {
        var anchoredInput = anchorEl.querySelector("textarea");
        if (anchoredInput && anchoredInput.offsetParent !== null &&
            anchorEl.querySelector("[class*='inputSuffix'], [class*='input-suffix']")) {
          return anchoredInput;
        }
      }
      // Look for chat input area
      var selectors = [
        "textarea[class*='chat']", "textarea[class*='comment']",
        "textarea[class*='message']", "textarea[class*='input']",
        "input[class*='chat']", "input[class*='comment']",
        "input[class*='message']", "div[contenteditable='true']",
        "[class*='chat-input'] input", "[class*='chat-input'] textarea",
        "[class*='comment-input'] input", "[class*='comment-input'] textarea",
        "[class*='input-area'] textarea", "[class*='input-area'] input",
        // Douyin-specific selectors for live chat
        "[class*='webcast'] textarea", "[class*='webcast'] input",
        "[class*='webcast'] div[contenteditable]",
        "[class*='chat'] div[contenteditable]",
        "[class*='message-input']", "#message-input",
        "[class*='input-container'] textarea",
        "[class*='input-container'] input",
        "[class*='input-container'] div[contenteditable]",
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.offsetParent !== null) return el;
      }
      // fallback: find any visible textarea
      var textareas = document.querySelectorAll("textarea");
      for (var j = 0; j < textareas.length; j++) {
        if (textareas[j].offsetParent !== null) return textareas[j];
      }
      // fallback: find any visible input
      var inputs = document.querySelectorAll("input:not([type='hidden'])");
      for (var k = 0; k < inputs.length; k++) {
        if (inputs[k].offsetParent !== null) return inputs[k];
      }
      return null;
    },

    findSendButton: function (input) {
      var texts = ["发送", "Send", "发布", "提交", "➤", "发"];

      // Strategy 0（eos 团购中控台）：发送按钮是与输入框同级的 div.button-Wc1yvW（不是 button）。
      // 坑：不能直接 document.querySelector("[class*='input-wrap']") —— 商品面板的搜索框 / 序号框
      // 外层是 okee-current-live-input-wrapper，同样含 "input-wrap" 子串且在文档里更靠前，
      // 会先命中它（实测踩到）。因此必须从"已定位到的评论输入框"往上找它自己的面板：
      //   div.input-wrap-j6Z8oG > div.text-area-CyjKXV > { div.text-input-SqqLWx, div.button-Wc1yvW }
      if (Site.isEos()) {
        var eosIn = input || this._findEosCommentInput();
        var eosScope = (eosIn && eosIn.closest)
          ? (eosIn.closest("[class*='text-area']") || eosIn.closest("[class*='input-wrap']"))
          : null;
        for (var eu = 0; eu < 4 && eosScope; eu++) {
          var eosBtn = eosScope.querySelector("[class*='button-']");
          if (eosBtn && (eosBtn.textContent || "").trim().indexOf("发送") !== -1) return eosBtn;
          eosScope = eosScope.parentElement;
        }
      }

      // Strategy 0（wxch 视频号·弹幕页）：发送按钮 = 评论输入区内的 weui 主按钮（文本「发送」）。
      // 从**已定位到的输入框**往上找一个 scope 再取按钮，避免命中页面里其它 weui 主按钮
      // （例如「添加商品」「确定」这类同为 weui-desktop-btn_primary 的按钮）。
      if (Site.isWxch()) {
        var wxIn = input || this.findCommentInput();
        var wxScope = (wxIn && wxIn.closest) ? wxIn.closest(".live-message-input-container") : null;
        if (wxScope) {
          var wxBtns = wxScope.querySelectorAll("button");
          for (var wi = 0; wi < wxBtns.length; wi++) {
            if ((wxBtns[wi].textContent || "").trim() === "发送") return wxBtns[wi];
          }
        }
      }

      // Strategy 0（buyin / fxg 共用）：与输入框同一个稳定 id 锚点内取 inputSuffix。
      // 这里**刻意不复用**下面的"宽度 < 200"启发式 —— 2026-09-30 实测该判据不可靠：
      // 无 CSS（或页面上存在更宽的同类元素）时真发送按钮会被判掉，返回 null。
      // 锚点 + 文本白名单已经足够精确。
      var sendAnchor = document.getElementById("input-comment-block-id");
      if (sendAnchor) {
        var aSuf = sendAnchor.querySelectorAll("[class*='inputSuffix'], [class*='input-suffix']");
        for (var ai = 0; ai < aSuf.length; ai++) {
          var aTxt = (aSuf[ai].textContent || "").trim();
          if (!aTxt || aSuf[ai].offsetParent === null) continue;
          for (var aj = 0; aj < texts.length; aj++) {
            if (aTxt === texts[aj] || aTxt.indexOf(texts[aj]) !== -1) return aSuf[ai];
          }
        }
      }

      // Strategy 1: search near the chat input (most reliable)
      if (!input) input = this.findCommentInput();
      if (input) {
        // walk up from input through 5 levels of parent to find the chat container
        var container = input.parentElement;
        for (var s = 0; s < 5 && container; s++) {
          if (!container.querySelectorAll) { container = container.parentElement; continue; }
          // 1a: look for inputSuffix class elements (Douyin's send button)
          var suffix = container.querySelectorAll("[class*='inputSuffix'], [class*='input-suffix']");
          for (var i = 0; i < suffix.length; i++) {
            var t = (suffix[i].textContent || "").trim();
            if (t && suffix[i].offsetParent !== null && suffix[i].offsetWidth < 200) {
              for (var j = 0; j < texts.length; j++) {
                if (t === texts[j] || t.includes(texts[j])) return suffix[i];
              }
            }
          }
          // 1b: scan all children for matching text, prefer small elements
          var all = container.querySelectorAll("button, [class*='send'], [class*='btn'], [class*='inputSuffix'], a, div");
          var best = null;
          for (var k = 0; k < all.length; k++) {
            var t2 = (all[k].textContent || "").trim();
            var w = all[k].offsetWidth || 0;
            if (t2 && all[k].offsetParent !== null && w > 0 && w < 200) {
              for (var m = 0; m < texts.length; m++) {
                if (t2 === texts[m] || t2.includes(texts[m])) {
                  if (!best || w < (best.offsetWidth || 999)) best = all[k];
                }
              }
            }
          }
          if (best) return best;
          container = container.parentElement;
        }
      }

      // Strategy 2: global search for inputSuffix elements (specific class match)
      var suffix2 = document.querySelectorAll("[class*='inputSuffix'], [class*='input-suffix']");
      for (var i2 = 0; i2 < suffix2.length; i2++) {
        var t3 = (suffix2[i2].textContent || "").trim();
        if (t3 && suffix2[i2].offsetParent !== null && suffix2[i2].offsetWidth < 200) {
          for (var j2 = 0; j2 < texts.length; j2++) {
            if (t3 === texts[j2] || t3.includes(texts[j2])) return suffix2[i2];
          }
        }
      }

      // Strategy 3: global search for button-like send elements
      var btns = document.querySelectorAll(
        "button[class*='send'], button[class*='chat'], " +
        "button[class*='comment'], [class*='send-btn'], " +
        "[class*='btn-send'], [class*='btn_chat'], " +
        "[class*='webcast'] button"
      );
      for (var i3 = 0; i3 < btns.length; i3++) {
        var t4 = (btns[i3].textContent || "").trim();
        if (t4 && btns[i3].offsetParent !== null && btns[i3].offsetWidth < 200) {
          for (var j3 = 0; j3 < texts.length; j3++) {
            if (t4 === texts[j3] || t4.includes(texts[j3])) return btns[i3];
          }
        }
      }

      return null;
    },

    sendComment: function (text) {
      var input = this.findCommentInput();
      if (!input) {
        log.warn("未找到聊天输入框");
        return false;
      }
      // 输入框有 maxlength 时（eos 评论区实测 = 50）超长内容页面不接受 → 先截断并留痕，
      // 否则会表现为"点了发送但评论没出来"，很难排查
      var maxLen = parseInt(input.getAttribute("maxlength"), 10);
      if (!isNaN(maxLen) && maxLen > 0 && text.length > maxLen) {
        log.warn("回复超过输入框上限 " + maxLen + " 字，已截断：" + text);
        text = text.slice(0, maxLen);
      }
      Utils.triggerVueInput(input, text);
      // 记录本次发送文本，供弹幕监听识别"自己发的弹幕"（60s 窗口内忽略）
      this._rememberSent(text);

      // 禁用态异步驱动的站点（eos 团购 / fxg 抖店 / wxch 视频号）专有发送流程：
      // 空输入时按钮带禁用态 class（eos: button-disable-* / fxg: isDisabled-* /
      // wxch: weui-desktop-btn_disabled），而框架的禁用态在 nextTick 后才更新 →
      // 填完立刻点可能点在禁用按钮上。故等一拍再取一次按钮；仍禁用则退回 Enter。
      // 最后由"输入框是否被清空"判断是否真的发出（只在没发出时才补动作，避免重复发送）。
      if (Site.asyncSendState()) {
        var selfSend = this;
        Utils.sleep(150).then(function () {
          var btnNow = selfSend.findSendButton(input);
          if (btnNow && !selfSend._isSendDisabled(btnNow)) Utils.clickEl(btnNow);
          else Utils.pressEnter(input);
          return Utils.sleep(600);
        }).then(function () {
          var el2 = selfSend.findCommentInput();
          if (el2 && String(el2.value || "").trim()) log.warn("评论可能未发出，输入框仍有内容");
        });
        return true;
      }

      // Strategy 1: try clicking the send button immediately
      var sendBtn = this.findSendButton();
      if (sendBtn) {
        Utils.clickEl(sendBtn);
        return true;
      }

      // Strategy 2: async - wait for framework to process input, then try Enter
      // (one send action only — no blind "click anything nearby" fallback, which
      // could double-send or trigger the wrong control)
      Utils.sleep(300).then(function () {
        try {
          var btn = PageAPI.findSendButton();
          if (btn) { Utils.clickEl(btn); return; }
          Utils.pressEnter(input);
        } catch (e) {
          console.error("[中控助手] sendComment async error:", e);
        }
      });
      return true;
    },

    // 输入框字数上限（取不到返回 0 = 未知）。eos 评论区实测 maxlength=50
    commentMaxLength: function () {
      var el = this.findCommentInput();
      var n = el ? parseInt(el.getAttribute("maxlength"), 10) : NaN;
      return isNaN(n) || n <= 0 ? 0 : n;
    },

    // 发送按钮是否处于禁用态（页面上用 class 表达禁用：eos 是 button-disable-*，
    // fxg / 抖店是 isDisabled-* **驼峰**）→ 必须**大小写不敏感**。
    // 否则 fxg 的禁用态认不出来，会以为按钮可点而空点一下（表现为"自动回复没发出去"）。
    // 无副作用的写法：只把 class 转小写再找，命中范围只增不减（原 eos/buyin 判定不变）。
    _isSendDisabled: function (el) {
      if (!el) return true;
      var cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
      return el.disabled === true ||
             el.getAttribute("aria-disabled") === "true" ||
             cls.indexOf("disable") !== -1;
    },

    // ---------- 最近发送记录（识别"自己发的弹幕"，避免自触发循环） ----------
    // 所有经 sendComment 发送的内容（自动发评/弹幕回复/跨标签页 comment）都会记录文本指纹，
    // 弹幕监听在 60s 窗口内看到相同文本时视为"自己发的"，直接忽略。
    _sentTextAt: {},
    _rememberSent: function (text) {
      if (!text) return;
      // 记录多种形式：原文 + 去"@昵称 "前缀（弹幕区显示时可能带"主播我："等前缀）
      var forms = [text, text.replace(/^@\S+\s*/, "")];
      for (var i = 0; i < forms.length; i++) {
        var fp = forms[i].slice(0, 60);
        if (fp) this._sentTextAt[fp] = Date.now();
      }
      var keys = Object.keys(this._sentTextAt);
      if (keys.length > 300) {
        var cutoff = Date.now() - 60000;
        for (var j = 0; j < keys.length; j++) {
          if (this._sentTextAt[keys[j]] < cutoff) delete this._sentTextAt[keys[j]];
        }
      }
    },
    _isRecentlySent: function (text) {
      if (!text) return false;
      var fp = text.slice(0, 60);
      var t = this._sentTextAt[fp] || 0;
      if (Date.now() - t < 60000) return true;
      delete this._sentTextAt[fp]; // 懒惰清理过期记录
      return false;
    },

    // ---------- Danmaku (弹幕监听) ----------
    _danmakuCache: { container: null, checkedAt: 0 },

    _cls: function (el) {
      return (el && typeof el.className === "string") ? el.className : "";
    },

    // 弹幕容器打分：结构越像"弹幕列表"得分越高（多行 + 昵称元素 + 可滚动）
    _scoreDanmakuContainer: function (el) {
      if (!el || el.nodeType !== 1) return -Infinity;
      // 不可见 → 直接排除
      if (el.offsetParent === null && el.getClientRects().length === 0) return -Infinity;
      if (el.children.length < 2 || el.children.length > 300) return -Infinity;
      var cs;
      try { cs = window.getComputedStyle(el); } catch (_) { return -Infinity; }
      var scrollable = /(auto|scroll)/.test((cs.overflowY || "") + (cs.overflow || ""));
      var score = 0;
      if (scrollable) score += 5;
      var cls = (this._cls(el) + " " + (el.id || "")).toLowerCase();
      if (/product|goods|table|menu|header|footer|toolbar|nav|sidebar/.test(cls)) score -= 6;
      if (/chat|comment|message|danmaku|barrage|interact|webcast|live/.test(cls)) score += 3;
      var rowLike = 0, hasInput = 0, hasProduct = 0;
      var kids = el.children;
      for (var j = 0; j < Math.min(kids.length, 20); j++) {
        var c = kids[j];
        var t = (c.textContent || "").trim();
        if (!t || t.length > 200 || c.querySelector("input, textarea, button")) {
          if (c.querySelector("input, textarea")) hasInput++;
          continue;
        }
        var ccls = (this._cls(c) + " " + (c.id || "")).toLowerCase();
        if (/nickname|user|avatar|name/.test(ccls)) score += 2;
        else if (t.indexOf(":") !== -1 || t.indexOf("：") !== -1) score += 1;
        if (/[¥￥]/.test(t) && /price|cost|stock/.test(ccls)) { hasProduct++; continue; }
        rowLike++;
      }
      if (rowLike >= 2) score += 3;
      if (hasInput > 0) score -= 8;
      if (hasProduct > 0) score -= 8;
      return score;
    },

    // 定位弹幕列表容器（5s 缓存 + 自愈重试）
    findDanmakuContainer: function (force) {
      var now = Date.now();
      // eos（团购中控台）：评论区列表有稳定 id，直接取（比结构打分更可靠）
      if (Site.isEos()) {
        var eosListEl = document.getElementById("comment_all_tab_list_container");
        if (eosListEl) {
          // 评论区所在标签页/面板被隐藏时，脚本照跑但一条弹幕也看不到 →
          // 提示一次（60s 节流），避免主人误以为"扩展坏了"
          if (!Utils.isVisible(eosListEl) && now - (this._eosHiddenWarnAt || 0) > 60000) {
            this._eosHiddenWarnAt = now;
            log.warn("评论区当前不可见（请切到「全部」标签页或展开评论管理），弹幕监听暂不生效");
          }
          this._danmakuCache.container = eosListEl;
          this._danmakuCache.checkedAt = now;
          return eosListEl;
        }
      }
      // wxch（视频号·弹幕页）：容器有稳定 class，直接取，比结构打分可靠
      //   div.live-message-scroller-container            ← 滚动视口
      //   └── div.vue-recycle-scroller.comment__list      ← 虚拟滚动器（节点池在这一层）
      // ⚠️ 必须返回**虚拟滚动器本身**：item-view 是由它管理的节点池，
      //    只观察外层视口拿不到 item 级变更 → 表现为"一条弹幕也读不到"。
      // ⚠️ 定位失败**不回退到通用打分**：这是 antd 页面，通用打分很容易把
      //    侧边栏/工具列表误判成弹幕列表（比"找不到"更糟）。返回 null，由调用方打日志留痕。
      if (Site.isWxch()) {
        var wxList = document.querySelector(".live-message-scroller-container .comment__list") ||
                     document.querySelector(".vue-recycle-scroller.comment__list") ||
                     document.querySelector(".live-message-scroller-container");
        if (wxList) {
          // 评论标签页被切走时容器还在但不可见 → 脚本照跑却读不到弹幕，
          // 提示一次（60s 节流），避免主人误以为"扩展坏了"
          if (!Utils.isVisible(wxList) && now - (this._wxHiddenWarnAt || 0) > 60000) {
            this._wxHiddenWarnAt = now;
            log.warn("评论列表当前不可见（请切到「评论」标签页），弹幕监听暂不生效");
          }
          this._danmakuCache.container = wxList;
          this._danmakuCache.checkedAt = now;
          return wxList;
        }
        return null;
      }
      var cached = this._danmakuCache.container;
      if (!force && cached && cached.isConnected && now - this._danmakuCache.checkedAt < 5000) {
        return cached;
      }
      var best = null, bestScore = 0;
      // 策略1: 特征 class 候选（弹幕/聊天/消息/互动列表）
      var sel = "[class*='chat-list'],[class*='chatList'],[class*='chat_list']," +
        "[class*='comment-list'],[class*='commentList'],[class*='comment_list']," +
        "[class*='message-list'],[class*='messageList'],[class*='message_list']," +
        "[class*='danmaku'],[class*='barrage'],[class*='interact-list']," +
        "[class*='interactList'],[class*='interact_list'],[class*='webcast'] [class*='list']";
      var list = document.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        var s = this._scoreDanmakuContainer(list[i]);
        if (s > bestScore) { bestScore = s; best = list[i]; }
      }
      // 策略2: 可见滚动容器兜底（限制扫描数量避免卡顿）
      if (!best) {
        var scrollers = document.querySelectorAll("div");
        var checked = 0;
        for (var k = 0; k < scrollers.length && checked < 400; k++) {
          var el = scrollers[k];
          if (el.children.length < 2 || el.children.length > 300) continue;
          checked++;
          var s2 = this._scoreDanmakuContainer(el);
          if (s2 > bestScore) { bestScore = s2; best = el; }
        }
      }
      this._danmakuCache.container = best || null;
      this._danmakuCache.checkedAt = now;
      return best;
    },

    // 从一条弹幕 DOM 节点提取 {text, nickname, content, core, isSelf}
    // 中控台弹幕行结构：commentItem > nickname(含 tag 分类徽章) + description(内容文本)
    extractDanmaku: function (node) {
      if (!node || node.nodeType !== 1) return null;
      // eos（团购中控台）评论区是另一套结构 → 走专属提取
      if (Site.isEos()) return this._extractDanmakuEos(node);
      // wxch（视频号）也是另一套结构，且"系统消息没有昵称元素"这一点必须显式处理
      if (Site.isWxch()) return this._extractDanmakuWx(node);
      var t = (node.textContent || "").trim();
      if (!t || t.length > 200) return null;

      // 1) 内容：优先取 description 子元素（干净文本，不含昵称/分类徽章）
      var descEl = node.querySelector("[class*='description']");
      var content = descEl ? (descEl.textContent || "").trim() : "";
      if (!content) content = t;

      // 2) 昵称：nickname 区去掉分类徽章(tag)后的剩余文本，再去尾部冒号
      var nickname = "";
      var nickEl = node.querySelector("[class*='nickname']");
      if (nickEl) {
        nickname = (nickEl.textContent || "").trim();
        var tags = nickEl.querySelectorAll("[class*='tag']");
        for (var i = 0; i < tags.length; i++) {
          var tagText = (tags[i].textContent || "").trim();
          if (tagText) nickname = nickname.split(tagText).join("");
        }
        nickname = nickname.replace(/[：:\s]+$/, "").trim().slice(0, 40);
      }
      // 兜底：从全文解析 "昵称：内容"
      if (!nickname) {
        var m = t.match(/^(.{1,40}?)[：:]\s*(.+)$/);
        if (m) nickname = m[1];
      }
      var nickInfo = this._cleanNickname(nickname);
      return {
        text: t,
        nickname: nickInfo.name,
        content: content,
        core: this._extractCore(content),
        isSelf: nickInfo.isSelf,
      };
    },

    // ---- eos（团购中控台）评论区行提取 ----
    // 实测结构（2026-09-14）：
    //   div.item-*
    //   ├── span.tag-*           ← 系统标签（如"可能选品难"），不是昵称
    //   ├── div.item-name-*      ← "昵称："（含尾部全角冒号）
    //   └── div.item-content-*   ← 内容；系统消息（"xx浏览直播货架中"）没有此元素
    _extractDanmakuEos: function (node) {
      var nameEl = node.querySelector("[class*='item-name']");
      if (!nameEl) return null;                                   // 不是评论行
      var contentEl = node.querySelector("[class*='item-content']");
      var content = contentEl ? (contentEl.textContent || "").trim() : "";
      if (!content) return null;                                  // 系统消息 → 跳过
      if (content.length > 200) return null;
      var nickname = (nameEl.textContent || "").trim()
        .replace(/[：:\s]+$/, "")                                 // 去尾部冒号（全角/半角）
        .slice(0, 40);
      var nickInfo = this._cleanNickname(nickname);
      return {
        text: nickname + "：" + content,
        nickname: nickInfo.name,
        content: content,
        core: this._extractCore(content),
        isSelf: nickInfo.isSelf,
      };
    },

    // ---- wxch（视频号·弹幕页）消息行提取 ----
    // 实测结构（2026-10-10 主人给的真实 DOM）：
    //   div.live-message-item-container > div.live-message-item
    //     ├── span.message-type             «主播»  ← **只有主播自己发言才有** → isSelf 判据
    //     ├── span.finder-ui-live-*-badge    «买过4单» / «粉丝» / 等级徽章（不是昵称）
    //     ├── span.message-username-desc     «娥:»   ← **昵称**（带尾部全角冒号）
    //     └── span.message-content           «1号和2号有啥不同» ← 内容
    // ⚠️ 本站最容易踩的坑：**系统消息只有 message-content、没有 message-username-desc**
    //    （«琼赞了直播» / «ZFJ关注了主播» / «娥**  下单了1号商品»）。
    //    若让它走通用兜底（昵称取全文），就会把"琼赞了直播"当成观众发言送去匹配关键词
    //    → 给系统消息发回复。所以这里取不到昵称元素就**直接返回 null 跳过**。
    _extractDanmakuWx: function (node) {
      var item = (node.classList && node.classList.contains("live-message-item"))
        ? node
        : (node.querySelector ? node.querySelector(".live-message-item") : null);
      if (!item) return null;
      var contentEl = item.querySelector(".message-content");
      if (!contentEl) return null;
      var content = (contentEl.textContent || "").trim();
      if (!content || content.length > 200) return null;
      var nameEl = item.querySelector(".message-username-desc");
      if (!nameEl) return null;                                  // 系统消息 / 进入提示 → 跳过
      var nickname = (nameEl.textContent || "").trim()
        .replace(/[：:\s]+$/, "")                                // 去尾部冒号（全角/半角）
        .slice(0, 40);
      if (!nickname) return null;
      // isSelf：视频号用独立的 message-type 元素标明身份，比猜店名可靠得多
      // （也避免把"本店名"这类业务信息写进代码）
      var isSelf = false;
      var typeEl = item.querySelector(".message-type");
      if (typeEl && (typeEl.textContent || "").indexOf("主播") !== -1) isSelf = true;
      if (!isSelf) isSelf = this._cleanNickname(nickname).isSelf;
      return {
        text: nickname + "：" + content,
        nickname: nickname,
        content: content,
        core: this._extractCore(content),
        isSelf: isSelf,
      };
    },

    // 常见中控台消息分类标签（"问询"等不是用户昵称）
    _MSG_TAGS: ["问询", "咨询", "求购", "售后", "投诉", "粉丝团", "关注", "点赞", "进入直播间", "进入直播", "连麦", "打赏", "分享", "评论"],

    _escRe: function (s) {
      return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    },

    // 去掉文本开头的分类标签（如 "问询：xxx" → "xxx"）
    _stripTags: function (s) {
      var out = (s || "").trim();
      for (var i = 0; i < this._MSG_TAGS.length; i++) {
        var re = new RegExp("^" + this._escRe(this._MSG_TAGS[i]) + "[·：:\\s]*");
        if (re.test(out)) { out = out.replace(re, ""); break; }
      }
      return out;
    },

    // 提取弹幕核心内容：去分类标签 → 去"昵称："前缀 → 去"@昵称"前缀
    // 同一弹幕被多个 DOM 层级捕获时文本不同，但核心内容一致，用它做去重指纹
    _extractCore: function (t) {
      var s = this._stripTags(t);
      s = s.replace(/^.{1,40}?[：:]\s*/, "");
      s = s.replace(/^@\S+\s*/, "");
      return s.trim();
    },

    // 清洗昵称：去分类标签、身份标记；返回 {name, isSelf}
    _cleanNickname: function (nick) {
      var result = { name: "", isSelf: false };
      var raw = (nick || "").trim().slice(0, 40);
      if (!raw) return result;
      for (var i = 0; i < this._MSG_TAGS.length; i++) {
        if (raw.indexOf(this._MSG_TAGS[i]) === 0) { raw = raw.slice(this._MSG_TAGS[i].length); break; }
      }
      // "我"/"主播我" → 主播自己发的消息（自问自答场景，应跳过）
      var selfOnly = raw.replace(/^(主播|管理员|助理)[·\s]*/, "");
      if (selfOnly === "我" || raw === "我") result.isSelf = true;
      // eos：评论区不显示"我"，自己的消息显示为店铺账号名 → 用门店名反查
      if (!result.isSelf && this._isOwnStoreName(raw)) result.isSelf = true;
      result.name = raw.trim().slice(0, 40);
      return result;
    },

    // 本店名缓存（eos）：从团购商品卡的门店名节点读取
    _eosStoreName: "",
    _eosStoreNameAt: 0,

    // eos：评论昵称是否就是本店账号（自己发的评论不该触发自动回复）
    _isOwnStoreName: function (nick) {
      if (!Site.isEos()) return false;
      if (!this._eosStoreName || Date.now() - this._eosStoreNameAt > 30000) {
        // 门店名节点带 render-* 哈希类；实测它位于商品卡的门店行内：
        //   [class*='poi-'] > [class*='text-leGBEX'] > [class*='render-nXrSFh']
        // 先按实测结构精确命中；再退回全局扫描，并排除商品名节点（card-name 内）的候选，
        // 否则商品行同名类会把"商品名"误当门店名
        var storeExact = document.querySelector("[class*='poi-'] [class*='render-nXrSFh']");
        var picked = storeExact ? (storeExact.textContent || "").trim() : "";
        if (!picked) {
          var cands = document.querySelectorAll("[class*='render-nXrSFh'], [class*='fictitious-gAsHPZ']");
          for (var ci = 0; ci < cands.length; ci++) {
            if (cands[ci].closest && cands[ci].closest("[class*='card-name']")) continue;
            picked = (cands[ci].textContent || "").trim();
            if (picked) break;
          }
        }
        if (!picked) log.warn("未识别到本店门店名，自身评论可能被当作观众触发回复");
        this._eosStoreName = picked;
        this._eosStoreNameAt = Date.now();
      }
      var store = this._eosStoreName;
      // 评论区昵称可能是门店名的子串（门店名带行政区前缀如"XX市…"，评论区不带）→ 双向包含判定
      if (!store || !nick || nick.length < 4) return false;
      return store.indexOf(nick) !== -1 || nick.indexOf(store) !== -1;
    },

    // 弹幕列表的真实滚动层（子容器），让 mutation 粒度更接近"弹幕行"；找不到返回原容器
    _resolveListContainer: function (container) {
      if (!container) return null;
      // eos：评论区容器本身就是行级列表（子元素即评论行），不要往下钻
      if (Site.isEos()) return container;
      // wxch：返回的是 vue-virtual-scroller 本身，它的子层是节点池 + item-wrapper，
      // 往下钻只会钻到 item-wrapper（比 scroller 更"深"但监听面更窄）→ 原样返回
      if (Site.isWxch()) return container;
      if (this._scoreDanmakuContainer(container) >= 10) return container;
      var best = null, bestScore = 0;
      for (var i = 0; i < container.children.length; i++) {
        var c = container.children[i];
        var s = this._scoreDanmakuContainer(c);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return best || container;
    },

    // 诊断：把候选弹幕/评论区容器信息输出到控制台，方便适配页面结构变化
    dumpDanmakuCandidates: function () {
      try {
        var cands = document.querySelectorAll(
          "[class*='chat'],[class*='message'],[class*='comment'],[class*='danmaku']," +
          "[class*='interact'],[class*='webcast'],[id*='comment'],[id*='chat'],[id*='message']"
        );
        var lines = [];
        for (var i = 0; i < Math.min(cands.length, 30); i++) {
          var el = cands[i];
          lines.push(el.tagName.toLowerCase() +
            (el.id ? ("#" + el.id) : ("." + this._cls(el).split(" ").slice(0, 3).join("."))) +
            " 子元素:" + el.children.length);
        }
        console.log("[中控助手] 候选容器:", lines);
      } catch (_) {}
    },
  };

  // ========================================================================
  //  AUTO EXPLAIN MODULE
  // ========================================================================
  var AutoExplain = {
    running: false,
    _timer: null,
    _order: [],        // current round: products in play order
    _orderIndex: 0,    // progress within the current round
    _filtered: null,
    _failCount: 0,
    _rounds: 0,
    _singleMode: false, // only 1 product → alternate explain ↔ pause
    _phase: "explain",  // "explain" | "pause" (single-product mode)

    config: {
      interval: 15,        // seconds between products / explain duration (single mode)
      randomDelay: 5,      // extra random seconds (±)
      shuffle: false,      // randomize product order every round
      // Single-product mode pauses for a fixed 3s (not configurable).
      // Always loops through products (repeat is intrinsic, no UI toggle).
    },

    start: function (indicesStr) {
      if (this.running) return;
      var allProducts = PageAPI.scanProducts();
      if (allProducts.length === 0) {
        log.warn("未扫描到商品，请确认已在直播中控台页面");
        return;
      }
      this.running = true;
      this._orderIndex = 0;
      this._filtered = null;
      this._failCount = 0;
      this._rounds = 0;
      this._singleMode = false;
      this._phase = "explain";

      // parse and filter by indices
      var products;
      if (indicesStr && indicesStr.trim()) {
        var indices = Utils.parseIndices(indicesStr, allProducts.length);
        if (!indices || indices.length === 0) {
          log.warn("指定的商品序号无效");
          this.running = false;
          Panel._syncRunState(); // 启动失败回滚 → 按钮跟随真实状态
          return;
        }
        products = [];
        for (var i = 0; i < indices.length; i++) {
          if (indices[i] < allProducts.length) products.push(allProducts[indices[i]]);
        }
        this._filtered = products; // keep the filtered list for every round
        log.info("已选择 " + products.length + " 个商品（序号过滤）");
      } else {
        products = allProducts.slice();
      }

      this._order = this._buildOrder(products);
      log.ok("自动讲解已启动，共 " + this._order.length + " 个商品，间隔 " +
        this.config.interval + "s ± " + this.config.randomDelay + "s" +
        (this.config.shuffle ? "，打乱顺序" : "，按序号顺序"));
      Panel._syncRunState();
      this._doNext();
    },

    stop: function () {
      this.running = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      log.info("自动讲解已停止");
      Panel._syncRunState();
    },

    // build the play order for one round: sequential, or Fisher–Yates shuffled
    _buildOrder: function (products) {
      var order = products.slice();
      if (!this.config.shuffle || order.length < 2) return order;
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      return order;
    },

    _doNext: function () {
      if (!this.running) return;
      try {
        // start of a new round → (re)build the play order from a fresh scan
        if (this._order.length === 0) {
          var all = this._filtered || PageAPI.scanProducts();
          if (!all || all.length === 0) {
            if (this._filtered) {
              log.warn("指定商品列表为空，停止");
              this.stop();
            } else {
              log.warn("商品列表为空，重试中...");
              this._timer = setTimeout(this._doNext.bind(this), 5000);
            }
            return;
          }
          this._order = this._buildOrder(all);
          this._orderIndex = 0;
          // single selected product → alternate explain ↔ pause every cycle
          this._singleMode = all.length === 1;
          this._phase = "explain";
          log.info("扫描到 " + all.length + " 个商品，本轮开始" +
            (this._singleMode ? "（单商品模式）" : ""));
          if (this._singleMode) {
            log.info("单商品轮播: 讲解 " + this.config.interval + "s ± " + this.config.randomDelay +
              "s，暂停固定 5s");
          }
          if (this._rounds > 0) {
            log.info("完成一轮，重新开始" + (this.config.shuffle ? "（已重新打乱顺序）" : ""));
          }
        }

        var product = this._order[this._orderIndex];
        if (!product) {
          this._orderIndex++;
          this._scheduleNext();
          return;
        }

        var pname = product.name || "未知商品";
        var pid = product.id || "?";

        // ---- single-product mode: explain → pause → explain → …
        // 注：eos 虚拟列表场景下 clickExplain/cancelExplain 返回 Promise（先滚动渲染再点击），
        // 这里统一用 Promise.resolve 兼容同步/异步两种返回值
        if (this._singleMode) {
          var selfSingle = this;
          var wasExplain = this._phase === "explain";
          if (wasExplain) {
            log.info("讲解: " + pname + " [ID:" + pid + "]");
            this._phase = "pause";
          } else {
            log.info("暂停: " + pname + " [ID:" + pid + "]");
            this._phase = "explain";
          }
          var action = wasExplain
            ? PageAPI.clickExplain(product)
            : PageAPI.cancelExplain(product);
          Promise.resolve(action).then(function (ok1) {
            if (!selfSingle.running) return;
            if (ok1) {
              selfSingle._failCount = 0;
              log.ok((wasExplain ? "已点击讲解: " : "已取消讲解: ") + pname + " [ID:" + pid + "]");
            } else {
              selfSingle._failCount++;
              log.warn((wasExplain ? "未找到讲解按钮: " : "取消讲解失败: ") + pname + " [ID:" + pid + "]");
            }
            if (selfSingle._failCount >= 3) {
              log.err("连续 3 次操作失败，自动停止（页面结构可能已变化，请刷新后重试）");
              selfSingle.stop();
              return;
            }
            // 讲解阶段 → 按 interval；暂停阶段 → 固定 5s 后再讲解
            if (wasExplain) selfSingle._scheduleNext(selfSingle.config.interval);
            else selfSingle._timer = setTimeout(selfSingle._doNext.bind(selfSingle), 5000);
          });
          return;
        }

        // ---- multi-product mode: explain each product in order
        var selfMulti = this;
        log.info("讲解: " + pname + " [ID:" + pid + "]");
        Promise.resolve(PageAPI.clickExplain(product)).then(function (ok) {
          if (!selfMulti.running) return;
          if (ok) {
            selfMulti._failCount = 0;
            log.ok("已点击讲解: " + pname + " [ID:" + pid + "]");
          } else {
            selfMulti._failCount++;
            log.warn("未找到讲解按钮: " + pname + " [ID:" + pid + "]");
            if (selfMulti._failCount >= 3) {
              log.err("连续 3 次操作失败，自动停止（页面结构可能已变化，请刷新后重试）");
              selfMulti.stop();
              return;
            }
          }
          selfMulti._orderIndex++;
          if (selfMulti._orderIndex >= selfMulti._order.length) {
            selfMulti._order = []; // round complete → rebuilt with a fresh scan next time
            selfMulti._rounds++;
          }
          selfMulti._scheduleNext();
        });
      } catch (e) {
        log.err("自动讲解出错: " + (e && e.message));
        this._failCount++;
        if (this._failCount >= 3) { this.stop(); return; }
        this._scheduleNext();
      }
    },

    _scheduleNext: function (baseInterval) {
      if (!this.running) return;
      if (baseInterval === undefined) baseInterval = this.config.interval;
      // delay = baseInterval ± randomDelay (seconds), clamped to >= 1s
      var jitter = (Math.random() * 2 - 1) * this.config.randomDelay;
      var delay = Math.max((baseInterval + jitter) * 1000, 1000);
      this._timer = setTimeout(this._doNext.bind(this), delay);
    },

    setConfig: function (cfg) {
      for (var k in cfg) {
        if (this.config.hasOwnProperty(k)) this.config[k] = cfg[k];
      }
    },
  };

  // ========================================================================
  //  AUTO COMMENT MODULE
  // ========================================================================
  var AutoComment = {
    running: false,
    _timer: null,
    _msgIndex: 0,
    _failCount: 0,

    config: {
      interval: 30,       // seconds between messages
      randomDelay: 10,    // extra random seconds
      messages: ["欢迎来到直播间！", "主播加油！"], // default templates
      shuffle: false,
    },

    start: function () {
      if (this.running) return;
      if (!this.config.messages || this.config.messages.length === 0) {
        log.warn("请先添加评论内容");
        return;
      }
      this.running = true;
      this._msgIndex = 0;
      this._failCount = 0;
      log.ok("自动发评已启动，共 " + this.config.messages.length + " 条消息，间隔 " + this.config.interval + "s ± " + this.config.randomDelay + "s");
      Panel._syncRunState();
      this._doNext();
    },

    stop: function () {
      this.running = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      log.info("自动发评已停止");
      Panel._syncRunState();
    },

    _doNext: function () {
      try {
        if (!this.running) return;
        var msgs = this.config.messages;
        if (msgs.length === 0) { this.stop(); return; }

        var idx = this._msgIndex % msgs.length;
        var text = msgs[idx];
        if (this.config.shuffle) {
          idx = Math.floor(Math.random() * msgs.length);
          text = msgs[idx];
        }

        var ok = PageAPI.sendComment(text);
        if (ok) {
          this._failCount = 0;
          log.ok("已发送: " + text.substring(0, 30));
        } else {
          this._failCount++;
          log.warn("发送失败，未找到聊天输入框和发送按钮");
          if (this._failCount >= 3) {
            log.err("连续 3 次发送失败，自动停止（页面结构可能已变化，请刷新后重试）");
            this.stop();
            return;
          }
        }

        this._msgIndex++;
        this._scheduleNext();
      } catch (e) {
        log.err("自动发评出错: " + e.message);
        this._failCount++;
        if (this._failCount >= 3) { this.stop(); return; }
        this._scheduleNext();
      }
    },

    _scheduleNext: function () {
      if (!this.running) return;
      // delay = interval ± randomDelay (seconds), clamped to >= 1s
      var jitter = (Math.random() * 2 - 1) * this.config.randomDelay;
      var delay = Math.max((this.config.interval + jitter) * 1000, 1000);
      this._timer = setTimeout(this._doNext.bind(this), delay);
    },

    setConfig: function (cfg) {
      for (var k in cfg) {
        if (this.config.hasOwnProperty(k)) this.config[k] = cfg[k];
      }
    },
  };

  // ========================================================================
  //  AUTO REPLY MODULE – 弹幕关键词自动回复
  //  监听直播间弹幕列表（DOM MutationObserver），命中关键词 → 自动发送设定回复。
  //  复用 PageAPI.sendComment；内置文本去重/同用户冷却/每分钟限频/随机延迟，防风控。
  // ========================================================================
  var AutoReply = {
    running: false,
    _observer: null,
    _container: null,
    _healthTimer: null,
    _lastTextAt: {},      // 文本指纹 → 时间戳（8s 窗口去重，同一弹幕只触发一次）
    _lastUserAt: {},      // 昵称 → 时间戳（同用户冷却）
    _queue: [],           // 待发送队列，串行发送防止输入框内容互相覆盖
    _sending: false,
    _sentThisMinute: [],  // 每分钟发送时间戳（滑动窗口限频）
    _matchedCount: 0,
    _repliedCount: 0,
    _failCount: 0,

    config: {
      delayMin: 1,        // 命中后随机延迟下限（秒）——后台默认，不暴露 UI
      delayMax: 2,        // 上限（秒）
      userCooldown: 60,   // 同一用户冷却（秒）
      maxPerMinute: 6,    // 每分钟最多回复条数（防风控）
      useNickname: true,  // 回复内容中的 {nickname} 替换为对方昵称（默认开启）
    },

    rules: [],            // [{keywords: [...], reply: "...", enabled: true}]

    start: function () {
      if (this.running) return;
      if (!this.rules || this.rules.length === 0) {
        log.warn("弹幕回复：请先配置关键词规则（每行：关键词|关键词 => 回复内容）");
        Panel._syncRunState();
        return;
      }
      var container = PageAPI.findDanmakuContainer(true);
      if (!container) {
        log.err("弹幕回复：未找到" + (Site.isEos() ? "评论区" : "弹幕") + "列表容器，请确认" +
          (Site.isEos() ? "团购中控台的评论区标签页已打开" : "直播中控台聊天区已打开"));
        PageAPI.dumpDanmakuCandidates();
        log.warn("候选容器信息已输出到控制台(F12)，把截图反馈给我即可适配");
        Panel._syncRunState();
        return;
      }
      this.running = true;
      this._container = PageAPI._resolveListContainer(container) || container;
      this._lastTextAt = {};
      this._lastUserAt = {};
      this._queue = [];
      this._sending = false;
      this._sentThisMinute = [];
      this._matchedCount = 0;
      this._repliedCount = 0;
      this._failCount = 0;
      // wxch（视频号）：虚拟滚动用节点池复用 DOM → 走"扫可见行 + 按 data-index 去重"策略。
      // 启动时先把**当前已渲染的行**标记为已见，只回复"启动之后新来的"弹幕
      // —— 与其它站点「只看新增节点」的语义对齐，否则一启动就会把历史弹幕全部回复一遍。
      this._wxSeenIndex = {};
      if (Site.isWxch()) this._seedWxSeen();

      this._startObserver();
      this._healthTimer = setInterval(this._healthCheck.bind(this), 10000);
      log.ok("弹幕回复已启动，监听中（命中关键词自动回复）");
      log.info("弹幕容器: <" + this._container.tagName.toLowerCase() + (PageAPI._cls(this._container) ? " class='" + PageAPI._cls(this._container).slice(0, 60) + "'" : "") + ">");
      log.info("规则 " + this.rules.length + " 条，命中后延迟 " + this.config.delayMin + "~" + this.config.delayMax + "s 回复，同用户冷却 " + this.config.userCooldown + "s，上限 " + this.config.maxPerMinute + " 条/分钟");
      Panel._syncRunState();
    },

    stop: function () {
      this.running = false;
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._healthTimer) { clearInterval(this._healthTimer); this._healthTimer = null; }
      this._container = null;
      this._queue = [];
      this._sending = false;
      log.info("弹幕回复已停止");
      Panel._syncRunState();
    },

    setConfig: function (cfg) {
      for (var k in cfg) {
        if (this.config.hasOwnProperty(k)) this.config[k] = cfg[k];
      }
    },

    setRules: function (rules) { this.rules = rules || []; },

    getStats: function () {
      return { running: this.running, matched: this._matchedCount, replied: this._repliedCount };
    },

    // 统一观察入口：站点差异集中在这里，避免两处 observe 各写一份、改一处漏一处。
    _startObserver: function () {
      if (!this._container) return;
      if (this._observer) this._observer.disconnect();
      this._observer = new MutationObserver(this._onMutation.bind(this));
      this._observer.observe(this._container, {
        childList: true,
        subtree: true,
        // wxch（视频号）是 vue-virtual-scroller：节点池复用会让"新消息"表现为
        // **既有节点文本被改写**（没有 addedNodes）→ 必须一并观察 characterData
        characterData: Site.isWxch(),
      });
    },

    // wxch 专用：启动时把当前已渲染的行标记为已见（只回复启动后的新弹幕）
    _seedWxSeen: function () {
      var listEl = this._container || PageAPI.findDanmakuContainer();
      if (!listEl) return;
      var rows = listEl.querySelectorAll("[data-index]");
      for (var i = 0; i < rows.length; i++) {
        var idx = rows[i].getAttribute("data-index");
        if (idx !== null && idx !== "") this._wxSeenIndex[idx] = true;
      }
      log.info("已忽略启动前已渲染的弹幕（只回复启动后新来的）");
    },

    // wxch 专用：扫当前渲染出来的消息行 → 按 data-index 去重后逐条处理。
    // 为什么不用 mutations 的 addedNodes：vue-virtual-scroller 复用节点池，
    // 同一条 item-view 会被反复改写内容，新消息可能完全没有 addedNodes。
    // data-index 是虚拟滚动器给每条消息的稳定序号（实测 6,7,8… 连续递增），
    // 拿它当去重键比"文本指纹"可靠 —— 同一观众连发两条相同内容也能正确区分。
    _scanWxRows: function () {
      var listEl = this._container;
      if (!listEl || !listEl.isConnected) listEl = PageAPI.findDanmakuContainer();
      if (!listEl) return;
      var rows = listEl.querySelectorAll("[data-index]");
      for (var i = 0; i < rows.length; i++) {
        var idx = rows[i].getAttribute("data-index");
        if (idx === null || idx === "") continue;
        if (this._wxSeenIndex[idx]) continue;
        // ⚠️ 节点池是"先挂 data-index、后填内容"的：内容还没渲染出来时**不能**标记已见，
        //    否则这条会被永久跳过（等下一次 mutation 再来处理）
        if (!rows[i].querySelector(".live-message-item")) continue;
        this._wxSeenIndex[idx] = true;
        this._handleNode(rows[i]);
      }
    },

    _onMutation: function (mutations) {
      if (!this.running) return;
      // wxch（视频号）：虚拟滚动复用节点池，新消息未必以 addedNodes 出现 →
      // 这里只把 mutations 当"列表有变化了"的触发信号，不看内容，直接扫可见行去重。
      if (Site.isWxch()) return this._scanWxRows();
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        if (!added || added.length === 0) continue;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType !== 1) continue;
          this._handleNode(node);
          // 有些弹幕列表新增的是包裹容器，展开一层子节点再检查
          if (node.children && node.children.length > 0 && node.children.length <= 5) {
            for (var c = 0; c < node.children.length; c++) {
              if (node.children[c].nodeType === 1) this._handleNode(node.children[c]);
            }
          }
        }
      }
    },

    _handleNode: function (node) {
      // eos 评论区是 Vue 整块渲染：新增节点常常是"装着十几行的包裹容器"，
      // 此时直接提取会取到"第一行的昵称 + 后面某一行的内容"这种错配 →
      // 先把它拆成一行一行再处理（行本身命中时不做递归，避免自循环）
      if (Site.isEos()) {
        var listEl = PageAPI.findDanmakuContainer();
        var nameEls = node.querySelectorAll("[class*='item-name']");
        if (nameEls.length > 0 && listEl && listEl.contains(node)) {
          var expanded = false;
          for (var ri = 0; ri < nameEls.length; ri++) {
            // 行 = 昵称节点向上走到"父节点就是评论容器"的那一层
            // （不能用 closest('[class*=item-]')：item-name-*/item-content-* 也以 item- 开头）
            var rowEl = nameEls[ri];
            while (rowEl.parentElement && rowEl.parentElement !== listEl) rowEl = rowEl.parentElement;
            if (rowEl.parentElement === listEl && rowEl !== node) {
              this._handleNode(rowEl);
              expanded = true;
            }
          }
          if (expanded) return; // 已按行处理完毕
        }
      }
      var dm = PageAPI.extractDanmaku(node);
      if (!dm) return;
      // 忽略主播自己（"我"/"主播我"）的消息——自动回复在弹幕区也显示为"主播我"，一并规避自触发
      if (dm.isSelf) return;
      // 忽略自己刚发送的内容（双指纹：完整文本 + 内容文本）
      if (PageAPI._isRecentlySent(dm.text)) return;
      if (dm.content && dm.content !== dm.text && PageAPI._isRecentlySent(dm.content)) return;
      var rule = this._matchRule(dm.content || dm.text);
      if (!rule) return;
      // 内容去重：同一弹幕被多个 DOM 层级捕获时提取文本不同，但内容一致
      var now = Date.now();
      var fp = (dm.content || dm.core || dm.text).slice(0, 60);
      if (this._lastTextAt[fp] && now - this._lastTextAt[fp] < 10000) return;
      this._lastTextAt[fp] = now;
      this._matchedCount++;
      log.info("弹幕命中 [" + (dm.nickname || "?") + "]: " + (dm.content || dm.text).substring(0, 40));
      this._enqueue(dm, rule);
    },

    _matchRule: function (text) {
      for (var i = 0; i < this.rules.length; i++) {
        var r = this.rules[i];
        if (!r || !r.enabled || !r.reply || !r.keywords) continue;
        for (var k = 0; k < r.keywords.length; k++) {
          var kw = r.keywords[k];
          if (!kw) continue;
          if (text.indexOf(kw) !== -1) return r; // 包含匹配
        }
      }
      return null;
    },

    _enqueue: function (dm, rule) {
      // 同用户冷却
      if (dm.nickname) {
        var last = this._lastUserAt[dm.nickname] || 0;
        if (Date.now() - last < this.config.userCooldown * 1000) return;
        this._lastUserAt[dm.nickname] = Date.now();
      }
      // 每分钟限频
      var cutoff = Date.now() - 60000;
      this._sentThisMinute = this._sentThisMinute.filter(function (t) { return t > cutoff; });
      if (this._sentThisMinute.length >= this.config.maxPerMinute) {
        log.warn("弹幕回复：已达每分钟上限(" + this.config.maxPerMinute + "条)，本条跳过");
        return;
      }
      var reply = rule.reply;
      // 自动 @ 用户：把对方昵称提到回复前面（@昵称 + 空格 + 回复），对方会收到提醒
      // 兼容 {nickname} 占位符：用户显式写了 {nickname} 时替换，否则默认加前缀
      if (dm.nickname) {
        if (this.config.useNickname && reply.indexOf("{nickname}") !== -1) {
          reply = reply.replace(/\{nickname\}/g, dm.nickname);
        } else {
          reply = this._withNickname(reply, dm.nickname);
        }
      }
      this._queue.push({ reply: reply, nickname: dm.nickname });
      this._drainQueue();
    },

    // 拼 "@昵称 " 前缀。输入框有字数上限时（eos 评论区实测 50 字）优先保证回复完整：
    // 放不下就省略 @，否则会被截断成半句话（省略会打日志，便于主人判断是否要改规则）
    _withNickname: function (reply, nickname) {
      var composed = "@" + nickname + " " + reply;
      var max = PageAPI.commentMaxLength();
      if (max > 0 && composed.length > max) {
        log.warn("输入框限 " + max + " 字，本条省略 @昵称 以保证回复完整：" + reply);
        return reply;
      }
      return composed;
    },

    _drainQueue: function () {
      if (this._sending || this._queue.length === 0 || !this.running) return;
      var item = this._queue.shift();
      this._sending = true;
      var delay = this.config.delayMin + Math.random() * Math.max(this.config.delayMax - this.config.delayMin, 0);
      var self = this;
      setTimeout(function () {
        try {
          var ok = PageAPI.sendComment(item.reply);
          if (ok) {
            self._failCount = 0;
            self._repliedCount++;
            self._sentThisMinute.push(Date.now());
            log.ok("已回复" + (item.nickname ? " @" + item.nickname : "") + ": " + item.reply.substring(0, 30));
          } else {
            self._failCount++;
            log.warn("回复发送失败，未找到聊天输入框");
            if (self._failCount >= 3) {
              log.err("弹幕回复：连续 3 次发送失败，自动停止（页面结构可能已变化，请刷新后重试）");
              self.stop();
              return;
            }
          }
        } catch (e) {
          log.err("弹幕回复出错: " + e.message);
        }
        self._sending = false;
        // 发送间隔至少 1.5s，避免输入框内容被下一条覆盖
        setTimeout(function () { self._drainQueue(); }, 1500);
      }, Math.round(delay * 1000));
    },

    // 容器失效自愈：SPA 频繁 re-render，失效后重新定位并重建监听
    _healthCheck: function () {
      if (!this.running) return;
      if (!this._container || !this._container.isConnected) {
        log.warn("弹幕容器已失效，重新定位...");
        var c = PageAPI.findDanmakuContainer(true);
        if (c) {
          this._container = PageAPI._resolveListContainer(c) || c;
          // 容器换了 → 之前记的 data-index 已失义，重新播种（否则新容器的历史会全部被当新消息）
          if (Site.isWxch()) { this._wxSeenIndex = {}; this._seedWxSeen(); }
          this._startObserver();
          log.ok("弹幕容器已重新定位");
        } else {
          log.warn("暂未找到弹幕容器，10 秒后重试");
        }
      }
    },
  };

  // ========================================================================
  //  CONFIG – light persistence in page localStorage (zero backend deps)
  // ========================================================================
  var Config = {
    get: function (key, def) {
      try {
        var raw = localStorage.getItem("dy_" + key);
        if (!raw) return def;
        var v = JSON.parse(raw);
        return v === undefined || v === null ? def : v;
      } catch (_) { return def; }
    },
    set: function (key, val) {
      try { localStorage.setItem("dy_" + key, JSON.stringify(val)); } catch (_) {}
    },
  };

  // ========================================================================
  //  UI PANEL
  // ========================================================================
  var Panel = {
    _el: null,

    init: function () {
      if (document.getElementById("dy-assistant-panel")) return;
      var P = this._createPanel();
      this._el = P.panel;
      this._bindDrag(P.header);
      this._bindTabs();
      document.body.appendChild(this._el);

      this._bindControls();
      this._loadSavedConfig();

      // 初始状态同步：若模块已在运行（面板重建 / 拖拽后被重挂），按钮与 tab 点立即跟上
      this._syncRunState();

      // Init log console reference
      log.init(document.getElementById("dy-console"));

      // Scan products on open
      this.refreshProducts();
      // 视频号弹幕页：本页无商品 → 从商品页拉一次只读清单填进面板
      if (Site.isWxch() && Site.page() === "comment") this.refreshWxGoods();
      log.info("中控小助手已加载 · 站点：" + Site.label());
      log.info("页面: " + (Probe.getPageType() || "未知"));
      if (Probe.hasVue()) log.ok("检测到 Vue " + (Probe.getVue().version || "") + " 应用");

      var net = Probe.getNetwork();
      if (net.length > 0) log.ok("已捕获 " + net.length + " 个网络请求");
      var prods = Probe.getProducts();
      if (prods.length > 0) log.ok("已预扫描 " + prods.length + " 个商品");
    },

    _createPanel: function () {
      var panel = document.createElement("div");
      panel.id = "dy-assistant-panel";

      // 视频号把「弹幕」和「商品」拆成两个页面。第一轮跨页链路没通，所以弹幕页不渲染
      // 「自动讲解」tab（铁律：点了没反应的按钮比没有更坏）。**现在跨页链路已通**，
      // 弹幕页的「开始」会去驱动商品页的 AutoExplain（缺页时 background 自动后台打开）
      // → tab 恢复显示。
      var showExplain = true;

      // 视频号弹幕页：**本页看不到任何商品**，序号框等于"盲输"。
      // 跨页链路已通 → 在这里放一块**只读**商品清单（序号/名称/价格 + 标出讲解中），
      // 数据由 Cross.call("list_products") 从商品页取回。既治盲输，也是"跨页真通了"的活证据。
      var isWxComment = Site.isWxch() && Site.page() === "comment";
      var wxGoodsBlock = isWxComment
        ? ('<div class="dy-section-title" style="display:flex;align-items:center">' +
             '<span style="flex:1">商品页商品列表</span>' +
             '<a id="dy-wx-goods-refresh" style="cursor:pointer;color:#89b4fa;font-weight:normal">刷新</a>' +
           '</div>' +
           '<div id="dy-wx-goods-list" style="font-size:11px;line-height:1.6;color:#a6adc8;' +
             'max-height:118px;overflow:auto;padding:2px 0">读取中…</div>')
        : "";

      panel.innerHTML =
        '<div id="dy-panel-header">' +
          '<span class="title" title="当前站点：' + Site.label() + '">🎯 ' + Site.short() + '中控小助手</span>' +
          '<span class="min-btn" id="dy-min-btn">_</span>' +
        '</div>' +
        '<div id="dy-panel-tabs">' +
          (showExplain ? '<div class="tab active" data-tab="explain">自动讲解</div>' : "") +
          '<div class="tab' + (showExplain ? "" : " active") + '" data-tab="comment">自动发评</div>' +
          '<div class="tab" data-tab="reply">弹幕回复</div>' +
        '</div>' +
        '<div id="dy-panel-body">' +
          // --- Tab 1: Auto Explain ---
          // 视频号弹幕页：只去掉 active（css: .dy-tab-content 默认 display:none，
          // .active 才 display:block）→ 不开这个 tab 就永远看不到。
          // 元素本身保留：下面的输入框绑定逻辑要按 id 取，缺了会报错。
          '<div class="dy-tab-content' + (showExplain ? " active" : "") + '" data-content="explain">' +
            '<div class="dy-section">' +
              '<div class="dy-row">' +
                '<label>间隔(秒)</label>' +
                '<input class="dy-input" id="dy-explain-interval" value="15" style="width:60px">' +
                '<label style="min-width:62px" title="每次在 间隔±浮动 秒之间随机">浮动(±s)</label>' +
                '<input class="dy-input" id="dy-explain-random" value="5" style="width:50px">' +
              '</div>' +
              '<div class="dy-row">' +
                '<label>序号</label>' +
                '<input class="dy-input" id="dy-explain-indices" placeholder="留空=全部, 如: 1-15,18,20" style="flex:1">' +
              '</div>' +
              '<div class="dy-row">' +
                '<label title="开启后每轮随机打乱讲解顺序，关闭后按序号顺序讲解（始终循环）">打乱</label>' +
                '<label class="dy-toggle"><input type="checkbox" id="dy-explain-shuffle"><span class="slider"></span></label>' +
                '<button class="dy-btn primary small" id="dy-explain-start">▶ 开始</button>' +
                '<button class="dy-btn small" id="dy-explain-stop">■ 停止</button>' +
              '</div>' +
              wxGoodsBlock +
            '</div>' +
          '</div>' +
          // --- Tab 2: Auto Comment ---
          '<div class="dy-tab-content" data-content="comment">' +
            '<div class="dy-section">' +
              '<div class="dy-row">' +
                '<label>间隔(秒)</label>' +
                '<input class="dy-input" id="dy-comment-interval" value="30" style="width:60px">' +
                '<label style="min-width:62px" title="每次在 间隔±浮动 秒之间随机">浮动(±s)</label>' +
                '<input class="dy-input" id="dy-comment-random" value="10" style="width:50px">' +
              '</div>' +
              '<div class="dy-row">' +
                '<label>打乱</label>' +
                '<label class="dy-toggle"><input type="checkbox" id="dy-comment-shuffle"><span class="slider"></span></label>' +
                '<button class="dy-btn primary small" id="dy-comment-start">▶ 开始</button>' +
                '<button class="dy-btn small" id="dy-comment-stop">■ 停止</button>' +
              '</div>' +
              '<div class="dy-section-title">评论内容（每行一条）</div>' +
              '<textarea class="dy-textarea" id="dy-comment-texts">' + (localStorage.getItem('dy_comment_texts') || '欢迎来到直播间！\n主播加油！') + '</textarea>' +
            '</div>' +
          '</div>' +
          // --- Tab 3: Auto Reply (弹幕关键词回复) ---
          '<div class="dy-tab-content" data-content="reply">' +
            '<div class="dy-section">' +
              '<div class="dy-row">' +
                '<button class="dy-btn primary small" id="dy-reply-start">▶ 监听</button>' +
                '<button class="dy-btn small" id="dy-reply-stop">■ 停止</button>' +
                '<span id="dy-reply-stats" style="font-size:11px;color:#a6adc8;flex:1;text-align:right"></span>' +
              '</div>' +
              '<div class="dy-section-title">关键词规则</div>' +
              '<div style="font-size:11px;color:#fab387;background:rgba(250,179,135,.08);border-left:3px solid #fab387;padding:6px 8px;margin:6px 0 8px;border-radius:3px;line-height:1.6">' +
                '格式：<code style="background:#313244;padding:1px 4px;border-radius:2px;color:#cdd6f4">关键词1|关键词2%%回复内容</code>（每行一条，多个关键词用 <code style="background:#313244;padding:1px 3px;border-radius:2px">|</code> 分隔）' +
                '<br>例：<code style="background:#313244;padding:1px 4px;border-radius:2px;color:#cdd6f4">价格|多少钱%%亲，价格在左上方商品列表查看哦</code>' +
              '</div>' +
              '<textarea class="dy-textarea" id="dy-reply-rules" style="min-height:120px" placeholder="价格|多少钱%%亲，价格在左上方商品列表查看哦&#10;运费%%全场包邮，放心下单&#10;回复中可用 {nickname} 引用对方昵称">' + (localStorage.getItem('dy_reply_rules') || '价格|多少钱%%亲，价格在左上方商品列表查看哦\n运费%%全场包邮，放心下单') + '</textarea>' +
              '<div style="font-size:11px;color:#6c7086;margin-top:6px;line-height:1.6">命中后延迟 1~2s 回复 · 自动 @ 用户 · 同用户冷却 60s · 上限 6 条/分钟（后台默认）</div>' +
            '</div>' +
          '</div>' +
          // Console
          '<div id="dy-console"></div>' +
        '</div>';

      var header = panel.querySelector("#dy-panel-header");
      return { panel: panel, header: header };
    },

    _bindDrag: function (handle) {
      var panel = this._el;
      var offX, offY;
      handle.addEventListener("mousedown", function (e) {
        if (e.target.classList.contains("min-btn")) return;
        offX = e.clientX - panel.offsetLeft;
        offY = e.clientY - panel.offsetTop;
        function onMove(ev) {
          panel.style.left = (ev.clientX - offX) + "px";
          panel.style.right = "auto";
          panel.style.top = (ev.clientY - offY) + "px";
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    },

    _bindTabs: function () {
      var tabs = this._el.querySelectorAll(".tab");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener("click", function () {
          var tabName = this.getAttribute("data-tab");
          // deactivate all
          var allTabs = Panel._el.querySelectorAll(".tab");
          for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove("active");
          var allContent = Panel._el.querySelectorAll(".dy-tab-content");
          for (var k = 0; k < allContent.length; k++) allContent[k].classList.remove("active");
          // activate selected
          this.classList.add("active");
          var content = Panel._el.querySelector("[data-content='" + tabName + "']");
          if (content) content.classList.add("active");
          // 视频号弹幕页切到「自动讲解」时顺带刷新商品清单（状态可能已变）
          if (tabName === "explain" && Site.isWxch() && Site.page() === "comment") {
            Panel.refreshWxGoods();
          }
        });
      }

      // minimize button
      var minBtn = this._el.querySelector("#dy-min-btn");
      if (minBtn) {
        minBtn.addEventListener("click", function () {
          Panel._el.classList.add("hidden");
          // show a small floating button to restore
          Panel._showRestoreBtn();
        });
      }
    },

    _showRestoreBtn: function () {
      var old = document.getElementById("dy-restore-btn");
      if (old) old.remove();
      var btn = document.createElement("div");
      btn.id = "dy-restore-btn";
      btn.textContent = "🎯";
      btn.style.cssText =
        "position:fixed;top:80px;right:20px;z-index:999999;" +
        "width:40px;height:40px;border-radius:50%;background:#1e1e2e;" +
        "border:1px solid #313244;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
        "font-size:20px;transition:transform .15s";
      btn.addEventListener("mouseenter", function () { btn.style.transform = "scale(1.1)"; });
      btn.addEventListener("mouseleave", function () { btn.style.transform = "scale(1)"; });
      btn.addEventListener("click", function () {
        btn.remove();
        Panel._el.classList.remove("hidden");
      });
      document.body.appendChild(btn);
    },

    _bindControls: function () {
      var self = this;

      // ---- Auto Explain ----
      this._onClick("dy-explain-start", function () {
        var cfg = {
          interval: parseFloat(self._val("dy-explain-interval")) || 15,
          randomDelay: parseFloat(self._val("dy-explain-random")) || 5,
          shuffle: self._chk("dy-explain-shuffle"),
        };
        Config.set("explain_cfg", {
          interval: cfg.interval,
          randomDelay: cfg.randomDelay,
          shuffle: cfg.shuffle,
          indices: self._val("dy-explain-indices"),
        });
        // 视频号弹幕页：本页**没有商品**，所以「开始」实际是去驱动**商品页**的 AutoExplain
        // （跨页）。商品页没开时 background 会替他后台打开再转发（"自动打开并接管"）。
        // 超时给 20s：冷启动商品页要加载 Vue 应用 + content script + 500ms 延时注入。
        if (Site.isWxch() && Site.page() === "comment") {
          var wxIndices = self._val("dy-explain-indices");
          log.info("正在连接商品页…");
          // ① 先拉一次商品清单填进面板的只读列表（弹幕页看不到商品，序号框等于"盲输"）。
          //    清单 UI 就是 `refreshWxGoods` 渲染出来的那块。
          Panel.refreshWxGoods();
          Cross.call("list_products", {}, 5000).then(function (lp) {
            if (lp && lp.success && lp.products && lp.products.length) {
              log.info("商品页商品列表已载入面板（共 " + lp.count + " 个，见上方列表）");
            } else {
              log.info("商品页尚未打开，正在替你打开…");
            }
            // ② 再让商品页启动讲解（缺页时 background 后台打开并等就绪，最多约 20s）
            return Cross.call("explain_start", {
              indices: wxIndices,
              interval: cfg.interval,
              randomDelay: cfg.randomDelay,
              shuffle: cfg.shuffle,
            }, 20000);
          }).then(function (r) {
            if (r && r.success) {
              log.ok("商品页已接管，自动讲解启动（共 " + r.count + " 个商品）");
              Panel._remoteExplain = true;
            } else {
              log.err("启动失败：" + ((r && r.error) || "未知原因"));
              Panel._remoteExplain = false;
            }
            Panel._syncRunState();
            Panel.refreshWxGoods(); // 讲解状态可能已变 → 刷新「讲解中」标记
          });
          Panel._syncRunState();
          return;
        }
        AutoExplain.setConfig(cfg);
        AutoExplain.start(self._val("dy-explain-indices"));
        Panel._syncRunState(); // start 可能提前失败返回 → 以真实 running 为准
      });
      this._onClick("dy-explain-stop", function () {
        if (Site.isWxch() && Site.page() === "comment") {
          Cross.call("explain_stop", {}, 8000).then(function (r) {
            Panel._remoteExplain = false;
            Panel._syncRunState();
            log.info((r && r.success) ? "已请求商品页停止讲解" : "停止请求未送达（商品页可能已关闭）");
          });
          return;
        }
        AutoExplain.stop();
      });

      // 视频号弹幕页：只读商品清单的手动刷新
      this._onClick("dy-wx-goods-refresh", function () {
        Panel.refreshWxGoods();
      });

      // ---- Auto Comment ----
      this._onClick("dy-comment-start", function () {
        try {
          var texts = self._val("dy-comment-texts").split("\n").filter(Boolean);
          // save on start
          localStorage.setItem("dy_comment_texts", self._val("dy-comment-texts"));
          var cfg = {
            interval: parseFloat(self._val("dy-comment-interval")) || 30,
            randomDelay: parseFloat(self._val("dy-comment-random")) || 10,
            shuffle: self._chk("dy-comment-shuffle"),
            messages: texts,
          };
          AutoComment.setConfig(cfg);
          Config.set("comment_cfg", {
            interval: cfg.interval,
            randomDelay: cfg.randomDelay,
            shuffle: cfg.shuffle,
          });
          AutoComment.start();
        } catch (e) {
          log.err("启动自动发评失败: " + e.message);
        }
        Panel._syncRunState(); // 含异常分支：始终以真实 running 为准
      });
      this._onClick("dy-comment-stop", function () { AutoComment.stop(); });

      // ---- Auto Reply (弹幕关键词回复) ----
      this._onClick("dy-reply-start", function () {
        try {
          var rulesText = self._val("dy-reply-rules");
          localStorage.setItem("dy_reply_rules", rulesText);
          AutoReply.setRules(Panel.parseReplyRules(rulesText));
          AutoReply.start();
          self._updateReplyStats();
        } catch (e) {
          log.err("启动弹幕回复失败: " + e.message);
        }
        Panel._syncRunState(); // 含异常分支：始终以真实 running 为准
      });
      this._onClick("dy-reply-stop", function () { AutoReply.stop(); });

      // Auto-save reply rules on input
      var replyRulesEl = document.getElementById("dy-reply-rules");
      if (replyRulesEl) {
        replyRulesEl.addEventListener("input", function () {
          localStorage.setItem("dy_reply_rules", replyRulesEl.value);
        });
      }

      // Refresh reply stats while listening
      setInterval(function () {
        if (AutoReply.running) Panel._updateReplyStats();
      }, 2000);

      // Auto-save comment texts on input
      var textsEl = document.getElementById("dy-comment-texts");
      if (textsEl) {
        textsEl.addEventListener("input", function () {
          localStorage.setItem("dy_comment_texts", textsEl.value);
        });
      }

      // Live-sync timing changes into a running task (no restart needed)
      var liveSync = [
        { ids: ["dy-explain-interval", "dy-explain-random"], mod: AutoExplain },
        { ids: ["dy-comment-interval", "dy-comment-random"], mod: AutoComment },
      ];
      for (var s = 0; s < liveSync.length; s++) {
        (function (item) {
          for (var k = 0; k < item.ids.length; k++) {
            var syncEl = document.getElementById(item.ids[k]);
            if (!syncEl) continue;
            syncEl.addEventListener("change", function () {
              item.mod.setConfig({
                interval: parseFloat(self._val(item.ids[0])) || item.mod.config.interval,
                randomDelay: parseFloat(self._val(item.ids[1])) || item.mod.config.randomDelay,
              });
              log.info((item.mod === AutoExplain ? "讲解" : "发评") + "参数已更新: 间隔 " + item.mod.config.interval + "s ± " + item.mod.config.randomDelay + "s");
            });
          }
        })(liveSync[s]);
      }

      // Live-sync shuffle toggle into a running task (takes effect next round)
      var shuffleToggle = document.getElementById("dy-explain-shuffle");
      if (shuffleToggle) {
        shuffleToggle.addEventListener("change", function () {
          AutoExplain.config.shuffle = shuffleToggle.checked;
          log.info("讲解顺序: " + (shuffleToggle.checked ? "打乱（每轮随机）" : "按序号顺序"));
        });
      }

      // Periodically refresh products (keeps the scan cache warm for auto-explain)
      setInterval(function () { PageAPI.scanProducts(); }, 10000);
    },

    // Restore persisted settings into the panel inputs
    _loadSavedConfig: function () {
      var e = Config.get("explain_cfg", null);
      if (e) {
        if (e.interval) this._setVal("dy-explain-interval", e.interval);
        if (e.randomDelay !== undefined) this._setVal("dy-explain-random", e.randomDelay);
        if (e.indices) this._setVal("dy-explain-indices", e.indices);
        if (e.shuffle !== undefined) {
          var shuffleEl = document.getElementById("dy-explain-shuffle");
          if (shuffleEl) shuffleEl.checked = !!e.shuffle;
        }
      }
      var c = Config.get("comment_cfg", null);
      if (c) {
        if (c.interval) this._setVal("dy-comment-interval", c.interval);
        if (c.randomDelay !== undefined) this._setVal("dy-comment-random", c.randomDelay);
        if (c.shuffle !== undefined) {
          var shuffleEl = document.getElementById("dy-comment-shuffle");
          if (shuffleEl) shuffleEl.checked = !!c.shuffle;
        }
      }
    },

    refreshProducts: function () {
      PageAPI.forceScan();
    },

    // 视频号弹幕页：从商品页取回只读商品清单，渲染进 #dy-wx-goods-list。
    // 商品页没开/未就绪时给一句明确提示，**不假装有数据**。
    refreshWxGoods: function () {
      var box = document.getElementById("dy-wx-goods-list");
      if (!box) return;
      box.textContent = "读取中…";
      Cross.call("list_products", {}, 6000).then(function (r) {
        var el = document.getElementById("dy-wx-goods-list");
        if (!el) return;
        // 用 textContent 拼装（商品名来自页面，走 innerHTML 要转义；直接建节点最省心）
        var frag = document.createDocumentFragment();
        if (!r || !r.success || !r.products || !r.products.length) {
          var tip = document.createElement("span");
          tip.style.color = "#f9e2af";
          tip.textContent = "商品页未打开或尚未就绪，点「开始」会自动打开";
          frag.appendChild(tip);
          el.textContent = "";
          el.appendChild(frag);
          return;
        }
        for (var i = 0; i < r.products.length; i++) {
          var p = r.products[i];
          var rowEl = document.createElement("div");
          rowEl.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          var idx = document.createElement("span");
          idx.style.color = "#6c7086";
          idx.textContent = (p.index + 1) + ". ";
          rowEl.appendChild(idx);
          rowEl.appendChild(document.createTextNode(p.name || "未命名"));
          if (p.price) {
            var pr = document.createElement("span");
            pr.style.color = "#a6e3a1";
            pr.textContent = " " + p.price;
            rowEl.appendChild(pr);
          }
          if (p.live) {
            var lv = document.createElement("span");
            lv.style.color = "#f38ba8";
            lv.textContent = "  ← 讲解中";
            rowEl.appendChild(lv);
          }
          frag.appendChild(rowEl);
        }
        el.textContent = "";
        el.appendChild(frag);
      });
    },

    _val: function (id) {
      var el = document.getElementById(id);
      return el ? el.value : "";
    },
    _setVal: function (id, v) {
      var el = document.getElementById(id);
      if (el) el.value = v;
    },
    _chk: function (id) {
      var el = document.getElementById(id);
      return el ? el.checked : false;
    },
    _onClick: function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    },

    // 解析规则文本：每行 "关键词1|关键词2%%回复内容"（兼容旧格式 "=>"）
    parseReplyRules: function (text) {
      var rules = [];
      var lines = (text || "").split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var parts = line.split(/\s*%%\s*/);
        if (parts.length < 2) parts = line.split(/\s*(?:=>|==>|→)\s*/); // 兼容旧格式
        var kwPart = (parts[0] || "").trim();
        var reply = (parts[1] || "").trim();
        if (!kwPart) continue;
        if (!reply) { log.warn("规则缺少回复内容，已跳过: " + line); continue; }
        var keywords = kwPart.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
        if (keywords.length === 0) continue;
        rules.push({ keywords: keywords, reply: reply, enabled: true });
      }
      return rules;
    },

    _updateReplyStats: function () {
      var el = document.getElementById("dy-reply-stats");
      if (!el) return;
      var s = AutoReply.getStats();
      el.textContent = "命中 " + s.matched + " / 回复 " + s.replied;
    },

    // ----------------------------------------------------------------------
    //  运行状态同步（单一数据源 → UI）
    //  三组「开始/停止」按钮与 tab 状态点，全部由模块的 running 驱动。
    //  任何改变 running 的路径（点击 / 自动停止 / 启动失败回滚）都必须调用本函数，
    //  保证「按钮永远不会说谎」。
    // ----------------------------------------------------------------------
    _runState: null,

    _syncRunState: function () {
      // 注意：AutoExplain 等是本 IIFE 内的 var 声明，**不会**挂到 window 上，
      // 必须直接引用标识符（写成 window.AutoExplain 会恒为 undefined → 状态永远同步不上）
      // 视频号弹幕页：讲解跑在**商品页**，本地 AutoExplain.running 恒为 false →
      // 直接读它会让按钮永远显示"未运行"，而实际商品页在讲（UI 撒谎）。
      // 改用跨页轮询回来的远程状态（见 startRemoteExplainPoll）。
      var remoteExplainPage = Site.isWxch() && Site.page() === "comment";
      var states = {
        explain: remoteExplainPage
          ? !!Panel._remoteExplain
          : !!(typeof AutoExplain !== "undefined" && AutoExplain.running),
        comment: !!(typeof AutoComment !== "undefined" && AutoComment.running),
        reply: !!(typeof AutoReply !== "undefined" && AutoReply.running),
      };
      Panel._runState = states;

      var self = this;
      Object.keys(states).forEach(function (key) {
        var on = states[key];
        var startBtn = document.getElementById("dy-" + key + "-start");
        var stopBtn = document.getElementById("dy-" + key + "-stop");

        // 开始按钮：运行中 → 绿色高亮 + 文案变「运行中」
        if (startBtn) {
          var baseText = startBtn.getAttribute("data-base-text");
          if (!baseText) {
            // 首次同步时记住原始文案（「▶ 开始」/「▶ 监听」），避免反复改写后丢失
            baseText = startBtn.textContent;
            startBtn.setAttribute("data-base-text", baseText);
          }
          startBtn.classList.toggle("running", on);
          startBtn.textContent = on ? "● 运行中" : baseText;
        }

        // 停止按钮：运行中才可点；停止态降透明度，形成明确互斥
        if (stopBtn) {
          stopBtn.disabled = !on;
        }

        // tab 状态点：切到其他 tab 也能看到哪个模块在跑
        var tab = self._el && self._el.querySelector('.tab[data-tab="' + key + '"]');
        if (tab) tab.classList.toggle("running", on);
      });
    },
  };

  // ========================================================================
  //  CROSS-TAB API — 跨标签页接口
  //  其他标签页通过 chrome.runtime.sendMessage → background → content.js
  //  → window.postMessage 到这里，执行后原路返回结果
  // ========================================================================
  // ========================================================================
  //  CROSS-PAGE CALL – 中控页 → background → 另一个中控页（视频号两页专用）
  //  ⚠️ inject.js 跑在**页面上下文**，拿不到 chrome.* API → 必须经 content.js 的
  //     zkb-outbound 出站通道转发（见 js/content.js 末尾）。原来只有「外部页 → 中控页」
  //     的入站方向，中控页自己发不出去，视频号弹幕页要驱动商品页就得补这一条。
  //  返回 Promise<{success,...}>，**永不 reject**（调用方不必写 catch）。
  // ========================================================================
  var Cross = {
    _seq: 0,
    call: function (action, params, timeoutMs) {
      var id = "zkbo_" + Date.now() + "_" + (++this._seq);
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          window.removeEventListener("message", onResp);
          // 超时最常见的原因是"目标页没开" —— 直接把它写进错误里，省得主人对着一句
          // "timeout" 猜半天
          resolve({ success: false, error: "跨页调用超时（目标页面可能没打开）" });
        }, timeoutMs || 10000);
        function onResp(e) {
          if (!e.data || e.data.source !== "zkb-outbound-response" || e.data.id !== id) return;
          if (done) return;
          done = true;
          clearTimeout(timer);
          window.removeEventListener("message", onResp);
          resolve(e.data.result || { success: false, error: "跨页返回为空" });
        }
        window.addEventListener("message", onResp);
        window.postMessage({ source: "zkb-outbound", id: id, action: action, params: params || {} }, "*");
      });
    },
  };

  window.addEventListener("message", function (e) {
    if (!e.data || e.data.source !== "zkb-bridge") return;

    var id = e.data.id;
    var action = e.data.action;
    var params = e.data.params || {};
    var result;

    try {
      switch (action) {
        // 讲解指定商品 (params.index, 0-based)
        case "explain":
          result = _doExplain(params.index, false);
          break;

        // 取消讲解指定商品
        case "cancel_explain":
          result = _doExplain(params.index, true);
          break;

        // 发送弹幕 (params.text)
        case "comment":
          if (!params.text) {
            result = { success: false, error: "missing text" };
          } else {
            var ok = PageAPI.sendComment(params.text);
            result = ok
              ? { success: true, text: params.text }
              : { success: false, error: "发送失败，未找到输入框" };
          }
          break;

        // 获取商品列表（含 live：本行是否正在讲解 → 供弹幕页显示"当前讲解"）
        case "list_products":
          result = _listProducts();
          break;

        // ---- 跨页：视频号弹幕页远程驱动本页（商品页）的自动讲解 ----
        // 让**商品页本地跑** AutoExplain，而不是弹幕页逐条下发指令：
        // 序号过滤 / 打乱 / 单商品交替 / 失败重试全在 AutoExplain 里，本地跑才复用得上；
        // 弹幕页只负责"设参数 + 开/关 + 读状态"。
        case "explain_start":
          result = _explainStart(params);
          break;

        case "explain_stop":
          AutoExplain.stop();
          result = { success: true, running: false };
          break;

        // 获取运行状态
        case "get_status":
          result = {
            success: true,
            autoExplainRunning: AutoExplain.running,
            autoCommentRunning: AutoComment.running,
            autoReplyRunning: AutoReply.running,
            site: Site.detect(),
            siteLabel: Site.label(),
            productCount: (PageAPI._cache.products || []).length,
            explainRounds: AutoExplain._rounds,
            replyStats: AutoReply.getStats(),
          };
          break;

        default:
          result = { success: false, error: "unknown action: " + action };
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }

    // 回传结果（result 可能是同步对象，也可能是 Promise → 统一等结算后再回传）
    Promise.resolve(result).then(
      function (r) {
        window.postMessage({ source: "zkb-response", id: id, result: r }, "*");
      },
      function (err) {
        window.postMessage({
          source: "zkb-response",
          id: id,
          result: { success: false, error: String((err && err.message) || err) },
        }, "*");
      }
    );
  });

  function _doExplain(index, cancel) {
    var products = PageAPI.scanProducts();
    if (!products || products.length === 0) {
      return { success: false, error: "未扫描到商品" };
    }
    var idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= products.length) {
      return { success: false, error: "index 超范围 (0-" + (products.length - 1) + ")" };
    }
    var product = products[idx];
    var act = cancel ? "cancel_explain" : "explain";
    // 站点差异（虚拟列表 vs 全量渲染）内聚在 PageAPI 内，对调用方统一成 Promise<boolean>：
    //   buyin → 同步 boolean；eos → Promise（先滚动渲染出目标行再点击）
    // 直接把 Promise 当 success 返回会因 postMessage 无法结构化克隆而抛错，故这里收口。
    var pending = cancel ? PageAPI.cancelExplain(product) : PageAPI.clickExplain(product);
    return Promise.resolve(pending).then(function (ok) {
      return {
        success: !!ok,
        index: idx,
        name: product.name,
        action: act,
      };
    });
  }

  function _listProducts() {
    var products = PageAPI.scanProducts();
    var list = [];
    for (var i = 0; i < products.length; i++) {
      list.push({
        index: i,
        id: products[i].id,
        name: products[i].name,
        price: products[i].price,
        stock: products[i].stock,
        // 跨页展示要标出"正在讲解的是哪个"。视频号判据 = 行内可见 span.not-promoting
        // （不能靠按钮文本：讲解中时那个元素显示的是计时器 00:45）
        live: PageAPI._isRowLive(products[i]),
      });
    }
    return { success: true, count: list.length, products: list };
  }

  // 跨页启动自动讲解。params 经 postMessage 过来，只接受原始类型（不能传对象引用/函数）。
  // config 用白名单逐项赋值，不让调用方塞进奇怪东西。
  function _explainStart(params) {
    if (!Site.hasGoodsSide()) {
      return { success: false, error: "本页没有商品列表（视频号请把指令发到商品页）" };
    }
    if (typeof params.interval === "number" && params.interval > 0) {
      AutoExplain.config.interval = params.interval;
    }
    if (typeof params.randomDelay === "number" && params.randomDelay >= 0) {
      AutoExplain.config.randomDelay = params.randomDelay;
    }
    AutoExplain.config.shuffle = !!params.shuffle;
    AutoExplain.start(typeof params.indices === "string" ? params.indices : "");
    return {
      success: !!AutoExplain.running,
      running: !!AutoExplain.running,
      count: (AutoExplain._order || []).length,
      // 启动失败的原因在目标页日志里，这里补一句给调用方，免得只看到 success:false
      error: AutoExplain.running ? undefined : "目标页未能启动（看商品页日志：可能无商品或序号无效）",
    };
  }

  // ========================================================================
  //  BOOTSTRAP
  // ========================================================================
  function bootstrap() {
    // 1. Wait for probe
    if (!Probe.ready()) {
      log.info("正在探测页面...");
      // probe should already be done since it runs before inject.js,
      // but wait a moment just in case
      setTimeout(bootstrap, 200);
      return;
    }

    // 2. Wait for DOM
    if (!document.body) {
      setTimeout(bootstrap, 200);
      return;
    }

    // 3. 视频号商品页：**本轮不建面板**（面板只在弹幕页，跨页控制还没做）。
    //    但 inject.js 仍要加载并注册消息监听 —— 下一轮弹幕页要通过
    //    background → content.js → window.postMessage 把「讲解」指令打到本页执行。
    //    这里只屏蔽 UI，不屏蔽能力。
    if (Site.isWxch() && Site.page() === "goods") {
      console.log("[中控助手] 视频号商品页：面板在弹幕页，本页待命等待跨页指令");
      return;
    }

    // 4. Init panel
    Panel.init();

    // 视频号弹幕页：讲解跑在**商品页**，本页读不到它的 running →
    // 定期问一次商品页状态来同步「开始」按钮高亮。
    // 不轮询的话，商品页自己停了（连续失败/容器消失）这边按钮还亮着 = UI 撒谎。
    if (Site.isWxch() && Site.page() === "comment") {
      setInterval(function () {
        // side:"goods" 是**显式提示**：get_status 这个名字看不出属于哪一侧，
        // 靠它让 background 把这条路由到商品页（否则会被路由回弹幕页自己 → 永远 false）
        Cross.call("get_status", { side: "goods" }, 4000).then(function (r) {
          var on = !!(r && r.success && r.autoExplainRunning);
          if (on !== Panel._remoteExplain) {
            Panel._remoteExplain = on;
            Panel._syncRunState();
          }
        });
      }, 5000);
    }
  }

  // Check that we're on a supported page (live control / group-buy live control)
  function isSupportedPage() {
    return Site.supported();
  }

  if (isSupportedPage()) {
    // Small delay to ensure probe.js has completed
    setTimeout(bootstrap, 100);
  }
})();
