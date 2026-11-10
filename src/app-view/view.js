/*
 * The MCP Apps view: one small page that an MCP client renders in a sandboxed
 * iframe beside a tool result, and that draws that result as cards and tables.
 *
 * It speaks the MCP Apps protocol (JSON-RPC 2.0 over postMessage with the
 * parent window) directly rather than bundling the SDK's client, which is
 * 337 KB; what a read-only view needs from the protocol is about sixty lines.
 *
 * Two rules everything here follows:
 *
 *  1. Nothing from a result is ever parsed as markup. Search queries, URLs and
 *     alert text are third-party strings; they reach the page only through
 *     textContent and the title attribute. There is no innerHTML, no
 *     insertAdjacentHTML and no eval in this file, and a test asserts that.
 *  2. It talks to nobody but the host. No fetch, no links out, no storage. The
 *     only thing it ever sends is its own size.
 *
 * Plain ES2017, no modules, no dependencies: it is inlined into the HTML as is
 * and also loaded into a fake DOM by scripts/check-apps.mjs.
 */
(function () {
  "use strict";

  var PROTOCOL_VERSION = "2026-01-26";
  var ROWS_SHOWN = 12;
  var root = document.getElementById("app");
  var host = window.parent;

  // -- DOM helpers: the only way anything is put on the page -----------------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function clear(node) { node.textContent = ""; }
  function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }
  /** The rows of a result that really are rows; anything else is dropped. */
  function objects(list) {
    return Array.isArray(list) ? list.filter(function (r) { return r !== null && typeof r === "object" && !Array.isArray(r); }) : [];
  }

  // -- formatting ------------------------------------------------------------
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v) { return isNum(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "–"; }
  function signed(v, suffix) { return isNum(v) ? (v > 0 ? "+" : "") + num(v) + (suffix || "") : "–"; }
  function shortUrl(v) {
    var s = String(v);
    var m = /^https?:\/\/[^/]+(\/.*)?$/.exec(s);
    return m ? m[1] || "/" : s;
  }
  var FORMAT = {
    text: function (v) { return v === undefined || v === null ? "–" : String(v); },
    url: shortUrl,
    num: num,
    pct: function (v) { return isNum(v) ? num(v) + "%" : "–"; },
    pos: function (v) { return isNum(v) ? v.toFixed(1) : "–"; },
    delta: function (v) { return signed(v); },
    deltaPct: function (v) { return signed(v, "%"); },
  };
  var TEXTUAL = { text: true, url: true, pill: true };

  // -- what each tool's result looks like ------------------------------------
  // `good` says which direction is good news, so a delta can be coloured.
  function col(key, label, type, extra) {
    var c = { key: key, label: label, type: type || "text" };
    if (extra) for (var k in extra) c[k] = extra[k];
    return c;
  }
  function pillTone(text) {
    var s = String(text).toLowerCase();
    if (/critical|significantly below|ranking loss|disappeared|declining$/.test(s)) return "err";
    if (/warning|below benchmark|ctr collapse|rankings declining/.test(s)) return "warn";
    if (/above benchmark|healthy/.test(s)) return "ok";
    return "";
  }

  var VIEWS = {
    quick_wins: {
      title: "Quick wins",
      lead: "Queries at positions 4–15 that could reach page one",
      columns: [col("query", "Query"), col("position", "Position", "pos"), col("impressions", "Impressions", "num"),
        col("ctr", "CTR", "pct"), col("opportunity", "Extra clicks", "num", { bar: true })],
    },
    ctr_opportunities: {
      title: "CTR opportunities",
      lead: "Pages earning fewer clicks than their position should bring",
      columns: [col("page", "Page", "url"), col("position", "Position", "pos"), col("impressions", "Impressions", "num"),
        col("ctr", "CTR", "pct"), col("expectedCtr", "Expected", "pct"), col("potentialExtraClicks", "Extra clicks", "num", { bar: true })],
    },
    traffic_drops: {
      title: "Traffic drops",
      lead: "Pages that lost clicks against the previous period",
      columns: [col("page", "Page", "url"), col("currentClicks", "Clicks", "num"), col("priorClicks", "Before", "num"),
        col("clickChange", "Change", "delta", { bar: true, good: "up" }), col("positionChange", "Position", "delta", { good: "down" }),
        col("diagnosis", "Diagnosis", "pill")],
    },
    content_gaps: {
      title: "Content gaps",
      lead: "Demand you are seen for but do not rank for",
      columns: [col("query", "Query"), col("impressions", "Impressions", "num", { bar: true }), col("clicks", "Clicks", "num"),
        col("position", "Position", "pos")],
    },
    content_decay: {
      title: "Content decay",
      lead: "Pages that lost clicks in three consecutive 30-day periods",
      columns: [col("page", "Page", "url"), col("period3Clicks", "90 days ago", "num"), col("period2Clicks", "60 days ago", "num"),
        col("period1Clicks", "Last 30", "num"), col("totalClickLoss", "Clicks lost", "num", { bar: true, neg: true }),
        col("positionTrend", "Rankings", "pill")],
    },
    ctr_vs_benchmark: {
      title: "CTR against benchmark",
      lead: "Each page's CTR beside the benchmark for its position",
      columns: [col("page", "Page", "url"), col("position", "Position", "pos"), col("impressions", "Impressions", "num"),
        col("actualCtr", "CTR", "pct"), col("benchmarkCtr", "Benchmark", "pct"), col("gap", "Gap", "delta", { good: "up" }),
        col("verdict", "Verdict", "pill")],
    },
  };

  // -- pieces ----------------------------------------------------------------
  function header(title, lead, meta) {
    var params = (meta && meta.parameters) || {};
    var property = params.site_url ? String(params.site_url) : "";
    var head = el("header");
    add(head, el("p", "eyebrow", "Search Console" + (property ? " · " + property : "")), el("h1", "", title));
    var bits = [];
    if (lead) bits.push(lead);
    if (isNum(params.days)) bits.push("last " + params.days + " days");
    if (bits.length) add(head, el("p", "sub", bits.join(" · ")));
    return head;
  }

  function card(label, value, delta, tone) {
    var c = el("div", "card");
    add(c, el("div", "k", label), el("div", "v", value));
    if (delta) add(c, el("div", "d" + (tone ? " " + tone : ""), delta));
    return c;
  }
  function toneOf(change, good) {
    if (!isNum(change) || change === 0 || !good) return "";
    return (change > 0) === (good === "up") ? "good" : "bad";
  }

  function cell(row, c, max) {
    var value = row[c.key];
    var td = el("td", TEXTUAL[c.type] ? "t" : "n");
    if (c.type === "pill") {
      td.className = "";
      // The diagnosis strings carry a parenthetical or a long tail; the pill
      // shows the head and the full sentence stays one hover away.
      var full = FORMAT.text(value);
      var pill = el("span", "pill " + pillTone(value), full.split(/ \(| — /)[0]);
      pill.setAttribute("title", full);
      add(td, pill);
      return td;
    }
    var text = (own(FORMAT, c.type) ? FORMAT[c.type] : FORMAT.text)(value);
    if (TEXTUAL[c.type]) {
      td.textContent = text;
      if (value !== undefined && value !== null) td.setAttribute("title", String(value));
      return td;
    }
    var tone = toneOf(value, c.good);
    add(td, el("span", tone, text));
    if (c.bar && isNum(value) && max > 0) {
      var bar = el("span", "bar" + (value < 0 || c.neg ? " neg" : ""));
      var fill = el("i");
      fill.style.width = Math.max(2, Math.round((Math.abs(value) / max) * 100)) + "%";
      add(td, add(bar, fill));
    }
    return td;
  }

  /** A sortable table that shows the first rows and offers the rest. */
  function table(columns, rows) {
    var tile = el("div", "tile");
    var tbl = el("table");
    var thead = el("thead");
    var tbody = el("tbody");
    var headRow = el("tr");
    var state = { key: null, dir: -1, all: rows.length <= ROWS_SHOWN };
    var maxes = {};
    columns.forEach(function (c) {
      if (!c.bar) return;
      maxes[c.key] = rows.reduce(function (m, r) { return isNum(r[c.key]) ? Math.max(m, Math.abs(r[c.key])) : m; }, 0);
    });
    var more = null;

    function draw() {
      var sorted = rows.slice();
      if (state.key) {
        sorted.sort(function (a, b) {
          var x = a[state.key], y = b[state.key];
          if (isNum(x) && isNum(y)) return (x - y) * state.dir;
          return String(x).localeCompare(String(y)) * state.dir;
        });
      }
      clear(tbody);
      (state.all ? sorted : sorted.slice(0, ROWS_SHOWN)).forEach(function (r) {
        var tr = el("tr");
        columns.forEach(function (c) { tr.appendChild(cell(r, c, maxes[c.key])); });
        tbody.appendChild(tr);
      });
      if (more) more.textContent = state.all ? "Show fewer" : "Show all " + rows.length;
    }

    columns.forEach(function (c) {
      var th = el("th", TEXTUAL[c.type] ? "" : "n", c.label);
      th.setAttribute("scope", "col");
      th.setAttribute("tabindex", "0");
      th.setAttribute("role", "columnheader");
      function sort() {
        state.dir = state.key === c.key ? -state.dir : (TEXTUAL[c.type] ? 1 : -1);
        state.key = c.key;
        columns.forEach(function (o) { o.th.setAttribute("aria-sort", "none"); });
        th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
        draw();
      }
      th.addEventListener("click", sort);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); } });
      c.th = th;
      headRow.appendChild(th);
    });
    add(tile, add(tbl, add(thead, headRow), tbody));
    if (rows.length > ROWS_SHOWN) {
      more = el("button", "more");
      more.setAttribute("type", "button");
      more.addEventListener("click", function () { state.all = !state.all; draw(); });
      tile.appendChild(more);
    }
    draw();
    return tile;
  }

  function empty(text) { return el("p", "state", text || "Nothing to report for this period."); }

  // -- views that are not a plain table --------------------------------------
  function snapshotCards(current, change) {
    var cards = el("div", "cards");
    add(cards,
      card("Clicks", num(current.clicks), signed(change.clicksPercent, "%"), toneOf(change.clicksPercent, "up")),
      card("Impressions", num(current.impressions), signed(change.impressionsPercent, "%"), toneOf(change.impressionsPercent, "up")),
      card("CTR", FORMAT.pct(current.ctr), signed(change.ctr, " pts"), toneOf(change.ctr, "up")),
      card("Avg position", FORMAT.pos(current.position), signed(change.position), toneOf(change.position, "down")));
    return cards;
  }

  var CUSTOM = {
    site_snapshot: function (data, meta) {
      var out = [header("Site snapshot", "Against the previous period", meta)];
      if (!data || !data.current || !data.change) return out.concat(empty());
      out.push(snapshotCards(data.current, data.change));
      if (data.period) out.push(el("p", "sub", data.period.startDate + " to " + data.period.endDate));
      return out;
    },
    multi_site_dashboard: function (data, meta) {
      var sites = objects(data && data.sites);
      var days = data && data.periodDays;
      var out = [header("All properties", sites.length + (sites.length === 1 ? " property" : " properties") + (isNum(days) ? " · last " + days + " days" : ""), { parameters: {} })];
      if (!sites.length) return out.concat(empty("No properties to show."));
      var rows = sites.map(function (s) {
        var c = s.current || {}, d = s.change || {};
        return { siteUrl: s.siteUrl, clicks: c.clicks, clicksPercent: d.clicksPercent, impressions: c.impressions,
          ctr: c.ctr, position: c.position, health: s.health };
      });
      out.push(table([col("siteUrl", "Property"), col("clicks", "Clicks", "num", { bar: true }),
        col("clicksPercent", "Change", "deltaPct", { good: "up" }), col("impressions", "Impressions", "num"),
        col("ctr", "CTR", "pct"), col("position", "Position", "pos"), col("health", "Health", "pill")], rows));
      return out;
    },
    check_alerts: function (data, meta) {
      var out = [header("Alerts", "Changes that need attention", meta)];
      var s = (data && data.summary) || {};
      var cards = el("div", "cards");
      add(cards, card("Critical", num(s.critical || 0), "", ""), card("Warning", num(s.warning || 0), "", ""), card("Total", num(s.total || 0), "", ""));
      out.push(cards);
      var alerts = objects(data && data.alerts);
      if (!alerts.length) return out.concat(empty("No alerts. Nothing crossed a threshold."));
      out.push(table([col("severity", "Severity", "pill"), col("entity", "Query and page"), col("detail", "What changed")], alerts));
      return out;
    },
    cannibalization_check: function (data, meta) {
      var issues = objects(data);
      var out = [header("Cannibalisation", "Queries where several of your pages compete", meta)];
      if (!issues.length) return out.concat(empty("No query has two pages competing for it."));
      var tile = el("div", "tile");
      var tbl = el("table");
      var head = el("tr");
      [["Query / page", ""], ["Position", "n"], ["Impressions", "n"], ["Clicks", "n"]].forEach(function (h) {
        var th = el("th", h[1], h[0]);
        th.setAttribute("scope", "col");
        head.appendChild(th);
      });
      var body = el("tbody");
      issues.slice(0, ROWS_SHOWN).forEach(function (issue) {
        var g = el("tr", "group");
        var name = el("td", "t", FORMAT.text(issue.query));
        name.setAttribute("title", String(issue.query));
        add(g, name, el("td", "n", ""), el("td", "n", num(issue.totalImpressions)), el("td", "n", ""));
        body.appendChild(g);
        objects(issue.pages).forEach(function (p) {
          var tr = el("tr", "child");
          var page = el("td", "t", shortUrl(p.page));
          page.setAttribute("title", String(p.page));
          add(tr, page, el("td", "n", FORMAT.pos(p.position)), el("td", "n", num(p.impressions)), el("td", "n", num(p.clicks)));
          body.appendChild(tr);
        });
      });
      out.push(add(tile, add(tbl, add(el("thead"), head), body)));
      if (issues.length > ROWS_SHOWN) out.push(el("p", "sub", "Showing " + ROWS_SHOWN + " of " + issues.length + " queries."));
      return out;
    },
  };

  // -- rendering a tool result -----------------------------------------------
  function show(nodes) {
    clear(root);
    nodes.forEach(function (n) { root.appendChild(n); });
    reportSize();
  }
  function message(text, isError) { show([el("p", "state" + (isError ? " err" : ""), text)]); }

  function payloadOf(result) {
    if (result && result.structuredContent && result.structuredContent._meta) return result.structuredContent;
    var content = (result && result.content) || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i] && content[i].type === "text" && typeof content[i].text === "string") {
        try { return JSON.parse(content[i].text); } catch (e) { return { plain: content[i].text }; }
      }
    }
    return null;
  }

  function render(result) {
    var payload = payloadOf(result);
    if (result && result.isError) {
      message((payload && payload.plain) || "The tool reported an error.", true);
      return;
    }
    if (!payload || !payload._meta || typeof payload._meta.tool !== "string") {
      message("This result has nothing to chart. The details are in the conversation.");
      return;
    }
    var tool = payload._meta.tool;
    var nodes;
    // Own properties only: the tool name is data, and "__proto__" or
    // "constructor" must not reach something inherited.
    if (own(CUSTOM, tool)) {
      nodes = CUSTOM[tool](payload.data, payload._meta);
    } else if (own(VIEWS, tool)) {
      var view = VIEWS[tool];
      var rows = objects(payload.data);
      nodes = [header(view.title, view.lead, payload._meta)];
      nodes.push(rows.length ? table(view.columns, rows) : empty());
    } else {
      message("This result has nothing to chart. The details are in the conversation.");
      return;
    }
    nodes.push(el("footer", "", "Live data from Google Search Console. Position is an impression-weighted average, not a rank."));
    show(nodes);
  }

  // -- host context ----------------------------------------------------------
  function applyContext(ctx) {
    if (!ctx) return;
    if (ctx.theme === "dark" || ctx.theme === "light") document.documentElement.setAttribute("data-theme", ctx.theme);
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  // -- the protocol ----------------------------------------------------------
  var nextId = 1;
  var pending = {};
  function post(message) { host.postMessage(message, "*"); }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }

  var lastHeight = 0;
  function reportSize() {
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (!height || height === lastHeight) return;
    lastHeight = height;
    notify("ui/notifications/size-changed", { height: height });
  }

  var NOTIFICATIONS = {
    "ui/notifications/tool-input": function () { message("Loading Search Console data…"); },
    "ui/notifications/tool-result": render,
    "ui/notifications/tool-cancelled": function () { message("The request was cancelled."); },
    "ui/notifications/host-context-changed": applyContext,
  };

  window.addEventListener("message", function (event) {
    if (event.source !== host) return;
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.method === undefined) {
      var waiting = pending[msg.id];
      if (!waiting) return;
      delete pending[msg.id];
      if (msg.error) waiting.reject(new Error(String(msg.error.message || "request failed")));
      else waiting.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined) {
      // A request from the host. This view has no state to save on teardown and
      // offers no tools of its own, so everything except these two is refused.
      if (msg.method === "ping" || msg.method === "ui/resource-teardown") post({ jsonrpc: "2.0", id: msg.id, result: {} });
      else post({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
      return;
    }
    var handler = NOTIFICATIONS[msg.method];
    if (handler) handler(msg.params || {});
  });

  if (host === window) {
    message("This view is shown by an MCP client next to a tool result. Opened by itself it has nothing to display.");
    return;
  }

  request("ui/initialize", {
    appInfo: { name: "gsc-mcp-view", version: "1" },
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION,
  }).then(function (result) {
    applyContext(result && result.hostContext);
    notify("ui/notifications/initialized");
    reportSize();
  }, function () {
    message("The client did not complete the handshake, so there is nothing to display.", true);
  });

  if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.documentElement);
})();
