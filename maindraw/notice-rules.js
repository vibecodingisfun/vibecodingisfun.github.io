// Rich Home notice rules for the dashboard (plan docs/superpowers/plans/2026-11-21-rich-home-notice.md).
// The same rules as UTRRoster/Subscription/HomeNotice.swift and android/core HomeNotice.kt; tested by
// notice-rules.test.mjs against fixtures/home-notice.json.
(function (root) {
  const appStoreUrl = "https://apps.apple.com/app/maindraw/id6810411828";
  const playUrl = "https://play.google.com/store/apps/details?id=com.botao.maindraw";
  const linkHosts = ["vibecodingisfun.github.io", "apps.apple.com", "play.google.com"];
  const imageHost = "vibecodingisfun.github.io";
  const imagePath = "/maindraw/notice/";
  const maxTextLength = 280;
  const maxLabelLength = 24;
  const maxImageBytes = 400 * 1024;
  const maxImagePixels = 2400;
  const accents = {
    green: { light: [0.08, 0.38, 0.24], dark: [0.45, 0.78, 0.58] },
    orange: { light: [0.62, 0.27, 0.0], dark: [1.0, 0.68, 0.38] },
    purple: { light: [0.40, 0.22, 0.66], dark: [0.78, 0.68, 1.0] }
  };

  function checkedHttps(raw) {
    if (typeof raw !== "string" || !raw || /\s/.test(raw)) return null;
    let url;
    try { url = new URL(raw); } catch (e) { return null; }
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    // URL drops a default port, so look for any explicit port in the raw authority too.
    const authority = raw.replace(/^https:\/\//i, "").split(/[/?#]/)[0];
    if (url.port || /:\d*$/.test(authority)) return null;
    return url;
  }

  function resolveLink(raw, platform) {
    if (raw === "store") return platform === "android" ? playUrl : appStoreUrl;
    const url = checkedHttps(raw);
    return url && linkHosts.includes(url.hostname.toLowerCase()) ? raw : null;
  }

  function allowedImageUrl(raw) {
    const url = checkedHttps(raw);
    if (!url || url.hostname.toLowerCase() !== imageHost) return null;
    // The URL parser has already resolved any `..`; a path that escaped the folder fails the prefix check.
    const path = url.pathname;
    if (!path.startsWith(imagePath) || path.length <= imagePath.length) return null;
    if (/(^|\/)\.\.(\/|$)/.test(decodeURIComponent(raw.split(/[?#]/)[0]))) return null;
    return raw;
  }

  function parse(text) {
    const segments = [];
    let plain = "";
    let bold = false;
    let i = 0;
    const append = (segment) => {
      const last = segments[segments.length - 1];
      if (segment.link === null && last && last.link === null && last.bold === segment.bold) {
        last.text += segment.text;
      } else {
        segments.push(segment);
      }
    };
    const flush = () => {
      if (plain) append({ text: plain, bold, link: null });
      plain = "";
    };
    const hasMarker = (from) => text.indexOf("**", from) >= 0;
    const linkAt = (start) => {
      const close = text.indexOf("]", start + 1);
      if (close <= start + 1) return null;
      const open = close + 1;
      if (text[open] !== "(") return null;
      const end = text.indexOf(")", open + 1);
      if (end <= open + 1) return null;
      const label = text.slice(start + 1, close);
      const target = text.slice(open + 1, end);
      if (label.includes("[") || /\s/.test(target)) return null;
      return { label, target, end: end + 1 };
    };
    while (i < text.length) {
      const c = text[i];
      if (c === "*" && text[i + 1] === "*" && (bold || hasMarker(i + 2))) {
        flush();
        bold = !bold;
        i += 2;
        continue;
      }
      if (c === "[" && (i === 0 || text[i - 1] !== "!")) {
        const link = linkAt(i);
        if (link) {
          flush();
          append({ text: link.label, bold, link: link.target });
          i = link.end;
          continue;
        }
      }
      plain += c;
      i += 1;
    }
    flush();
    return segments;
  }

  const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter() : null;
  function graphemes(text) {
    return segmenter ? Array.from(segmenter.segment(text)).length : Array.from(text).length;
  }

  function plainLength(text) {
    return parse(text).reduce((n, s) => n + graphemes(s.text), 0);
  }

  function shape(width, height) {
    if (!(width > 0 && height > 0)) return null;
    const ratio = width / height;
    if (ratio >= 1.9 && ratio <= 2.1) return "wide";
    if (ratio >= 0.95 && ratio <= 1.05) return "square";
    return null;
  }

  /**
   * The text old builds and the per-platform keys show: marks removed, `store` links dropped, and (unless
   * `storeLinks` is false) the store lines added.
   */
  function plainText(notice, key, storeLinks) {
    const body = parse(notice).map((s) => {
      if (s.link === null) return s.text;
      if (s.link === "store") return s.text;
      return s.text + " " + s.link;
    }).join("");
    const lines = [body];
    if (storeLinks === false) return body;
    if (key !== "androidMessage") lines.push("App Store: " + appStoreUrl);
    if (key !== "iosMessage") lines.push("Google Play: " + playUrl);
    return lines.join("\n");
  }

  /** Which platforms get the notice; both unless the form says otherwise. */
  function platformsOf(form) {
    const p = form.platforms || {};
    return { ios: p.ios !== false, android: p.android !== false };
  }

  /**
   * Problems that block publishing. `form` is { notice, accent, image: {url, alt} | null, button: {label, link} | null,
   * platforms: {ios, android}, storeLinks }. Platforms default to both and storeLinks to true.
   */
  function problems(form) {
    const list = [];
    const notice = (form.notice || "").trim();
    if (!notice) return list;
    const platforms = platformsOf(form);
    if (!platforms.ios && !platforms.android) list.push("至少选一个平台（iPhone 或 Android）。");
    if (form.storeLinks === false && form.button) list.push("不带更新链接时不能有按钮（按钮总是打开商店）。");
    if (plainLength(notice) > maxTextLength) list.push("文字超过 " + maxTextLength + " 个字（不算 ** 和链接符号）。");
    for (const s of parse(notice)) {
      if (s.link !== null && !resolveLink(s.link, "ios")) list.push("链接不允许：" + s.link + "（只能用 store、本站、App Store 或 Google Play）。");
    }
    if (form.image) {
      if (!allowedImageUrl(form.image.url || "")) list.push("图片地址不对。");
      if (!(form.image.alt || "").trim()) list.push("图片要写一句说明（给读屏用）。");
    }
    if (form.button) {
      const label = (form.button.label || "").trim();
      if (!label) list.push("按钮要有文字。");
      if (graphemes(label) > maxLabelLength) list.push("按钮文字超过 " + maxLabelLength + " 个字。");
      if (!resolveLink(form.button.link || "", "ios")) list.push("按钮链接不允许：" + form.button.link);
    }
    return list;
  }

  /**
   * The whole file. `id` is the publish time; Clear passes an empty notice.
   * New builds read `iosNotice` / `androidNotice` for the card text (falling back to the shared `notice`), and
   * `iosMessage` / `androidMessage` for plain text. A platform left out gets null in both, so it shows nothing new.
   * The shared `notice` and `message` (read by builds that predate the per-platform keys) are set only when the
   * notice goes to both platforms.
   */
  function buildFile(form, id) {
    const notice = (form.notice || "").trim();
    if (!notice) {
      return { notice: null, iosNotice: null, androidNotice: null, message: null, iosMessage: null, androidMessage: null, card: null };
    }
    const platforms = platformsOf(form);
    const both = platforms.ios && platforms.android;
    const links = form.storeLinks !== false;
    const card = { version: 1, id, accent: accents[form.accent] ? form.accent : "green" };
    if (form.image) card.image = { url: form.image.url, alt: form.image.alt.trim() };
    if (form.button && links) card.button = { label: form.button.label.trim(), link: form.button.link };
    return {
      notice: both ? notice : null,
      iosNotice: platforms.ios ? notice : null,
      androidNotice: platforms.android ? notice : null,
      message: both ? plainText(notice, "message", links) : null,
      iosMessage: platforms.ios ? plainText(notice, "iosMessage", links) : null,
      androidMessage: platforms.android ? plainText(notice, "androidMessage", links) : null,
      card
    };
  }

  /** ISO time without milliseconds, e.g. 2026-11-21T22:40:00Z. */
  function newId(date) {
    return (date || new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  const api = {
    appStoreUrl, playUrl, accents, maxTextLength, maxLabelLength, maxImageBytes, maxImagePixels,
    resolveLink, allowedImageUrl, parse, plainLength, shape, plainText, platformsOf, problems, buildFile, newId, graphemes
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NoticeRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
