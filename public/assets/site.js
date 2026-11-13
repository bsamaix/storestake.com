(function(){
  var SS = window.SS = {};
  SS.$ = function(id){ return document.getElementById(id); };
  SS.esc = function(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
  SS.api = function(path, body){
    var opts = body === undefined ? {method:"GET"} : {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)};
    opts.credentials = "same-origin";
    return fetch(path, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if(!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
        return j;
      });
    });
  };
  // Where the visitor came from: campaign tags, or just the referring site's origin.
  SS.source = function(){
    var q = new URLSearchParams(location.search), keep = [];
    ["utm_source","utm_medium","utm_campaign","ref"].forEach(function(k){ if(q.get(k)) keep.push(k + "=" + q.get(k).slice(0, 60)); });
    var s = keep.join("&");
    try { if(s) sessionStorage.setItem("ss_src", s); else s = sessionStorage.getItem("ss_src") || ""; } catch(e) {}
    if(!s && document.referrer){ try { var o = new URL(document.referrer).origin; if(o !== location.origin) s = o; } catch(e) {} }
    return s;
  };
  SS.fmt = function(n){ return "$" + Math.round(n).toLocaleString("en-US"); };
  SS.busy = function(btn, on, text){
    if(on){ btn.dataset.label = btn.textContent; btn.textContent = text || "Saving…"; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  };
  SS.showErr = function(el, msg){ el.textContent = msg; el.hidden = !msg; };
  // Move focus to a heading after the page content changes, so keyboard and screen-reader users land on the result.
  SS.focusOn = function(el){ if(!el) return; el.setAttribute("tabindex","-1"); el.focus(); };
  SS.me = function(){ return SS.api("/api/auth/me").then(function(j){ return j.user; }).catch(function(){ return null; }); };
  SS.ready = SS.me().then(function(u){
    document.querySelectorAll("[data-auth-link]").forEach(function(a){ if(u){ a.textContent = "My account"; a.href = "/account"; } });
    SS.user = u;
    document.dispatchEvent(new CustomEvent("ss:user", {detail:u}));
    return u;
  });
  SS.source();
  // Arriving from a Shopify admin install ("?shop=brand.myshopify.com"): remember the store and send them to their account.
  try {
    var shopQ = new URLSearchParams(location.search).get("shop");
    if (shopQ && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopQ)) {
      sessionStorage.setItem("ss_shop", shopQ.toLowerCase());
      if (location.pathname !== "/account" && location.pathname !== "/login" && location.pathname !== "/signup") location.replace("/account");
    }
  } catch (e) {}
  var mb = document.getElementById("menu-btn"), nav = document.getElementById("site-nav");
  if(mb && nav){
    var setMenu = function(open){ nav.classList.toggle("open", open); mb.setAttribute("aria-expanded", String(open)); mb.textContent = open ? "Close" : "Menu"; document.body.classList.toggle("menu-open", open); };
    mb.addEventListener("click", function(){ setMenu(!nav.classList.contains("open")); });
    nav.addEventListener("click", function(e){ if(e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", function(e){ if(e.key === "Escape" && nav.classList.contains("open")) setMenu(false); });
    document.addEventListener("click", function(e){ if(nav.classList.contains("open") && !e.target.closest("header.top")) setMenu(false); });
  }
  // On the application page the header button would link to itself; make it jump to the form instead.
  if(location.pathname === "/apply"){ var cta = document.querySelector(".nav a.cta"); if(cta){ cta.href = "#formcard"; } }
})();

// Click-to-play video: nothing loads from YouTube until the poster is pressed.
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-yt]"); if (!b) return;
  var f = document.createElement("iframe");
  f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(b.dataset.yt) + "?autoplay=1&rel=0&modestbranding=1";
  f.title = b.dataset.title || "Video"; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.allowFullscreen = true; f.referrerPolicy = "strict-origin-when-cross-origin";
  b.parentNode.replaceChild(f, b); f.focus();
});

// First-party analytics: one beacon per page, one per named event (deduped per session). No cookies, no third parties.
(function(){
  var SS = window.SS;
  function sent(key){ try { if(sessionStorage.getItem("ss_ev_"+key)) return true; sessionStorage.setItem("ss_ev_"+key, "1"); } catch(e) {} return false; }
  // Meta Pixel (ads measurement). Loaded on public pages only; events mirror the first-party ones.
  var PIXEL = "384839509454955", FB = { calc_touched:"ViewContent", apply_start:"InitiateCheckout", signup:"CompleteRegistration", apply_submit:"Lead" };
  if(!/^\/(admin|stats|account)/.test(location.pathname)){
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");
    try { fbq("init", PIXEL); fbq("track", "PageView"); } catch(e) {}
  }
  SS.track = function(ev){
    if(ev && sent(ev + ":" + location.pathname)) return;
    if(ev && window.fbq){ try { FB[ev] ? fbq("track", FB[ev]) : fbq("trackCustom", ev); } catch(e) {} }
    var body = JSON.stringify({ p: location.pathname, r: ev ? "" : document.referrer, s: SS.source(), e: ev || null });
    try { fetch("/api/hit", { method:"POST", headers:{"Content-Type":"application/json"}, body: body, keepalive:true, credentials:"omit" }).catch(function(){}); } catch(e) {}
  };
  if(!/^\/(admin|stats)/.test(location.pathname)) SS.track();
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest("a[href]");
    if(a && /^\/apply(\?|#|$)/.test(a.getAttribute("href") || "")) SS.track("apply_click");
    if(e.target.closest && e.target.closest("[data-yt]")) SS.track("video_play");
    if(e.target.closest && e.target.closest("[data-connect]")) SS.track("shopify_connect");
  }, true);
  var calc = document.querySelector(".offer");
  if(calc){ var once = function(){ SS.track("calc_touched"); calc.removeEventListener("input", once); calc.removeEventListener("click", once); }; calc.addEventListener("input", once); calc.addEventListener("click", once); }
})();

// Mobile sticky "Apply" button: shown after the first in-page apply button scrolls out of view, hidden near the page's own closing CTA.
(function(){
  var b=document.querySelector("[data-sticky-apply]"); if(!b||!("IntersectionObserver" in window)) return;
  document.body.classList.add("has-sticky");
  var anchor=document.querySelector(".hero .cta-row, main .cta-row, main h1"), ends=document.querySelectorAll(".band, footer.bottom");
  var pastTop=false, seen=new Set();
  function upd(){ b.hidden=!(pastTop&&seen.size===0); }
  if(anchor) new IntersectionObserver(function(e){ var x=e[0]; pastTop=!x.isIntersecting&&x.boundingClientRect.top<0; upd(); }).observe(anchor);
  var io=new IntersectionObserver(function(es){ es.forEach(function(x){ if(x.isIntersecting) seen.add(x.target); else seen.delete(x.target); }); upd(); });
  ends.forEach(function(el){ io.observe(el); });
})();
