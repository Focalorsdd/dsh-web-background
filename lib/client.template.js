/**
 * dsh-web-background — browser half.
 *
 * Registers with the shell's module loader and:
 *   1. paints the Harness GUI background (image + readability scrim) from the
 *      plugin's settings, keeping message text readable through the overlay;
 *   2. registers a "settings.general.item" row right below the Agent preset
 *      row — a clickable preview box that opens a customizer dialog (image
 *      URL, local file, scrim opacity, enable switch, reset).
 *
 * Persistence: the Host settings namespace `dsh-web-background` (registered
 * by the node half) is the durable store; until the Host registers it (i.e.
 * before the next `dsh web` restart) the same value is mirrored into
 * localStorage and migrated to the Host settings on first contact.
 */
window.__ModuleLoader__.load({
	id: "dsh-web-background",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		var Input = primitives.Input;
		var Button = primitives.Button;
		var Modal = primitives.Modal;
		// Optional: renders the icon inside the injected "自定义" Appearance
		// cube. Absent from older module registries — the cube then falls back
		// to a text-only label.
		var ReactDOMClient = null;
		try {
			ReactDOMClient = require("react-dom/client");
		} catch (_error) {
			ReactDOMClient = null;
		}

		// ── Constants ────────────────────────────────────────────────────
		var NS = "dsh-web-background";
		var TAG_ID = "dsh-web-background/inject";
		var ROW_CSS_ID = "dsh-web-background/row";
		var LOCAL_KEY = "dsh-web-background:v1";
		var DEFAULT_OVERLAY = 0.55;
		var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
		var MAX_URL_LENGTH = 12 * 1024 * 1024;
		var THEME_PALETTE_MAX = 8;
		var THEME_OVERRIDE_SOURCE = "auto-theme";
		var DEFAULT_THEME_HUE = 222;
		// "Custom" appearance mode: the plugin persists the built-in "dark"
		// preference and stacks a scheme-locked overrideTokens layer for its
		// image-derived look, adding a 4th cube to the Appearance row. The
		// mode is active iff the plugin's customActive flag is on (the shell
		// preference stays the legal built-in "dark", so ui-theme's
		// settings-echo adoption never fights it); picking a built-in
		// appearance deactivates it and restores the stock look.
		var CUSTOM_BASE_PREFERENCE = "dark";
		// localStorage cache for the Appearance cube's captured class names
		// (hashed per frontend build; recaptured whenever a built-in cube is
		// visibly selected, so a stale cache only affects the selected look).
		var CUBE_CACHE_KEY = "dsh-web-background:cube";
		// Appearance row cubeRow hashed-class prefixes by frontend build
		// generation (same multi-generation pattern as
		// TRANSPARENT_LAYER_SELECTORS). 0.1.7-rc generation: TDnZ3a.
		var APPEARANCE_CUBE_PROBES = ["TDnZ3a"];
		// Per-surface custom-theme controls shown in the Appearance row editor.
		var THEME_SURFACE_ORDER = [
			"base",
			"dialog",
			"panel",
			"code",
			"bubble",
			"input",
			"menu",
			"selector",
			"sidebar",
			"sidebarActive",
			"highlight",
		];
		var THEME_SURFACE_DEFAULT_ALPHA = {
			base: 1,
			dialog: 0.72,
			panel: 0.66,
			code: 0.6,
			bubble: 0.66,
			input: 0.66,
			menu: 0.72,
			selector: 0.66,
			sidebar: 0.52,
			sidebarActive: 0.6,
			highlight: 1,
		};
		var DEFAULT_IMAGE_DATA = "<<DEFAULT_IMAGE_DATA>>";
		var DEFAULT_IMAGE =
			"url(\"data:image/jpeg;base64," + DEFAULT_IMAGE_DATA + "\")";

		// ── CSS helpers ──────────────────────────────────────────────────
		function clampOverlay(value) {
			if (typeof value !== "number" || !isFinite(value)) return DEFAULT_OVERLAY;
			return Math.min(0.95, Math.max(0, value));
		}
		function overlayLayer(alpha) {
			return (
				"linear-gradient(rgba(7,12,26," + alpha + "),rgba(7,12,26," + alpha + "))"
			);
		}
		function wrapImage(value) {
			var raw = String(value == null ? "" : value).trim();
			if (!raw) return DEFAULT_IMAGE;
			if (/^url\(/i.test(raw)) return raw;
			return "url(\"" + raw.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\")";
		}
		// The app's own full-screen layers paint opaque dark colors over body;
		// clear them so the picture shows through. These hashed class names are
		// specific to a dsh-web-frontend build — re-probe with elementFromPoint
		// after a dsh upgrade (checkLayerSelectors warns).
		//
		// Generations are listed side by side: a selector from a frontend build
		// that is no longer installed simply matches nothing (inert CSS), so
		// keeping the previous generation costs nothing and keeps the plugin
		// working on both sides of an app update.
		//   ≤0.1.6 generation   : pI_x6G = ui-layout, wSkVaW = ui-conversation
		//   0.1.7-rc generation : P9Gu9a = ui-layout, _5AcOhq = ui-conversation
		// 0.1.7-rc ui-layout paints bg-base on THREE separate elements — the
		// frame, the center content column and the right panel column
		// (centerCol/rightbarCol carry the desktop window's rounded-corner
		// styling). All three must be transparent or the image stays hidden
		// behind an opaque tinted layer.
		var TRANSPARENT_LAYER_SELECTORS = [
			".P9Gu9a_frame",
			".P9Gu9a_centerCol",
			".P9Gu9a_rightbarCol",
			"._5AcOhq_root",
			".P9Gu9a_sidebarCol",
			".pI_x6G_frame",
			".wSkVaW_root",
			".pI_x6G_sidebarCol",
		];
		function buildCss(image, overlay) {
			var layer = overlayLayer(overlay);
			// !important is REQUIRED on the html/body rules: the desktop shell's
			// frontend.css carries `html[data-platform=darwin], html[data-platform=darwin] body{background:transparent}`
			// for the macOS translucent-window effect. That attribute selector
			// outranks our element selectors, so without !important the image
			// declarations silently lose the cascade on the desktop app while
			// working fine in the browser (no data-platform attribute there).
			var css =
				"html{background:" +
				image +
				" center/cover fixed no-repeat #0d1424 !important;}" +
				"body{background:" +
				layer +
				"," +
				image +
				" center/cover fixed no-repeat #0d1424 !important;" +
				"background-attachment:fixed, fixed !important;}";
			for (var i = 0; i < TRANSPARENT_LAYER_SELECTORS.length; i++) {
				css += TRANSPARENT_LAYER_SELECTORS[i] + "{background:transparent!important;}";
			}
			// Sidebar follows the auto-theme subject tint when a theme
			// layer is active; otherwise it keeps the dark readability scrim
			// over bright pictures. pjj1TG = 0.1.7-rc ui-sidebar root,
			// hHd-Xa = the previous generation.
			css += ".pjj1TG_root,.hHd-Xa_root{background:var(--dsw-specific-sidebar-fill, rgba(10,14,28,0.6))!important;}";
			return css;
		}
		// Self-diagnostic: after a dsh upgrade the hashed class names above may
		// no longer exist; warn once instead of failing silently.
		var layerSelectorsWarned = false;
		function checkLayerSelectors() {
			if (layerSelectorsWarned || typeof document === "undefined") return;
			for (var i = 0; i < TRANSPARENT_LAYER_SELECTORS.length; i++) {
				if (document.querySelector(TRANSPARENT_LAYER_SELECTORS[i])) return;
			}
			layerSelectorsWarned = true;
			if (typeof console !== "undefined" && console.warn) {
				console.warn(
					"[dsh-web-background] none of the transparent-layer selectors matched this dsh build (" +
						TRANSPARENT_LAYER_SELECTORS.join(", ") +
						"); re-probe with elementFromPoint and update TRANSPARENT_LAYER_SELECTORS."
				);
			}
		}

		// ── Style tags ───────────────────────────────────────────────────
		var styleTag = null;
		function ensureStyleTag() {
			if (typeof document === "undefined") return null;
			if (styleTag && styleTag.isConnected) return styleTag;
			styleTag = document.querySelector(
				"style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]"
			);
			if (!styleTag) {
				styleTag = document.createElement("style");
				styleTag.dataset.plugin = NS;
				styleTag.dataset.pluginCss = TAG_ID;
				document.head.appendChild(styleTag);
			}
			return styleTag;
		}
		var lastBackgroundKey = null;
		function paintBackground(enabled, image, overlay) {
			var tag = ensureStyleTag();
			if (!tag) return;
			// Skip the CSS rewrite when nothing background-related changed
			// (the store also fires for theme-only commits).
			var key = enabled + "|" + overlay + "|" + image;
			if (key === lastBackgroundKey) return;
			lastBackgroundKey = key;
			if (enabled) checkLayerSelectors();
			tag.textContent = enabled ? buildCss(wrapImage(image), clampOverlay(overlay)) : "";
		}

		// ── Auto theme: palette extraction + token projection ─────────────
		function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
		}
		function normalizeHex(value) {
		var raw = String(value == null ? "" : value).trim();
		if (!/^#?[0-9a-f]{6}$/i.test(raw)) return null;
		return raw[0] === "#" ? raw.slice(1).toLowerCase() : raw.toLowerCase();
		}
		function hexToRgb(hex) {
		var raw = normalizeHex(hex);
		if (!raw) return { r: 0, g: 0, b: 0 };
		return {
		r: parseInt(raw.slice(0, 2), 16),
		g: parseInt(raw.slice(2, 4), 16),
		b: parseInt(raw.slice(4, 6), 16),
		};
		}
		function rgbToHex(rgb) {
		function byte(value) {
		return ("0" + clamp(Math.round(value), 0, 255).toString(16)).slice(-2);
		}
		return "#" + byte(rgb.r) + byte(rgb.g) + byte(rgb.b);
		}
		function rgbToHsl(rgb) {
		var r = rgb.r / 255;
		var g = rgb.g / 255;
		var b = rgb.b / 255;
		var max = Math.max(r, g, b);
		var min = Math.min(r, g, b);
		var delta = max - min;
		var h = 0;
		var s = 0;
		var l = (max + min) / 2;
		if (delta !== 0) {
		s = delta / (1 - Math.abs(2 * l - 1));
		if (max === r) h = ((g - b) / delta) % 6;
		else if (max === g) h = (b - r) / delta + 2;
		else h = (r - g) / delta + 4;
		h = (h * 60 + 360) % 360;
		}
		return { h: h, s: s, l: l };
		}
		function hslToRgb(h, s, l) {
		var hh = ((h % 360) + 360) % 360;
		var ss = clamp(s, 0, 1);
		var ll = clamp(l, 0, 1);
		var c = (1 - Math.abs(2 * ll - 1)) * ss;
		var x = c * (1 - Math.abs((hh / 60) % 2 - 1));
		var m = ll - c / 2;
		var rgb;
		if (hh < 60) rgb = [c, x, 0];
		else if (hh < 120) rgb = [x, c, 0];
		else if (hh < 180) rgb = [0, c, x];
		else if (hh < 240) rgb = [0, x, c];
		else if (hh < 300) rgb = [x, 0, c];
		else rgb = [c, 0, x];
		return {
		r: (rgb[0] + m) * 255,
		g: (rgb[1] + m) * 255,
		b: (rgb[2] + m) * 255,
		};
		}
		function hslString(h, s, l) {
		return "hsl(" + (h % 360).toFixed(1) + ", " + s.toFixed(1) + "%, " + l.toFixed(1) + "%)";
		}
		function relativeLuminance(rgb) {
		function channel(value) {
		var c = value / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		}
		return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
		}
		function contrastColor(rgb) {
		return relativeLuminance(rgb) > 0.45 ? "#10131d" : "#ffffff";
		}
		function rgbaFromRgb(rgb, alpha) {
		return "rgba(" + Math.round(rgb.r) + ", " + Math.round(rgb.g) + ", " + Math.round(rgb.b) + ", " + alpha + ")";
		}
		function mixRgb(from, to, ratio) {
		var t = clamp(ratio, 0, 1);
		return {
		r: from.r + (to.r - from.r) * t,
		g: from.g + (to.g - from.g) * t,
		b: from.b + (to.b - from.b) * t,
		};
		}
		function rgbDistance(a, b) {
		var dr = a.r - b.r;
		var dg = a.g - b.g;
		var db = a.b - b.b;
		return Math.sqrt(dr * dr + dg * dg + db * db);
		}
		// Parse a computed token color (#rgb/#rrggbb/rgb()/rgba()/hsl()/hsla())
		// into the #rrggbb form input[type=color] requires. Returns "" when the
		// value is not a parseable solid color.
		function cssColorToHex(value) {
		var raw = String(value == null ? "" : value).trim().toLowerCase();
		var shortHex = /^#([0-9a-f]{3})$/.exec(raw);
		if (shortHex) {
		var s = shortHex[1];
		return "#" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
		}
		if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
		var rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(raw);
		if (rgbMatch) {
		return rgbToHex({
		r: Number(rgbMatch[1]),
		g: Number(rgbMatch[2]),
		b: Number(rgbMatch[3]),
		});
		}
		var hslMatch = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(raw);
		if (hslMatch) {
		return rgbToHex(
		hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]) / 100, Number(hslMatch[3]) / 100)
		);
		}
		return "";
		}
		// Multiply a token color's alpha by `scale`. Tokens with a baked alpha
		// (hsla/rgba) scale from it; solid colors (hsl/rgb/hex) scale from
		// `solidBase` (the surface's default alpha, itself defaulting to 1) so
		// the slider reads the same effective alpha in both color schemes.
		// Unknown formats pass through unchanged. Powers alpha-only surface
		// overrides: retune a surface's opacity without picking a color.
		function scaleTokenAlpha(value, scale, solidBase) {
		var raw = String(value == null ? "" : value).trim();
		if (!raw) return raw;
		var solid = solidBase == null || !isFinite(solidBase) ? 1 : solidBase;
		var hex = normalizeHex(raw);
		if (hex) return rgbaFromRgb(hexToRgb(hex), clamp(solid * scale, 0, 1));
		var match = /^(hsl|rgb)a?\(\s*([^)]*?)\s*\)$/.exec(raw);
		if (!match) return raw;
		var parts = match[2].split(",");
		if (parts.length < 3) return raw;
		var baked = parts.length >= 4 ? parseFloat(parts[3]) : solid;
		if (!isFinite(baked)) baked = solid;
		var alpha = Math.round(clamp(baked * scale, 0, 1) * 100) / 100;
		return (
		match[1] + "a(" +
		parts[0].trim() + ", " + parts[1].trim() + ", " + parts[2].trim() + ", " + alpha + ")"
		);
		}
		// Curated system-only stacks (no network dependency); the browser picks the
		// first locally installed family, with Chinese fallbacks preserved.
		var FONT_OPTIONS = [
		{ id: "system", value: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'].join(", ") },
		{ id: "rounded", value: ['"Avenir Next Rounded"', '"Nunito"', '"SF Pro Rounded"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'].join(", ") },
		{ id: "tech", value: ['"SF Pro Display"', '"Segoe UI Variable Display"', '"Inter"', '"Roboto"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'].join(", ") },
		{ id: "serif", value: ['"Georgia"', '"Times New Roman"', '"Songti SC"', '"STSong"', '"SimSun"', 'serif'].join(", ") },
		];
		function fontById(id) {
		for (var i = 0; i < FONT_OPTIONS.length; i++) if (FONT_OPTIONS[i].id === id) return FONT_OPTIONS[i];
		return null;
		}
		function chooseFontId(saturation, lightness, hue) {
		if (saturation < 0.16) return lightness > 0.5 ? "serif" : "tech";
		if (hue < 70 || hue >= 330) return "rounded";
		if (hue >= 170 && hue < 270) return "tech";
		return "system";
		}
		// Font shorthands consumed by the current dsh-web-frontend stylesheet. Each
		// value re-references var(--dsw-font-family), which the same override layer
		// defines on body, so the whole typography scale follows.
		var FONT_SHORTHAND_TOKENS = {
		"--dsw-font-base-16": "16px/24px var(--dsw-font-family)",
		"--dsw-font-base-strong-16": "500 16px/24px var(--dsw-font-family)",
		"--dsw-font-l-20": "500 20px/28px var(--dsw-font-family)",
		"--dsw-font-m-18": "500 16px/28px var(--dsw-font-family)",
		"--dsw-font-markdown-base": "16px/28px var(--dsw-font-family)",
		"--dsw-font-markdown-base-italic": "italic 16px/28px var(--dsw-font-family)",
		"--dsw-font-markdown-base-strong": "600 16px/28px var(--dsw-font-family)",
		"--dsw-font-markdown-base-strong-italic": "italic 600 16px/28px var(--dsw-font-family)",
		"--dsw-font-markdown-h1": "700 24px/34px var(--dsw-font-family)",
		"--dsw-font-markdown-h2": "700 22px/32px var(--dsw-font-family)",
		"--dsw-font-markdown-h3": "700 20px/30px var(--dsw-font-family)",
		"--dsw-font-markdown-h4": "600 16px/28px var(--dsw-font-family)",
		"--dsw-font-markdown-small": "14px/24px var(--dsw-font-family)",
		"--dsw-font-markdown-small-italic": "italic 14px/24px var(--dsw-font-family)",
		"--dsw-font-markdown-small-strong": "600 14px/24px var(--dsw-font-family)",
		"--dsw-font-markdown-small-strong-italic": "italic 600 14px/24px var(--dsw-font-family)",
		"--dsw-font-markdown-table": "15px/25px var(--dsw-font-family)",
		"--dsw-font-markdown-table-head": "500 15px/25px var(--dsw-font-family)",
		"--dsw-font-s-14": "14px/22px var(--dsw-font-family)",
		"--dsw-font-s-strong-14": "500 14px/22px var(--dsw-font-family)",
		"--dsw-font-xl-24": "600 24px/32px var(--dsw-font-family)",
		"--dsw-font-xs-13": "13px/20px var(--dsw-font-family)",
		"--dsw-font-xs-strong-13": "500 13px/20px var(--dsw-font-family)",
		"--dsw-font-xxs-12": "12px/18px var(--dsw-font-family)",
		"--dsw-font-xxs-strong-12": "500 12px/18px var(--dsw-font-family)",
		"--dsw-font-xxxs-11": "11px/14px var(--dsw-font-family)",
		"--dsw-font-xxxs-strong-11": "500 11px/14px var(--dsw-font-family)",
		};
		function normalizePalette(value) {
		if (!Array.isArray(value)) return [];
		var result = [];
		for (var i = 0; i < value.length && result.length < THEME_PALETTE_MAX; i++) {
		if (normalizeHex(value[i])) result.push(normalizeHex(value[i]));
		}
		return result;
		}
		function normalizeFontId(value) {
		return fontById(String(value == null ? "" : value)) ? String(value) : "";
		}
		function defaultThemeCustom() {
			var result = {};
			for (var i = 0; i < THEME_SURFACE_ORDER.length; i++) {
				var key = THEME_SURFACE_ORDER[i];
				result[key] = {
					color: "",
					alpha: THEME_SURFACE_DEFAULT_ALPHA[key],
				};
			}
			return result;
		}
		function normalizeCustomColor(value) {
			var raw = String(value == null ? "" : value).trim().toLowerCase();
			if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
			if (/^[0-9a-f]{6}$/.test(raw)) return "#" + raw;
			return "";
		}
		function normalizeThemeCustom(value) {
			var base = defaultThemeCustom();
			if (!value || typeof value !== "object") return base;
			for (var i = 0; i < THEME_SURFACE_ORDER.length; i++) {
				var key = THEME_SURFACE_ORDER[i];
				var entry = value[key];
				if (!entry || typeof entry !== "object") continue;
				base[key] = {
					color: normalizeCustomColor(entry.color),
					alpha: typeof entry.alpha === "number" && isFinite(entry.alpha)
						? clamp(entry.alpha, 0, 1)
						: THEME_SURFACE_DEFAULT_ALPHA[key],
				};
			}
			return base;
		}
		function sameThemeCustom(a, b) {
			for (var i = 0; i < THEME_SURFACE_ORDER.length; i++) {
				var key = THEME_SURFACE_ORDER[i];
				if (a[key].color !== b[key].color || a[key].alpha !== b[key].alpha) return false;
			}
			return true;
		}
		// Token groups each custom surface row controls. The color is applied
		// verbatim (user authority) with the row's alpha, in both light/dark.
		var THEME_SURFACE_TOKENS = {
			base: ["--dsw-alias-bg-base", "--dsw-alias-bg-layer-1"],
			dialog: ["--dsw-alias-bg-overlay", "--dsw-alias-bg-layer-2"],
			panel: ["--dsw-alias-bg-layer-3", "--dsw-alias-bg-module-platform", "--dsw-alias-bg-multi-select"],
			code: [
				"--dsw-alias-markdown-code-block",
				"--dsw-alias-markdown-code-block-banner",
				"--dsw-alias-markdown-code-segment-selected",
				"--dsw-alias-markdown-code-segment-unselected",
				"--dsw-alias-markdown-inline-code",
				"--dsw-alias-markdown-citation",
			],
			bubble: ["--dsw-specific-bubble", "--dsw-specific-bubble-highlight"],
			input: ["--dsw-specific-input-major"],
			menu: ["--dsw-specific-menu"],
			selector: ["--dsw-specific-selector"],
			sidebar: ["--dsw-specific-sidebar-fill"],
			sidebarActive: [
				"--dsw-specific-sidebar-nav-item-active",
				"--dsw-specific-sidebar-nav-item-active-accent",
				"--dsw-specific-sidebar-nav-item-hover",
			],
			highlight: [
				"--dsw-alias-brand-primary",
				"--dsw-alias-brand-primary-new-colorprimary-new-color",
				"--dsw-alias-button-primary-fill",
				"--dsw-alias-button-primary-hover",
				"--dsw-alias-button-info-fill",
				"--dsw-alias-button-info-hover",
				"--dsw-alias-interactive-bg-hover-accent",
				"--dsw-alias-state-business-primary",
			],
		};
		function unwrapImageSource(value) {
		var raw = String(value == null ? "" : value).trim();
		var match = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)$/i.exec(raw);
		if (match) return (match[1] || match[2] || match[3] || "").trim();
		return raw;
		}
		function loadThemeImage(source) {
		return new Promise(function (resolve, reject) {
		var isRemote = /^https?:/i.test(source);
		function attempt(withCors) {
		var image = new Image();
		// Ask for CORS first so canvas pixel reads stay allowed; if the host
		// does not answer CORS the <img> fails outright, so retry plain — the
		// picture still loads (the background paints fine) and the palette
		// extraction then reports themeCanvasBlocked instead of a misleading
		// "image load failed".
		if (withCors && isRemote) image.crossOrigin = "anonymous";
		image.onload = function () { resolve(image); };
		image.onerror = function () {
		if (withCors && isRemote) attempt(false);
		else reject(new Error("themeImageLoadFailed"));
		};
		image.src = source;
		}
		attempt(true);
		});
		}
		function extractPaletteFromImage(image) {
			var width = image.naturalWidth || image.width || 1;
			var height = image.naturalHeight || image.height || 1;
			var maxSide = 64;
			var scale = Math.min(1, maxSide / Math.max(width, height));
			var drawWidth = Math.max(1, Math.round(width * scale));
			var drawHeight = Math.max(1, Math.round(height * scale));
			var canvas = document.createElement("canvas");
			canvas.width = drawWidth;
			canvas.height = drawHeight;
			var ctx = canvas.getContext("2d", {
				willReadFrequently: true
			});
			if (!ctx) throw new Error("themeCanvasUnavailable");
			ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
			var pixels;
			try {
				pixels = ctx.getImageData(0, 0, drawWidth, drawHeight).data;
			} catch (error) {
				throw new Error("themeCanvasBlocked");
			}
			var buckets = {};
			var subjectBuckets = {};
			var total = 0;
			var borderR = 0;
			var borderG = 0;
			var borderB = 0;
			var borderCount = 0;
			var centerX = (drawWidth - 1) / 2;
			var centerY = (drawHeight - 1) / 2;
			var spread = Math.max(centerX, centerY, 1);

			function addBucket(target, key, r, g, b, weight) {
				var bucket = target[key];
				if (!bucket) {
					bucket = {
						r: 0,
						g: 0,
						b: 0,
						weight: 0
					};
					target[key] = bucket;
				}
				bucket.r += r * weight;
				bucket.g += g * weight;
				bucket.b += b * weight;
				bucket.weight += weight;
			}
			// Pass 1: full-image buckets + the average border color. The border
			// average is the "background" reference for the subject saliency in
			// pass 2, so a subject placed off-center still beats the background.
			for (var i = 0; i < pixels.length; i += 4) {
				if (pixels[i + 3] < 125) continue;
				var r = pixels[i];
				var g = pixels[i + 1];
				var b = pixels[i + 2];
				var key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
				var pixelIndex = i / 4;
				var x = pixelIndex % drawWidth;
				var y = (pixelIndex - x) / drawWidth;
				var dx = (x - centerX) / spread;
				var dy = (y - centerY) / spread;
				addBucket(buckets, key, r, g, b, 1);
				if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.72) {
					borderR += r;
					borderG += g;
					borderB += b;
					borderCount += 1;
				}
				total += 1;
			}
			if (total < 16) throw new Error("themeImageEmpty");
			var borderRgb = borderCount >= 8 ? {
				r: borderR / borderCount,
				g: borderG / borderCount,
				b: borderB / borderCount
			} : null;
			// Pass 2: center-weighted + border-contrast subject buckets. A pixel
			// scores as subject when it is either near the center or clearly
			// different from the border/background reference color.
			for (var i2 = 0; i2 < pixels.length; i2 += 4) {
				if (pixels[i2 + 3] < 125) continue;
				var r2 = pixels[i2];
				var g2 = pixels[i2 + 1];
				var b2 = pixels[i2 + 2];
				var key2 = ((r2 >> 5) << 6) | ((g2 >> 5) << 3) | (b2 >> 5);
				var pixelIndex2 = i2 / 4;
				var x2 = pixelIndex2 % drawWidth;
				var y2 = (pixelIndex2 - x2) / drawWidth;
				var dx2 = (x2 - centerX) / spread;
				var dy2 = (y2 - centerY) / spread;
				var centerWeight = Math.exp(-(dx2 * dx2 + dy2 * dy2) * 2.4);
				var contrastWeight = borderRgb ? Math.min(1, rgbDistance({
					r: r2,
					g: g2,
					b: b2
				}, borderRgb) / 160) : 0;
				// Contrast must outrank sheer center area: a small off-center
				// subject is strongly unlike the border while a large centered
				// background is only mildly center-weighted.
				var subjectWeight = Math.min(1.2, centerWeight * 0.35 + contrastWeight * 0.85);
				addBucket(subjectBuckets, key2, r2, g2, b2, subjectWeight);
			}

			function candidatesFrom(target) {
				var result = [];
				for (var key in target) {
					var item = target[key];
					if (!item.weight) continue;
					var rgb = {
						r: item.r / item.weight,
						g: item.g / item.weight,
						b: item.b / item.weight
					};
					result.push({
						rgb: rgb,
						hsl: rgbToHsl(rgb),
						count: item.weight
					});
				}
				result.sort(function(a, b) {
					return b.count - a.count;
				});
				return result;
			}
			var candidates = candidatesFrom(buckets);
			var subjectCandidates = candidatesFrom(subjectBuckets);
			var picked = [];
			var threshold = 96;
			while (picked.length < 3 && threshold >= 8) {
				for (var c = 0; c < candidates.length && picked.length < THEME_PALETTE_MAX; c++) {
					var candidate = candidates[c];
					var farEnough = true;
					for (var p = 0; p < picked.length; p++) {
						if (rgbDistance(candidate.rgb, picked[p].rgb) < threshold) {
							farEnough = false;
							break;
						}
					}
					if (farEnough) picked.push(candidate);
				}
				threshold -= 16;
			}
			if (picked.length < 3) {
				for (var fill = 0; fill < candidates.length && picked.length < 3; fill++) {
					if (picked.indexOf(candidates[fill]) < 0) picked.push(candidates[fill]);
				}
			}
			var subject = pickSubjectColor(subjectCandidates);
			if (subject) {
				var subjectIndex = -1;
				for (var d = 0; d < picked.length; d++) {
					if (rgbDistance(subject.rgb, picked[d].rgb) < 22) {
						subjectIndex = d;
						break;
					}
				}
				if (subjectIndex >= 0) picked.splice(subjectIndex, 1);
				picked.unshift(subject);
				picked = picked.slice(0, THEME_PALETTE_MAX);
			}
			return picked.map(function(item) {
				return rgbToHex(item.rgb);
			});
		}

		function pickSubjectColor(candidates) {
			if (!candidates.length) return null;
			var best = null;
			var bestScore = -1;
			var limit = Math.min(candidates.length, 24);
			for (var i = 0; i < limit; i++) {
				var item = candidates[i];
				var hsl = item.hsl;
				if (hsl.l < 0.06 || hsl.l > 0.96) continue;
				var visibility = hsl.l >= 0.12 && hsl.l <= 0.9 ? 1.3 : 0.5;
				var score = item.count * (0.3 + Math.min(hsl.s, 0.9)) * visibility;
				if (score > bestScore) {
					bestScore = score;
					best = item;
				}
			}
			if (!best) best = candidates[0];
			return best;
		}

		function extractThemeFromSource(value) {
		var source = unwrapImageSource(value);
		if (!source) return Promise.reject(new Error("themeEmptySource"));
		return loadThemeImage(source).then(function (image) {
		var palette = extractPaletteFromImage(image);
		if (!palette.length) throw new Error("themePaletteTooSmall");
		return palette;
		});
		}
		function weightedStats(colors) {
		var totalWeight = 0;
		var saturation = 0;
		var lightness = 0;
		for (var i = 0; i < colors.length; i++) {
		var weight = Math.max(1, colors.length - i);
		var hsl = rgbToHsl(colors[i]);
		saturation += hsl.s * weight;
		lightness += hsl.l * weight;
		totalWeight += weight;
		}
		return { saturation: saturation / totalWeight, lightness: lightness / totalWeight };
		}
		function chooseAccentColor(colors) {
			if (!colors.length) return hexToRgb("#3d5afe");
			// Palette[0] is the subject color extracted by
			// extractPaletteFromImage() (center + border-contrast buckets). When
			// it is colorful enough, keep it as the highlight/accent authority so
			// buttons, hover glows and focus rings follow the picture's subject
			// instead of the background.
			var subject = colors[0];
			var subjectHsl = rgbToHsl(subject);
			if (subjectHsl.s >= 0.07 && subjectHsl.l >= 0.08 && subjectHsl.l <= 0.95) {
				return subject;
			}
			var best = null;
			var bestScore = -1;
			for (var i = 0; i < colors.length; i++) {
				var hsl = rgbToHsl(colors[i]);
				if (hsl.s < 0.08) continue;
				var weight = Math.max(1, colors.length - i);
				var score = hsl.s * weight * (hsl.l > 0.15 && hsl.l < 0.9 ? 1.35 : 0.6);
				if (score > bestScore) { bestScore = score; best = colors[i]; }
			}
			if (!best) {
				var most = colors[0];
				for (var j = 1; j < colors.length; j++) {
					if (rgbToHsl(colors[j]).s > rgbToHsl(most).s) most = colors[j];
				}
				best = most;
			}
			return best;
		}

		function deriveThemeProfile(palette, fontId) {
		var hexes = normalizePalette(palette);
		var colors = [];
		for (var i = 0; i < hexes.length; i++) colors.push(hexToRgb(hexes[i]));
		if (!colors.length) colors.push(hexToRgb("#3d5afe"));
		var stats = weightedStats(colors);
		var accent = chooseAccentColor(colors);
		var accentHsl = rgbToHsl(accent);
		var hue = accentHsl.s < 0.05 ? DEFAULT_THEME_HUE : accentHsl.h;
		// Keep the subject hue/saturation and only move lightness into the
		// readable range for each color scheme — highlight surfaces therefore
		// stay recognizably the picture's subject color instead of a generic
		// highly-saturated accent.
		var saturation = clamp(accentHsl.s * 100 * 1.05, 20, 92);
		var accentDark = { h: hue, s: clamp(saturation * 1.05, 42, 94), l: clamp(accentHsl.l, 0.55, 0.78) };
		var accentLight = { h: hue, s: clamp(saturation, 36, 90), l: clamp(accentHsl.l, 0.4, 0.58) };
		var accentRgb = hslToRgb(hue, clamp(saturation, 36, 90) / 100, clamp(accentHsl.l, 0.45, 0.75));
		var selectedFont = normalizeFontId(fontId) ? fontById(fontId) : fontById(chooseFontId(stats.saturation, stats.lightness, hue));
		return { hue: hue, saturation: saturation, accentDark: accentDark, accentLight: accentLight, accentRgb: accentRgb, fontId: selectedFont.id, fontStack: selectedFont.value };
		}
		function applyCustomThemeTokens(tokens, custom) {
			var surfaceCustom = normalizeThemeCustom(custom);
			for (var i = 0; i < THEME_SURFACE_ORDER.length; i++) {
				var key = THEME_SURFACE_ORDER[i];
				var entry = surfaceCustom[key];
				if (!entry) continue;
				var targets = THEME_SURFACE_TOKENS[key] || [];
				if (entry.color) {
					// User authority: exact color + exact alpha, both schemes.
					var rgb = hexToRgb(entry.color);
					var value = rgbaFromRgb(rgb, clamp(entry.alpha, 0, 1));
					for (var t = 0; t < targets.length; t++) {
						tokens[targets[t]] = { light: value, dark: value };
					}
				} else if (entry.alpha !== THEME_SURFACE_DEFAULT_ALPHA[key]) {
					// Alpha-only override: keep the auto color, scale each token's
					// baked alpha relative to the surface default so the group's
					// internal hierarchy (hover < active < fill …) survives.
					// Untouched rows (alpha === default) short-circuit above and
					// leave the auto tokens byte-identical.
					var scale = clamp(entry.alpha, 0, 1) / (THEME_SURFACE_DEFAULT_ALPHA[key] || 1);
					for (var t2 = 0; t2 < targets.length; t2++) {
						var pair = tokens[targets[t2]];
						if (!pair) continue;
						tokens[targets[t2]] = {
							light: scaleTokenAlpha(pair.light, scale, THEME_SURFACE_DEFAULT_ALPHA[key]),
							dark: scaleTokenAlpha(pair.dark, scale, THEME_SURFACE_DEFAULT_ALPHA[key]),
						};
					}
				}
			}
		}
		function buildThemeTokens(profile, custom) {
		var h = profile.hue;
		var s = profile.saturation;
		function darkSurface(lightness, satScale) { return hslString(h, clamp(s * satScale + 3, 7, 28), lightness); }
		function lightSurface(lightness, satScale) { return hslString(h, clamp(s * satScale + 2, 5, 24), lightness); }
		// Tinted surfaces: same hue as the subject, visibly colored while still
		// dark/light enough for readable text. Used for dialogs, code blocks,
		// sidebar and popovers — the "black boxes" around the app.
		function darkTint(lightness, satScale, alpha) {
			var tintSaturation = clamp(s * satScale + 6, 16, 38);
			return "hsla(" + h.toFixed(1) + ", " + tintSaturation.toFixed(1) + "%, " + lightness.toFixed(1) + "%, " + (alpha == null ? 0.66 : alpha) + ")";
		}
		function lightTint(lightness, satScale) { return hslString(h, clamp(s * satScale + 4, 8, 26), lightness); }
		var darkAccent = profile.accentDark;
		var lightAccent = profile.accentLight;
		var darkAccentRgb = hslToRgb(darkAccent.h, darkAccent.s / 100, darkAccent.l);
		var lightAccentRgb = hslToRgb(lightAccent.h, lightAccent.s / 100, lightAccent.l);
		var darkOnAccent = contrastColor(darkAccentRgb);
		var lightOnAccent = contrastColor(lightAccentRgb);
		var darkBorderRgb = mixRgb(profile.accentRgb, { r: 255, g: 255, b: 255 }, 0.78);
		var lightBorderRgb = mixRgb(profile.accentRgb, { r: 14, g: 18, b: 28 }, 0.7);
		var tokens = {};
		function add(name, light, dark) { tokens[name] = { light: light, dark: dark }; }
		function same(name, value) { add(name, value, value); }

		add("--dsw-alias-bg-base", lightSurface(98, 0.4), darkSurface(35, 0.42));
		add("--dsw-alias-bg-layer-1", lightSurface(95, 0.38), darkSurface(39, 0.4));
		add("--dsw-alias-bg-layer-2", lightTint(92, 0.55), darkTint(47, 0.6));
		add("--dsw-alias-bg-layer-3", lightTint(88, 0.5), darkTint(51, 0.55));
		add("--dsw-alias-bg-overlay", lightTint(99, 0.5), darkTint(55, 0.7, 0.78));
		add("--dsw-alias-bg-module-platform", lightTint(95, 0.5), darkTint(49, 0.6));
		add("--dsw-alias-bg-multi-select", lightTint(94, 0.5), darkTint(45, 0.6));
		add("--dsw-alias-bg-skeleton", rgbaFromRgb(profile.accentRgb, 0.09), rgbaFromRgb(profile.accentRgb, 0.1));
		add("--dsw-alias-border-l1", rgbaFromRgb(lightBorderRgb, 0.08), rgbaFromRgb(darkBorderRgb, 0.08));
		add("--dsw-alias-border-l2", rgbaFromRgb(lightBorderRgb, 0.14), rgbaFromRgb(darkBorderRgb, 0.16));
		add("--dsw-alias-border-l2-darkmode-thin", rgbaFromRgb(lightBorderRgb, 0.1), rgbaFromRgb(darkBorderRgb, 0.1));
		add("--dsw-alias-border-l3", rgbaFromRgb(lightBorderRgb, 0.2), rgbaFromRgb(darkBorderRgb, 0.24));
		add("--dsw-alias-border-l4", rgbaFromRgb(lightBorderRgb, 0.28), rgbaFromRgb(darkBorderRgb, 0.34));
		add("--dsw-alias-brand-primary", hslString(lightAccent.h, lightAccent.s, lightAccent.l * 100), hslString(darkAccent.h, darkAccent.s, darkAccent.l * 100));
		add("--dsw-alias-brand-primary-invert", lightOnAccent, darkOnAccent);
		add("--dsw-alias-brand-text", hslString(h, 10, 14), hslString(h, 8, 92));
		add("--dsw-alias-brand-primary-new-colorprimary-new-color", hslString(lightAccent.h, lightAccent.s, lightAccent.l * 100), hslString(darkAccent.h, darkAccent.s, darkAccent.l * 100));
		add("--dsw-alias-button-primary-fill", hslString(lightAccent.h, lightAccent.s, lightAccent.l * 100), hslString(darkAccent.h, darkAccent.s, darkAccent.l * 100));
		add("--dsw-alias-button-primary-hover", hslString(lightAccent.h, lightAccent.s, clamp(lightAccent.l - 0.06, 0.28, 0.5) * 100), hslString(darkAccent.h, darkAccent.s, clamp(darkAccent.l + 0.07, 0.5, 0.84) * 100));
		add("--dsw-alias-button-primary-dimmed", rgbaFromRgb(lightAccentRgb, 0.12), rgbaFromRgb(darkAccentRgb, 0.16));
		add("--dsw-alias-button-info-fill", hslString(lightAccent.h, lightAccent.s, lightAccent.l * 100), hslString(darkAccent.h, darkAccent.s, darkAccent.l * 100));
		add("--dsw-alias-button-info-hover", hslString(lightAccent.h, lightAccent.s, clamp(lightAccent.l - 0.06, 0.28, 0.5) * 100), hslString(darkAccent.h, darkAccent.s, clamp(darkAccent.l + 0.07, 0.5, 0.84) * 100));
		// The sidebar "新会话" button and floating toolbar buttons use the
		// elevated/floating button fills; tint them like the rest of the
		// semi-transparent subject-colored surfaces.
		add("--dsw-alias-button-elevated-fill", lightTint(94, 0.55), darkTint(48, 0.65, 0.72));
		add("--dsw-alias-button-floating-fill", lightTint(95, 0.5), darkTint(45, 0.6, 0.72));
		add("--dsw-alias-button-floating-hover", lightTint(91, 0.55), darkTint(51, 0.7, 0.78));
		add("--dsw-alias-interactive-bg-hover", rgbaFromRgb(lightAccentRgb, 0.1), rgbaFromRgb(darkAccentRgb, 0.13));
		add("--dsw-alias-interactive-bg-active", rgbaFromRgb(lightAccentRgb, 0.16), rgbaFromRgb(darkAccentRgb, 0.2));
		add("--dsw-alias-interactive-bg-hover-accent", rgbaFromRgb(lightAccentRgb, 0.18), rgbaFromRgb(darkAccentRgb, 0.24));
		add("--dsw-alias-interactive-bg-hover-solid", lightTint(88, 0.5), darkTint(51, 0.55, 0.62));
		add("--dsw-alias-label-primary", hslString(h, 12, 15), hslString(h, 10, 94));
		add("--dsw-alias-label-primary-bluish", hslString(h, 16, 20), hslString(h, 12, 90));
		add("--dsw-alias-label-primary-dimmed", hslString(h, 10, 32), hslString(h, 8, 82));
		add("--dsw-alias-label-primary-foreground", lightOnAccent, darkOnAccent);
		add("--dsw-alias-label-primary-inverted", hslString(h, 10, 97), hslString(h, 10, 13));
		add("--dsw-alias-label-secondary", hslString(h, 8, 38), hslString(h, 8, 78));
		add("--dsw-alias-label-tertiary", hslString(h, 6, 50), hslString(h, 6, 64));
		add("--dsw-alias-label-caption", hslString(h, 4, 56), hslString(h, 5, 52));
		add("--dsw-alias-label-dimmed", hslString(h, 5, 46), hslString(h, 5, 58));
		add("--dsw-alias-markdown-code-block", lightTint(95, 0.55), darkTint(38, 0.75, 0.6));
		add("--dsw-alias-markdown-code-block-banner", lightTint(93, 0.5), darkTint(41, 0.7, 0.66));
		add("--dsw-alias-markdown-code-segment-selected", lightTint(91, 0.55), darkTint(49, 0.8, 0.66));
		add("--dsw-alias-markdown-code-segment-unselected", lightTint(95, 0.5), darkTint(38, 0.7, 0.6));
		add("--dsw-alias-markdown-inline-code", lightTint(94, 0.55), darkTint(42, 0.65, 0.66));
		add("--dsw-alias-markdown-citation", lightTint(91, 0.5), darkTint(47, 0.7, 0.66));
		add("--dsw-alias-state-business-primary", hslString(lightAccent.h, lightAccent.s, lightAccent.l * 100), hslString(darkAccent.h, darkAccent.s, darkAccent.l * 100));
		add("--dsw-alias-state-business-tertiary", rgbaFromRgb(lightAccentRgb, 0.1), rgbaFromRgb(darkAccentRgb, 0.12));
		add("--dsw-specific-bubble", lightTint(93, 0.55), darkTint(44, 0.65, 0.66));
		add("--dsw-specific-bubble-highlight", lightTint(89, 0.5), darkTint(49, 0.7, 0.66));
		add("--dsw-specific-input-major", lightTint(97, 0.45), darkTint(42, 0.55, 0.66));
		add("--dsw-specific-menu", lightTint(95, 0.5), darkTint(51, 0.65, 0.72));
		add("--dsw-specific-selector", lightTint(93, 0.5), darkTint(48, 0.65, 0.66));
		add("--dsw-specific-sidebar-fill", lightTint(96, 0.65), darkTint(40, 0.9, 0.52));
		add("--dsw-specific-sidebar-nav-item-active", lightTint(93, 0.7), darkTint(46, 0.85, 0.6));
		add("--dsw-specific-sidebar-nav-item-active-accent", rgbaFromRgb(lightAccentRgb, 0.16), rgbaFromRgb(darkAccentRgb, 0.28));
		add("--dsw-specific-sidebar-nav-item-hover", rgbaFromRgb(lightAccentRgb, 0.12), rgbaFromRgb(darkAccentRgb, 0.16));
		applyCustomThemeTokens(tokens, custom);
		same("--dsw-font-family", profile.fontStack);
		for (var tokenName in FONT_SHORTHAND_TOKENS) same(tokenName, FONT_SHORTHAND_TOKENS[tokenName]);
		return tokens;
		}

		// ── Settings row stylesheet ──────────────────────────────────────
		var ROW_CSS =
			".dwb-group{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);}" +
			".dwb-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;}" +
			".dwb-preview{position:relative;display:flex;align-items:flex-end;justify-content:space-between;box-sizing:border-box;width:100%;height:132px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;cursor:pointer;overflow:hidden;background-color:var(--dsw-alias-bg-module-platform);background-repeat:no-repeat;padding:10px;font:inherit;text-align:left;}" +
			".dwb-preview:hover{border-color:var(--dsw-static-neutral-bluish-400);}" +
			".dwb-preview:focus-visible{outline:2px solid var(--dsw-static-neutral-bluish-400);outline-offset:2px;}" +
			".dwb-badge{align-self:flex-start;border-radius:999px;padding:2px 10px;background:rgba(7,12,26,.55);color:#e8ecf5;font-size:12px;line-height:18px;}" +
			".dwb-hint{align-self:flex-end;border-radius:999px;padding:2px 10px;background:rgba(7,12,26,.55);color:#e8ecf5;font-size:12px;line-height:18px;}" +
			".dwb-form{display:flex;flex-direction:column;gap:12px;}" +
			".dwb-row{display:flex;align-items:center;gap:8px;}" +
			".dwb-url{flex:1;}" +
			".dwb-url input{width:100%;}" +
			".dwb-sliderRow{flex-direction:column;align-items:stretch;gap:6px;}" +
			".dwb-label{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;}" +
			".dwb-fileButton{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;user-select:none;}" +
			".dwb-fileButton:hover{background:var(--dsw-alias-interactive-bg-hover);}" +
			".dwb-fileInput{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);}" +
			".dwb-spacer{flex:1;}" +
			".dwb-checkRow{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;}" +
			".dwb-error{color:#e5484d;font-size:12px;line-height:18px;}" +
			".dwb-themeSection{display:flex;flex-direction:column;gap:8px;margin-top:2px;padding-top:12px;border-top:1px dashed var(--dsw-alias-border-l2);}" +
			".dwb-chipRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}" +
			".dwb-chip{width:20px;height:20px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);box-sizing:border-box;}" +
			".dwb-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}" +
			".dwb-customHint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}" +
			".dwb-surfaceList{display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto;padding-right:4px;}" +
			".dwb-surfaceRow{display:flex;align-items:center;gap:8px;min-height:30px;}" +
			".dwb-surfaceName{flex:1;min-width:104px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;}" +
			".dwb-colorInput{flex:none;width:34px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:transparent;cursor:pointer;}" +
			".dwb-swatch{flex:none;width:22px;height:22px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);box-sizing:border-box;background:transparent;}" +
			".dwb-alphaSlider{flex:none;width:88px;}" +
			".dwb-autoBadge{flex:none;border-radius:999px;padding:0 8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;}" +
			".dwb-fontButtons{display:flex;gap:6px;flex-wrap:wrap;}" +
			".dwb-accordion{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;}" +
			".dwb-accordion + .dwb-accordion{margin-top:8px;}" +
			".dwb-accordionSummary{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;font-weight:600;cursor:pointer;user-select:none;list-style:none;}" +
			".dwb-accordionSummary::-webkit-details-marker{display:none;}" +
			".dwb-accordionSummary:after{content:\"▾\";opacity:.6;}" +
			".dwb-accordion:not([open]) .dwb-accordionSummary:after{content:\"▸\";}" +
			// Overflow safety: with all three sections expanded the content can
			// exceed the viewport. Each section body gets its own viewport-
			// relative max-height + scroll (the 300px reserve covers the
			// dialog header, paddings and the other sections' summary bars),
			// so the dialog never grows past the screen even if the card's
			// own max-height/overflow chain is bypassed by shell styles.
			// !important: beats the Modal card's own sizing rules regardless
			// of cascade order/specificity — the shell owns those class names.
			".dwb-accordionBody{display:flex;flex-direction:column;gap:10px;padding:12px;border-top:1px solid var(--dsw-alias-border-l2);max-height:max(180px, calc(100vh - 300px))!important;overflow-y:auto!important;}" +
			".dwb-accordion[open] > .dwb-themeSection{border-top:0;margin-top:0;padding-top:0;max-height:max(180px, calc(100vh - 300px))!important;overflow-y:auto!important;}" +
			".dwb-slider{width:100%;}" +
			// Resizable appearance dialog: the size itself lands as inline style
			// on the card (see applyDialogSize); these rules only bound it to
			// the viewport and keep shrunk content scrollable.
			".dwb-dialog{width:720px!important;max-width:calc(100vw - 32px)!important;max-height:calc(100vh - 32px)!important;overflow:auto!important;}" +
			// Corner grip: sticky to the visible bottom-right of the scrolling
			// card while content scrolls (negative top margin overlays the
			// grip instead of growing the form).
			".dwb-resizeHandle{align-self:flex-end;position:sticky;bottom:4px;flex:none;width:18px;height:18px;margin-top:-18px;cursor:nwse-resize;touch-action:none;border-radius:5px;opacity:.65;background-image:repeating-linear-gradient(135deg, transparent 0 5px, var(--dsw-alias-label-caption) 5px 7px, transparent 7px 11px);}" +
			".dwb-resizeHandle:hover{opacity:1;background-color:var(--dsw-alias-interactive-bg-hover);}";
		// Row CSS lives inside a ctx.effect in apply() (injected and removed
		// with the plugin fiber) instead of factory-evaluation side effects.

		// ── LocalStorage mirror (bridges until the Host namespace exists) ──
		// Dialog size bounds: 0 means "the modal's natural size".
		var DIALOG_MIN_WIDTH = 420;
		var DIALOG_MIN_HEIGHT = 320;
		var DIALOG_VIEWPORT_MARGIN = 32;
		var DIALOG_LENGTH_MAX = 4000;
		function normalizeDialogLength(value) {
			return typeof value === "number" && isFinite(value)
				? clamp(Math.round(value), 0, DIALOG_LENGTH_MAX)
				: 0;
		}

		// Single normalization funnel for every state source (Host settings,
		// localStorage mirror, defaults, commit patches). `source` tracks where
		// the snapshot came from ("host" / "local" / "default").
		function normalizeState(value, source) {
			var raw = value && typeof value === "object" ? value : {};
			return {
				image: typeof raw.image === "string" ? raw.image : "",
				overlay:
					typeof raw.overlay === "number" && isFinite(raw.overlay)
						? clampOverlay(raw.overlay)
						: DEFAULT_OVERLAY,
				enabled: raw.enabled !== false,
				customActive: raw.customActive === true,
				themeEnabled: raw.themeEnabled !== false,
				themePalette: normalizePalette(raw.themePalette),
				themeFont: normalizeFontId(raw.themeFont),
				themeCustom: normalizeThemeCustom(raw.themeCustom),
				dialogWidth: normalizeDialogLength(raw.dialogWidth),
				dialogHeight: normalizeDialogLength(raw.dialogHeight),
				source: source,
			};
		}

		function loadLocal() {
			try {
				if (typeof window === "undefined" || !window.localStorage) return null;
				var raw = window.localStorage.getItem(LOCAL_KEY);
				if (!raw) return null;
				var parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== "object") return null;
				return normalizeState(parsed, "local");
			} catch (_error) {
				return null;
			}
		}
		function saveLocal(value) {
			try {
				if (typeof window === "undefined" || !window.localStorage) return;
				window.localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
			} catch (_error) {
				/* quota exceeded — the Host settings path still carries the value */
			}
		}
		function clearLocal() {
			try {
				if (typeof window !== "undefined" && window.localStorage) {
					window.localStorage.removeItem(LOCAL_KEY);
				}
			} catch (_error) {}
		}

		// ── Background store (Host settings first, localStorage fallback) ──
		function createBackgroundStore(scope) {
			var listeners = [];
			var migrated = false;
			// Declared before the first read(): read() consults this list to
			// detect fields the running Host schema does not project yet.
			var PERSIST_FIELDS = ["image", "overlay", "enabled", "customActive", "themeEnabled", "themePalette", "themeFont", "themeCustom", "dialogWidth", "dialogHeight"];
			var state = read();

			function read() {
				var snap = scope.getSnapshot();
				if (
					snap.status === "ready" &&
					snap.value &&
					typeof snap.value === "object"
				) {
					var hostState = normalizeState(snap.value, "host");
					// A field only counts as host-owned when the Host carries an
					// explicit USER value for it (snap.user), not merely a
					// schema default (snap.value). Otherwise the first settings
					// echo after a restart clobbers the localStorage mirror:
					// e.g. customActive was persisted locally while the
					// pre-restart Host schema rejected it, and the post-restart
					// default (false) would flip the custom appearance off on
					// every boot until the user re-clicks the cube. Fields
					// without a user record defer to the local mirror;
					// tryMigrate() then forwards them into the Host.
					var user =
						snap.user && typeof snap.user === "object" ? snap.user : null;
					var local = null;
					for (var i = 0; i < PERSIST_FIELDS.length; i++) {
						var field = PERSIST_FIELDS[i];
						if (
							user &&
							Object.prototype.hasOwnProperty.call(user, field)
						) {
							continue;
						}
						if (local === null) local = loadLocal();
						if (local) hostState[field] = local[field];
					}
					return hostState;
				}
				var localOnly = loadLocal();
				if (localOnly) return localOnly;
				return normalizeState(null, "default");
			}
			function same(a, b) {
				return (
					a.image === b.image &&
					a.overlay === b.overlay &&
					a.enabled === b.enabled &&
					a.customActive === b.customActive &&
					a.themeEnabled === b.themeEnabled &&
					a.themeFont === b.themeFont &&
					a.dialogWidth === b.dialogWidth &&
					a.dialogHeight === b.dialogHeight &&
					a.themePalette.length === b.themePalette.length &&
					a.themePalette.every(function (color, index) { return color === b.themePalette[index]; }) &&
					sameThemeCustom(a.themeCustom, b.themeCustom) &&
					a.source === b.source
				);
			}
			function emit() {
				var next = read();
				if (same(next, state)) return;
				state = next;
				for (var i = 0; i < listeners.length; i++) listeners[i]();
			}
			function notifyAll() {
				for (var i = 0; i < listeners.length; i++) listeners[i]();
			}
			// Plain persistable subset of a snapshot (drops `source`).
			function persistSubset(value) {
				var out = {};
				for (var i = 0; i < PERSIST_FIELDS.length; i++) {
					out[PERSIST_FIELDS[i]] = value[PERSIST_FIELDS[i]];
				}
				return out;
			}
			// A field the running Host schema does not know (yet) is rejected
			// by the settings boundary — swallow sync throws and rejections;
			// the localStorage mirror carries the value until the restart.
			function writeField(field, value) {
				try {
					var result = scope.set(field, value);
					if (result && typeof result.catch === "function") {
						result.catch(function () {});
					}
				} catch (_error) {}
			}
			var persistTimer = null;
			function cancelPersist() {
				if (!persistTimer) return;
				clearTimeout(persistTimer);
				persistTimer = null;
			}
			// Writes the whole snapshot to localStorage + Host settings. Called
			// trailing-debounced from commit() so dragging a slider does not
			// fire a settings write (and a JSON.stringify of a multi-MB data
			// URI) on every tick.
			function flushPersist() {
				cancelPersist();
				var next = state;
				saveLocal(persistSubset(next));
				var snap = scope.getSnapshot();
				if (snap.status === "ready" && snap.writable) {
					for (var f = 0; f < PERSIST_FIELDS.length; f++) {
						writeField(PERSIST_FIELDS[f], next[PERSIST_FIELDS[f]]);
					}
				}
			}
			function schedulePersist() {
				cancelPersist();
				persistTimer = setTimeout(flushPersist, 300);
			}
			function commit(patch) {
				var next = normalizeState(state, "local");
				for (var key in patch) next[key] = patch[key];
				next.themeCustom = normalizeThemeCustom(next.themeCustom);
				state = next;
				schedulePersist();
				notifyAll();
			}
			// Forward-migration attempt log: field → JSON of the value we last
			// tried to write. Prevents write/notify loops when the Host keeps
			// rejecting a field; a rejected attempt is unmarked so a later
			// echo (e.g. after the host restart) retries it.
			var forwardAttempts = {};
			// One forward-migration write. Kept as a function (not inline in
			// the loop) so the rejection handler closes over THIS field/key —
			// with loop-shared `var`s the handler would see the final loop
			// values and never unmark a rejected attempt.
			function forwardWrite(field, lv) {
				var attemptKey = JSON.stringify(lv);
				if (forwardAttempts[field] === attemptKey) return;
				// Mark BEFORE the write: a synchronous echo from scope.set
				// re-enters tryMigrate and must see the attempt as done.
				forwardAttempts[field] = attemptKey;
				try {
					var result = scope.set(field, lv);
					if (result && typeof result.catch === "function") {
						result.catch(function () {
							if (forwardAttempts[field] === attemptKey) {
								delete forwardAttempts[field];
							}
						});
					}
				} catch (_error) {
					delete forwardAttempts[field];
				}
			}
			function tryMigrate() {
				var snap = scope.getSnapshot();
				// Never act before the Host scope is actually ready.
				if (snap.status !== "ready" || !snap.writable) return;
				var user =
					snap.user && typeof snap.user === "object" ? snap.user : null;
				var local = loadLocal();
				if (!local) {
					migrated = true;
					return;
				}
				if (!migrated) {
					// One-shot legacy adoption: a fresh Host config (no user
					// overrides at all) inherits the whole local mirror.
					migrated = true;
					var hasOverride = !!(
						user &&
						(typeof user.image === "string" ||
							typeof user.overlay === "number" ||
							typeof user.enabled === "boolean" ||
							typeof user.customActive === "boolean" ||
							typeof user.themeEnabled === "boolean" ||
							typeof user.themeFont === "string" ||
							typeof user.dialogWidth === "number" ||
							typeof user.dialogHeight === "number" ||
							Array.isArray(user.themePalette) ||
							(user.themeCustom && typeof user.themeCustom === "object"))
					);
					if (!hasOverride) {
						for (var f = 0; f < PERSIST_FIELDS.length; f++) {
							writeField(PERSIST_FIELDS[f], local[PERSIST_FIELDS[f]]);
						}
						return;
					}
				}
				// Forward-migration: fields the Host USER record does not know
				// yet (e.g. customActive was persisted to the local mirror
				// while the pre-restart Host schema rejected it) get written
				// through, so the local value survives schema upgrades. Skip
				// values already matching to avoid write loops; a rejected
				// field simply gets retried on the next settings echo.
				var hostState = normalizeState(snap.value, "host");
				for (var f2 = 0; f2 < PERSIST_FIELDS.length; f2++) {
					var field = PERSIST_FIELDS[f2];
					if (user && Object.prototype.hasOwnProperty.call(user, field)) {
						continue;
					}
					var lv = local[field];
					var hv = hostState[field];
					var sameValue =
						typeof lv === "object" || typeof hv === "object"
							? JSON.stringify(lv) === JSON.stringify(hv)
							: lv === hv;
					if (sameValue) continue;
					forwardWrite(field, lv);
				}
			}

			tryMigrate();
			scope.subscribe(function () {
				tryMigrate();
				emit();
			});

			return {
				getSnapshot: function () {
					return state;
				},
				subscribe: function (listener) {
					listeners.push(listener);
					return function () {
						var index = listeners.indexOf(listener);
						if (index >= 0) listeners.splice(index, 1);
					};
				},
				setImage: function (value) {
					commit({ image: String(value == null ? "" : value) });
				},
				setOverlay: function (value) {
					commit({ overlay: clampOverlay(value) });
				},
				setEnabled: function (value) {
					commit({ enabled: value !== false });
				},
				setCustomActive: function (value) {
					commit({ customActive: value === true });
				},
				setThemeEnabled: function (value) {
					commit({ themeEnabled: value !== false });
				},
				setThemeProfile: function (palette, fontId) {
					commit({
						themePalette: normalizePalette(palette),
						themeFont: normalizeFontId(fontId),
					});
				},
				setThemeFont: function (fontId) {
					commit({ themeFont: normalizeFontId(fontId) });
				},
				setThemeSurface: function (key, patch) {
					if (THEME_SURFACE_ORDER.indexOf(key) < 0) return;
					var custom = normalizeThemeCustom(state.themeCustom);
					var current = custom[key];
					custom[key] = {
						color: patch.color !== undefined ? normalizeCustomColor(patch.color) : current.color,
						alpha: patch.alpha !== undefined ? clamp(Number(patch.alpha), 0, 1) : current.alpha,
					};
					commit({ themeCustom: custom });
				},
				clearThemeCustom: function () {
					commit({ themeCustom: defaultThemeCustom() });
				},
				clearTheme: function () {
					commit({ themePalette: [], themeFont: "" });
				},
				// 0/0 restores the modal's natural size.
				setDialogSize: function (width, height) {
					commit({
						dialogWidth: normalizeDialogLength(width),
						dialogHeight: normalizeDialogLength(height),
					});
				},
				reset: function () {
					// Cancel any pending debounced write first — a stale flush
					// landing after the unset calls would resurrect the value.
					cancelPersist();
					clearLocal();
					state = normalizeState(null, "default");
					var snap = scope.getSnapshot();
					if (snap.status === "ready" && snap.writable) {
						var fields = PERSIST_FIELDS;
						for (var f = 0; f < fields.length; f++) {
							try {
								var result = scope.unset(fields[f]);
								if (result && typeof result.catch === "function") result.catch(function () {});
							} catch (_error) {}
						}
					}
					notifyAll();
				},
				dispose: function () {
					cancelPersist();
					listeners = [];
				},
				// Re-run the host-echo path on demand (used by the boot
				// watchdog while the scope is still settling).
				poke: function () {
					tryMigrate();
					emit();
				},
			};
		}

		// ── Locale dictionaries (settings.background) ────────────────────
		var zh = {
			title: "自定义外观",
			defaultLabel: "默认",
			customized: "已自定义",
			disabled: "已停用",
			clickToCustomize: "点击自定义外观",
			modalTitle: "自定义外观",
			close: "关闭",
			urlPlaceholder: "粘贴图片链接，例如 https://…",
			apply: "应用",
			chooseFile: "选择本地图片",
			reading: "读取中…",
			reset: "恢复默认",
			overlay: "遮罩不透明度",
			enabled: "启用自定义背景",
			valueTooLarge: "内容过大（最大 12MB）",
			fileTooLarge: "图片过大，无法压缩到 8 MB 以内",
			fileNotImage: "请选择图片文件",
			fileReadFailed: "读取图片失败",
			themeAutoFollow: "上传/应用背景图时自动生成主题",
			themeChooseFile: "选择主题图片（不换背景）",
			themeGenerate: "从当前背景图生成",
			themeClear: "清除主题",
			themeGenerating: "正在生成…",
			themePalette: "提取的配色",
			themeFontLabel: "字体",
			themeActive: "自动主题已启用",
			themeInactive: "自动主题已关闭",
			themeFailed: "生成主题失败",
			themeCanvasBlocked: "无法读取图片像素（跨域限制），请改用本地图片",
			themeImageLoadFailed: "图片加载失败",
			themeImageEmpty: "图片可用像素过少",
			themeFontAuto: "自动",
			themeFontSystem: "系统默认",
			themeFontRounded: "圆润",
			themeFontTech: "科技",
			themeFontSerif: "衬线古典",
			sectionBackground: "背景",
			sectionAutoTheme: "自动主题",
			sectionCustomTheme: "逐项自定义",
			customThemeHint: "留空颜色 = 跟随图片自动配色；设置颜色后该项完全由你控制。只调透明度也行——自动色按该表面默认透明度等比缩放。",
			customThemeAuto: "自动",
			customThemeResetSurface: "恢复自动",
			customThemeResetAll: "全部恢复自动",
			customThemeColor: "颜色",
			customThemeOpacity: "透明度",
			customThemeFont: "字体",
			customThemeNoTheme: "尚未生成主题，先生成后这里的覆盖才会生效。",
			surfaceBase: "基础背景",
			surfaceDialog: "对话框/弹层",
			surfacePanel: "模块面板",
			surfaceCode: "公式/代码黑框",
			surfaceBubble: "气泡",
			surfaceInput: "输入区",
			surfaceMenu: "菜单",
			surfaceSelector: "选择器",
			surfaceSidebar: "侧边栏",
			surfaceSidebarActive: "展开侧边栏",
			surfaceHighlight: "高光/品牌色",
			resizeDialog: "拖拽调整窗口大小 · 双击恢复默认",
			customCube: "自定义",
			customModeEnable: "作为「自定义」外观启用",
			customModeHint: "背景与主题仅在「外观」选择「自定义」时显示；选择浅色/深色/跟随系统则恢复默认外观。",
		};
		var en = {
			title: "Custom appearance",
			defaultLabel: "Default",
			customized: "Custom",
			disabled: "Disabled",
			clickToCustomize: "Click to customize appearance",
			modalTitle: "Customize appearance",
			close: "Close",
			urlPlaceholder: "Paste an image URL, e.g. https://…",
			apply: "Apply",
			chooseFile: "Choose image file",
			reading: "Reading…",
			reset: "Reset to default",
			overlay: "Overlay opacity",
			enabled: "Enable custom background",
			valueTooLarge: "Value too large (max 12 MB)",
			fileTooLarge: "Image too large to compress under 8 MB",
			fileNotImage: "Please choose an image file",
			fileReadFailed: "Failed to read the image",
			themeAutoFollow: "Generate a GUI theme when the background image is applied",
			themeChooseFile: "Choose theme image (keep background)",
			themeGenerate: "Generate from current background",
			themeClear: "Clear theme",
			themeGenerating: "Generating…",
			themePalette: "Extracted palette",
			themeFontLabel: "Font",
			themeActive: "Auto theme enabled",
			themeInactive: "Auto theme disabled",
			themeFailed: "Failed to generate theme",
			themeCanvasBlocked: "Cannot read image pixels (cross-origin). Choose a local image instead.",
			themeImageLoadFailed: "Failed to load the image",
			themeImageEmpty: "The image has too few usable pixels",
			themeFontAuto: "Auto",
			themeFontSystem: "System",
			themeFontRounded: "Rounded",
			themeFontTech: "Tech",
			themeFontSerif: "Classic serif",
			sectionBackground: "Background",
			sectionAutoTheme: "Auto theme",
			sectionCustomTheme: "Per-surface",
			customThemeHint: "Leave the color empty to follow the image palette; once set, that surface is fully yours. Opacity works either way — auto colors scale relative to the surface default.",
			customThemeAuto: "Auto",
			customThemeResetSurface: "Reset to auto",
			customThemeResetAll: "Reset all to auto",
			customThemeColor: "Color",
			customThemeOpacity: "Opacity",
			customThemeFont: "Font",
			customThemeNoTheme: "Generate a theme first; overrides apply once it exists.",
			surfaceBase: "Base background",
			surfaceDialog: "Dialogs / popovers",
			surfacePanel: "Module panels",
			surfaceCode: "Code / formula boxes",
			surfaceBubble: "Bubbles",
			surfaceInput: "Input area",
			surfaceMenu: "Menu",
			surfaceSelector: "Selector",
			surfaceSidebar: "Sidebar",
			surfaceSidebarActive: "Expanded sidebar",
			surfaceHighlight: "Highlight / brand",
			resizeDialog: "Drag to resize · double-click to reset size",
			customCube: "Custom",
			customModeEnable: "Enable as the “Custom” appearance",
			customModeHint: "The background and theme only show while Appearance is set to “Custom”; Light/Dark/System restore the stock look.",
		};

		// ── Settings row component ───────────────────────────────────────
		var useSyncExternalStore =
			typeof React.useSyncExternalStore === "function"
				? React.useSyncExternalStore
				: function (subscribe, getSnapshot) {
						var pair = React.useState(getSnapshot());
						var value = pair[0];
						var setValue = pair[1];
						React.useEffect(
							function () {
								function check() {
									setValue(getSnapshot());
								}
								check();
								return subscribe(check);
							},
							[subscribe, getSnapshot]
						);
						return value;
				  };

		// ── Shared UI atoms ────────────────────────────────────────────
		// Stateless building blocks for the appearance dialog. Everything here
		// renders through React.createElement with the dwb-* classes ROW_CSS
		// styles; behavior lives in the section components further down.
		function Checkbox(props) {
			return React.createElement(
				"label",
				{ className: "dwb-checkRow" },
				React.createElement("input", {
					type: "checkbox",
					checked: props.checked,
					onChange: props.onChange,
				}),
				React.createElement("span", null, props.label)
			);
		}

		function FileButton(props) {
			return React.createElement(
				"label",
				{ className: "dwb-fileButton" },
				props.busy ? props.busyLabel : props.label,
				React.createElement("input", {
					type: "file",
					accept: "image/*",
					className: "dwb-fileInput",
					disabled: props.disabled,
					onChange: function (event) {
						var file = event.target.files && event.target.files[0];
						// Reset the input so picking the same file twice still fires.
						event.target.value = "";
						if (file) props.onFile(file);
					},
				})
			);
		}

		function ErrorText(props) {
			return props.text
				? React.createElement("div", { className: "dwb-error" }, props.text)
				: null;
		}

		// Controlled <details>: the open flag lives in React state so unrelated
		// re-renders (e.g. dragging a slider) never snap a section back shut.
		function Accordion(props) {
			return React.createElement(
				"details",
				{ className: "dwb-accordion", open: props.open },
				React.createElement(
					"summary",
					{
						className: "dwb-accordionSummary",
						onClick: function (event) {
							event.preventDefault();
							props.onToggle();
						},
					},
					props.title
				),
				React.createElement(
					"div",
					{ className: props.bodyClassName },
					props.children
				)
			);
		}

		// ── Image file + theme generation helpers ──────────────────────
		// Validates the type, then reads the file as a data URI. Files over
		// MAX_IMAGE_BYTES are re-encoded through a canvas (JPEG, stepping the
		// quality down, then shrinking dimensions) until they fit — very large
		// pictures would otherwise stall the settings store and the background
		// paint, and overflow the localStorage mirror quota on every persist.
		// Returns true when an async read started (caller shows a busy label
		// until a callback fires).
		function readImageFile(file, t, handlers) {
			if (!/^image\//.test(file.type)) {
				handlers.onError(t("fileNotImage"));
				return false;
			}
			if (file.size <= MAX_IMAGE_BYTES) {
				readFileAsDataUrl(file, t, handlers);
			} else {
				compressImageFile(file, t, handlers);
			}
			return true;
		}
		function readFileAsDataUrl(blob, t, handlers) {
			var reader = new FileReader();
			reader.onload = function () {
				handlers.onData(String(reader.result));
			};
			reader.onerror = function () {
				handlers.onError(t("fileReadFailed"));
			};
			reader.readAsDataURL(blob);
		}
		// JPEG quality ladder tried at each size before shrinking further.
		var COMPRESS_QUALITIES = [0.92, 0.82, 0.72, 0.62, 0.5, 0.38];
		function compressImageFile(file, t, handlers) {
			function fail(message) {
				handlers.onError(message || t("fileTooLarge"));
			}
			if (
				typeof document === "undefined" ||
				typeof Image === "undefined" ||
				typeof URL === "undefined" ||
				!URL.createObjectURL
			) {
				fail();
				return;
			}
			var objectUrl = URL.createObjectURL(file);
			var cleaned = false;
			function cleanup() {
				if (cleaned) return;
				cleaned = true;
				try {
					URL.revokeObjectURL(objectUrl);
				} catch (_error) {}
			}
			var image = new Image();
			image.onload = function () {
				var width = image.naturalWidth || image.width;
				var height = image.naturalHeight || image.height;
				if (!width || !height) {
					// e.g. an SVG without intrinsic dimensions — nothing to draw.
					cleanup();
					fail();
					return;
				}
				compressAtSize(image, width, height, 0);
			};
			image.onerror = function () {
				cleanup();
				fail(t("fileReadFailed"));
			};
			image.src = objectUrl;
			function compressAtSize(img, width, height, qualityIndex) {
				var canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				var ctx = canvas.getContext("2d");
				if (!ctx) {
					cleanup();
					fail();
					return;
				}
				// JPEG has no alpha channel: composite onto white so
				// transparent PNGs don't turn black.
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, width, height);
				ctx.drawImage(img, 0, 0, width, height);
				var finished = false;
				function finish(blob) {
					if (finished) return;
					finished = true;
					cleanup();
					if (blob) readFileAsDataUrl(blob, t, handlers);
					else fail();
				}
				try {
					canvas.toBlob(function (blob) {
						if (blob && blob.size <= MAX_IMAGE_BYTES) {
							finish(blob);
							return;
						}
						if (blob == null) {
							// The export itself failed — retrying other quality
							// levels on this canvas won't help.
							finish(null);
							return;
						}
						if (qualityIndex + 1 < COMPRESS_QUALITIES.length) {
							compressAtSize(img, width, height, qualityIndex + 1);
							return;
						}
						var nextWidth = Math.round(width * 0.7);
						var nextHeight = Math.round(height * 0.7);
						if (nextWidth >= 64 && nextHeight >= 64) {
							compressAtSize(img, nextWidth, nextHeight, 0);
						} else {
							finish(null);
						}
					}, "image/jpeg", COMPRESS_QUALITIES[qualityIndex]);
				} catch (_error) {
					finish(null);
				}
			}
		}

		function themeFailureText(t, error) {
			var code = error && error.message ? error.message : "";
			if (code === "themeCanvasBlocked") return t("themeCanvasBlocked");
			if (code === "themeImageLoadFailed") return t("themeImageLoadFailed");
			if (code === "themeImageEmpty") return t("themeImageEmpty");
			if (code === "themePaletteTooSmall") return t("themeImageEmpty");
			return t("themeFailed") + (code ? " (" + code + ")" : "");
		}

		// Palette extraction runner shared by the background section (auto
		// follow after applying an image) and the auto-theme section (manual
		// generate / pick a different theme image). Overlapping runs are
		// dropped via a monotonically increasing run id.
		function useThemeGeneration(store, t) {
			var busyPair = React.useState(false);
			var busy = busyPair[0];
			var setBusy = busyPair[1];
			var errorPair = React.useState("");
			var error = errorPair[0];
			var setError = errorPair[1];
			var runRef = React.useRef(0);

			function generate(source) {
				var run = ++runRef.current;
				setBusy(true);
				setError("");
				extractThemeFromSource(source).then(
					function (palette) {
						if (run !== runRef.current) return;
						var profile = deriveThemeProfile(palette, "");
						store.setThemeProfile(palette, profile.fontId);
						setBusy(false);
					},
					function (err) {
						if (run !== runRef.current) return;
						setBusy(false);
						setError(themeFailureText(t, err));
					}
				);
			}

			function pickFile(file) {
				var started = readImageFile(file, t, {
					onData: function (data) {
						generate(data);
					},
					onError: function (message) {
						setBusy(false);
						setError(message);
					},
				});
				if (started) setBusy(true);
			}

			return {
				busy: busy,
				error: error,
				generate: generate,
				pickFile: pickFile,
				clearError: function () {
					setError("");
				},
			};
		}

		// ── Dialog section: background ─────────────────────────────────
		// Owns its URL draft / busy / error state; the dialog remounts it on
		// reset (key change), which re-initializes the draft from the store.
		function BackgroundSection(props) {
			var t = props.t;
			var snap = props.snap;
			var store = props.store;

			var draftPair = React.useState(snap.image);
			var urlDraft = draftPair[0];
			var setUrlDraft = draftPair[1];
			var errorPair = React.useState("");
			var error = errorPair[0];
			var setError = errorPair[1];
			var busyPair = React.useState(false);
			var busy = busyPair[0];
			var setBusy = busyPair[1];

			function afterImageApplied(source) {
				props.onApplied();
				if (store.getSnapshot().themeEnabled) props.gen.generate(source);
			}

			function applyUrl() {
				var value = String(urlDraft).trim();
				if (!value) return;
				if (value.length > MAX_URL_LENGTH) {
					setError(t("valueTooLarge"));
					return;
				}
				store.setImage(value);
				setError("");
				afterImageApplied(value);
			}

			function onFile(file) {
				var started = readImageFile(file, t, {
					onData: function (data) {
						setBusy(false);
						setError("");
						store.setImage(data);
						afterImageApplied(data);
					},
					onError: function (message) {
						setBusy(false);
						setError(message);
					},
				});
				if (started) setBusy(true);
			}

			return React.createElement(
				React.Fragment,
				null,
				React.createElement(
					"div",
					{ className: "dwb-row" },
					React.createElement(Input, {
						className: "dwb-url",
						value: urlDraft,
						placeholder: t("urlPlaceholder"),
						onChange: function (event) {
							setUrlDraft(event.target.value);
						},
						onKeyDown: function (event) {
							if (event.key === "Enter") applyUrl();
						},
					}),
					React.createElement(
						Button,
						{
							variant: "primary",
							size: "sm",
							disabled: busy || !String(urlDraft).trim(),
							onClick: applyUrl,
						},
						t("apply")
					)
				),
				React.createElement(
					"div",
					{ className: "dwb-row" },
					React.createElement(FileButton, {
						label: t("chooseFile"),
						busyLabel: t("reading"),
						busy: busy,
						disabled: busy,
						onFile: onFile,
					}),
					React.createElement("span", { className: "dwb-spacer" }),
					React.createElement(
						Button,
						{ variant: "ghost", size: "sm", onClick: props.onReset },
						t("reset")
					)
				),
				React.createElement(ErrorText, { text: error }),
				React.createElement(
					"div",
					{ className: "dwb-row dwb-sliderRow" },
					React.createElement(
						"label",
						{ className: "dwb-label", htmlFor: "dwb-overlay" },
						t("overlay") + " · " + Math.round(snap.overlay * 100) + "%"
					),
					React.createElement("input", {
						id: "dwb-overlay",
						className: "dwb-slider",
						type: "range",
						min: 0,
						max: 95,
						step: 1,
						value: Math.round(snap.overlay * 100),
						onChange: function (event) {
							store.setOverlay(Number(event.target.value) / 100);
						},
					})
				),
				React.createElement(Checkbox, {
					checked: snap.enabled,
					onChange: function (event) {
						store.setEnabled(event.target.checked);
					},
					label: t("enabled"),
				}),
				props.customMode
					? React.createElement(Checkbox, {
							checked: snap.customActive,
							onChange: function (event) {
								if (typeof props.setCustomMode === "function") {
									props.setCustomMode(event.target.checked);
								} else {
									store.setCustomActive(event.target.checked);
								}
							},
							label: t("customModeEnable"),
					  })
					: null,
				props.customMode
					? React.createElement(
							"div",
							{ className: "dwb-meta" },
							t("customModeHint")
					  )
					: null
			);
		}

		// ── Dialog section: auto theme ─────────────────────────────────
		var FONT_LABEL_KEYS = {
			system: "themeFontSystem",
			rounded: "themeFontRounded",
			tech: "themeFontTech",
			serif: "themeFontSerif",
		};

		function ThemeSection(props) {
			var t = props.t;
			var snap = props.snap;
			var store = props.store;
			var gen = props.gen;

			var fontOption = fontById(snap.themeFont);
			var fontLabel = fontOption ? t(FONT_LABEL_KEYS[fontOption.id]) : "";
			var paletteChips = snap.themePalette.map(function (color, index) {
				return React.createElement("span", {
					key: "dwb-chip-" + index,
					className: "dwb-chip",
					style: { backgroundColor: "#" + color },
				});
			});

			return React.createElement(
				React.Fragment,
				null,
				React.createElement(Checkbox, {
					checked: snap.themeEnabled,
					onChange: function (event) {
						var enabled = event.target.checked;
						store.setThemeEnabled(enabled);
						if (enabled && !store.getSnapshot().themePalette.length) {
							var next = store.getSnapshot();
							gen.generate(next.image || DEFAULT_IMAGE);
						}
					},
					label: t("themeAutoFollow"),
				}),
				React.createElement(
					"div",
					{ className: "dwb-row" },
					React.createElement(FileButton, {
						label: t("themeChooseFile"),
						busyLabel: t("themeGenerating"),
						busy: gen.busy,
						disabled: gen.busy,
						onFile: gen.pickFile,
					}),
					React.createElement(
						Button,
						{
							variant: "ghost",
							size: "sm",
							disabled: gen.busy,
							onClick: function () {
								gen.generate(snap.image || DEFAULT_IMAGE);
							},
						},
						t("themeGenerate")
					),
					React.createElement(
						Button,
						{
							variant: "ghost",
							size: "sm",
							disabled: gen.busy,
							onClick: function () {
								store.clearTheme();
								gen.clearError();
							},
						},
						t("themeClear")
					)
				),
				snap.themePalette.length > 0
					? React.createElement(
							"div",
							{ className: "dwb-chipRow" },
							React.createElement(
								"span",
								{ className: "dwb-meta" },
								t("themePalette")
							),
							paletteChips
					  )
					: null,
				snap.themePalette.length > 0
					? React.createElement(
							"div",
							{ className: "dwb-meta" },
							t("themeFontLabel") + " · " + fontLabel
					  )
					: null,
				React.createElement(
					"div",
					{ className: "dwb-meta" },
					snap.themeEnabled ? t("themeActive") : t("themeInactive")
				),
				React.createElement(ErrorText, { text: gen.error })
			);
		}

		// ── Dialog section: per-surface custom theme ───────────────────
		var CUSTOM_SURFACE_LABELS = {
			base: "surfaceBase",
			dialog: "surfaceDialog",
			panel: "surfacePanel",
			code: "surfaceCode",
			bubble: "surfaceBubble",
			input: "surfaceInput",
			menu: "surfaceMenu",
			selector: "surfaceSelector",
			sidebar: "surfaceSidebar",
			sidebarActive: "surfaceSidebarActive",
			highlight: "surfaceHighlight",
		};

		// One surface row: effective-color swatch, color picker (defaulting to
		// the resolved auto color, never misleading black), alpha slider that
		// works in both modes, and a reset-to-auto button once customized.
		function SurfaceRow(props) {
			var t = props.t;
			var key = props.surfaceKey;
			var entry = props.entry;
			var autoColor = props.autoColor;
			// Alpha works in both modes: with a custom color it is absolute;
			// in auto mode it rescales the auto color's baked alpha relative
			// to the surface default (see applyCustomThemeTokens).
			var alphaScale = entry.alpha / (THEME_SURFACE_DEFAULT_ALPHA[key] || 1);
			var effectiveCss = entry.color
				? rgbaFromRgb(hexToRgb(entry.color), clamp(entry.alpha, 0, 1))
				: alphaScale === 1
					? autoColor
					: scaleTokenAlpha(autoColor, alphaScale, THEME_SURFACE_DEFAULT_ALPHA[key]);
			var customized =
				entry.color !== "" || entry.alpha !== THEME_SURFACE_DEFAULT_ALPHA[key];

			return React.createElement(
				"div",
				{ className: "dwb-surfaceRow" },
				React.createElement("span", {
					className: "dwb-swatch",
					style: effectiveCss ? { backgroundColor: effectiveCss } : null,
					title: effectiveCss || t("customThemeAuto"),
				}),
				React.createElement(
					"span",
					{ className: "dwb-surfaceName" },
					t(CUSTOM_SURFACE_LABELS[key])
				),
				React.createElement("input", {
					type: "color",
					className: "dwb-colorInput",
					value: entry.color || cssColorToHex(autoColor) || "#7a8699",
					title: t("customThemeColor"),
					onChange: function (event) {
						props.onColorChange(event.target.value);
					},
				}),
				entry.color
					? null
					: React.createElement(
							"span",
							{ className: "dwb-autoBadge" },
							t("customThemeAuto")
					  ),
				React.createElement("input", {
					type: "range",
					className: "dwb-alphaSlider",
					min: 0,
					max: 100,
					step: 1,
					value: Math.round(entry.alpha * 100),
					title: t("customThemeOpacity"),
					onChange: function (event) {
						props.onAlphaChange(Number(event.target.value) / 100);
					},
				}),
				React.createElement(
					"span",
					{ className: "dwb-meta" },
					Math.round(entry.alpha * 100) + "%"
				),
				customized
					? React.createElement(
							Button,
							{
								variant: "ghost",
								size: "sm",
								onClick: props.onReset,
							},
							t("customThemeResetSurface")
					  )
					: null
			);
		}

		function CustomThemeSection(props) {
			var t = props.t;
			var snap = props.snap;
			var store = props.store;

			var custom = React.useMemo(
				function () {
					return normalizeThemeCustom(snap.themeCustom);
				},
				[snap.themeCustom]
			);
			// Resolved auto color per surface (first token of the group) in the
			// active color scheme — rows show what "auto" currently means and
			// the picker opens from the auto color instead of black.
			var scheme = props.getScheme ? props.getScheme() : "dark";
			// Memoized: dragging the overlay slider re-renders the dialog on
			// every tick, and neither the palette nor the ~90-token rebuild
			// should run for that.
			var autoTokens = React.useMemo(
				function () {
					return snap.themePalette.length
						? buildThemeTokens(deriveThemeProfile(snap.themePalette, snap.themeFont), null)
						: null;
				},
				[snap.themePalette, snap.themeFont]
			);

			var hasAnyCustom = THEME_SURFACE_ORDER.some(function (key) {
				var entry = custom[key];
				return entry.color !== "" || entry.alpha !== THEME_SURFACE_DEFAULT_ALPHA[key];
			});

			var surfaceRows = THEME_SURFACE_ORDER.map(function (key) {
				var entry = custom[key];
				var tokenName = THEME_SURFACE_TOKENS[key][0];
				var autoColor =
					autoTokens && autoTokens[tokenName]
						? autoTokens[tokenName][scheme] || autoTokens[tokenName].dark
						: "";
				return React.createElement(SurfaceRow, {
					key: key,
					surfaceKey: key,
					t: t,
					entry: entry,
					autoColor: autoColor,
					onColorChange: function (color) {
						store.setThemeSurface(key, { color: color });
					},
					onAlphaChange: function (alpha) {
						store.setThemeSurface(key, { alpha: alpha });
					},
					onReset: function () {
						store.setThemeSurface(key, {
							color: "",
							alpha: THEME_SURFACE_DEFAULT_ALPHA[key],
						});
					},
				});
			});

			var fontButtons = [
				React.createElement(
					Button,
					{
						key: "auto",
						variant: snap.themeFont === "" ? "primary" : "ghost",
						size: "sm",
						onClick: function () {
							store.setThemeFont("");
						},
					},
					t("themeFontAuto")
				),
			].concat(
				FONT_OPTIONS.map(function (font) {
					var labelKey = "themeFont" + font.id.charAt(0).toUpperCase() + font.id.slice(1);
					return React.createElement(
						Button,
						{
							key: font.id,
							variant: snap.themeFont === font.id ? "primary" : "ghost",
							size: "sm",
							onClick: function () {
								store.setThemeFont(font.id);
							},
						},
						t(labelKey)
					);
				})
			);

			return React.createElement(
				React.Fragment,
				null,
				React.createElement(
					"div",
					{ className: "dwb-customHint" },
					t("customThemeHint")
				),
				snap.themePalette.length
					? null
					: React.createElement(
							"div",
							{ className: "dwb-meta" },
							t("customThemeNoTheme")
					  ),
				React.createElement(
					"div",
					{ className: "dwb-surfaceList" },
					surfaceRows
				),
				React.createElement(
					"div",
					{ className: "dwb-row dwb-sliderRow" },
					React.createElement(
						"div",
						{ className: "dwb-label" },
						t("customThemeFont")
					),
					React.createElement(
						"div",
						{ className: "dwb-fontButtons" },
						fontButtons
					)
				),
				hasAnyCustom
					? React.createElement(
							"div",
							{ className: "dwb-row" },
							React.createElement(
								Button,
								{
									variant: "ghost",
									size: "sm",
									onClick: function () {
										store.clearThemeCustom();
									},
								},
								t("customThemeResetAll")
							)
					  )
					: null
			);
		}

		// ── Dialog resize helpers ──────────────────────────────────────
		// The modal card is located through the resize handle's ancestor chain
		// (role="dialog"), so no dependency on the shell's hashed class names.
		function dialogFromHandle(handle) {
			return handle && typeof handle.closest === "function"
				? handle.closest('[role="dialog"]')
				: null;
		}
		function clampDialogWidth(width) {
			var max =
				typeof window !== "undefined" && window.innerWidth
					? window.innerWidth - DIALOG_VIEWPORT_MARGIN
					: DIALOG_LENGTH_MAX;
			return clamp(width, DIALOG_MIN_WIDTH, Math.max(DIALOG_MIN_WIDTH, max));
		}
		function clampDialogHeight(height) {
			var max =
				typeof window !== "undefined" && window.innerHeight
					? window.innerHeight - DIALOG_VIEWPORT_MARGIN
					: DIALOG_LENGTH_MAX;
			return clamp(height, DIALOG_MIN_HEIGHT, Math.max(DIALOG_MIN_HEIGHT, max));
		}
		function applyDialogSize(handle, width, height) {
			var dialog = dialogFromHandle(handle);
			if (!dialog) return;
			dialog.style.width = width > 0 ? clampDialogWidth(width) + "px" : "";
			dialog.style.height = height > 0 ? clampDialogHeight(height) + "px" : "";
		}

		// ── Appearance dialog ──────────────────────────────────────────
		// One modal hosts background + auto theme + per-surface controls, each
		// in its own accordion. The theme-generation hook lives here so both
		// the background section (auto follow) and the theme section (manual)
		// share one runner.
		function AppearanceDialog(props) {
			var t = props.t;
			var store = props.store;
			var snap = props.snap;
			var gen = useThemeGeneration(store, t);
			var sectionsPair = React.useState({ background: true, theme: false, custom: false });
			var sections = sectionsPair[0];
			var setSections = sectionsPair[1];
			// Bumped on "reset to default" so the background section remounts
			// with a fresh URL draft instead of resurrecting the old one.
			var resetPair = React.useState(0);
			var resetCount = resetPair[0];
			var setResetCount = resetPair[1];
			var resizeHandleRef = React.useRef(null);

			// Re-apply the persisted dialog size when it changes (including the
			// 0/0 reset to the modal's natural size).
			React.useEffect(
				function () {
					applyDialogSize(resizeHandleRef.current, snap.dialogWidth, snap.dialogHeight);
				},
				[snap.dialogWidth, snap.dialogHeight]
			);

			function toggleSection(key) {
				setSections(function (prev) {
					var next = { background: prev.background, theme: prev.theme, custom: prev.custom };
					next[key] = !prev[key];
					return next;
				});
			}

			function onReset() {
				store.reset();
				gen.clearError();
				setResetCount(function (count) {
					return count + 1;
				});
			}

			// Drag the corner grip: the card resizes through direct DOM style
			// writes (no React re-render per pointermove); the store commit —
			// and thus persistence — happens once, on pointerup.
			function onResizeStart(event) {
				if (event.button != null && event.button !== 0) return;
				event.preventDefault();
				var handle = event.currentTarget;
				var dialog = dialogFromHandle(handle);
				if (!dialog) return;
				var startX = event.clientX;
				var startY = event.clientY;
				var rect = dialog.getBoundingClientRect();
				var lastWidth = rect.width;
				var lastHeight = rect.height;
				function onMove(move) {
					lastWidth = clampDialogWidth(rect.width + (move.clientX - startX));
					lastHeight = clampDialogHeight(rect.height + (move.clientY - startY));
					dialog.style.width = lastWidth + "px";
					dialog.style.height = lastHeight + "px";
				}
				function onUp() {
					handle.removeEventListener("pointermove", onMove);
					handle.removeEventListener("pointerup", onUp);
					handle.removeEventListener("pointercancel", onUp);
					store.setDialogSize(Math.round(lastWidth), Math.round(lastHeight));
				}
				handle.addEventListener("pointermove", onMove);
				handle.addEventListener("pointerup", onUp);
				handle.addEventListener("pointercancel", onUp);
				if (handle.setPointerCapture && event.pointerId != null) {
					try {
						handle.setPointerCapture(event.pointerId);
					} catch (_error) {}
				}
			}

			function onResizeReset() {
				store.setDialogSize(0, 0);
				applyDialogSize(resizeHandleRef.current, 0, 0);
			}

			return React.createElement(
				Modal,
				{
					open: true,
					onClose: props.onClose,
					title: t("modalTitle"),
					closeLabel: t("close"),
					className: "dwb-dialog",
				},
				React.createElement(
					"div",
					{ className: "dwb-form" },
					React.createElement(
						Accordion,
						{
							title: t("sectionBackground"),
							open: sections.background,
							onToggle: function () {
								toggleSection("background");
							},
							bodyClassName: "dwb-accordionBody",
						},
						React.createElement(BackgroundSection, {
							key: "bg-" + resetCount,
							t: t,
							snap: snap,
							store: store,
							gen: gen,
							customMode: props.customMode,
							setCustomMode: props.setCustomMode,
							onApplied: props.onClose,
							onReset: onReset,
						})
					),
					React.createElement(
						Accordion,
						{
							title: t("sectionAutoTheme"),
							open: sections.theme,
							onToggle: function () {
								toggleSection("theme");
							},
							bodyClassName: "dwb-themeSection",
						},
						React.createElement(ThemeSection, {
							t: t,
							snap: snap,
							store: store,
							gen: gen,
						})
					),
					React.createElement(
						Accordion,
						{
							title: t("sectionCustomTheme"),
							open: sections.custom,
							onToggle: function () {
								toggleSection("custom");
							},
							bodyClassName: "dwb-themeSection",
						},
						React.createElement(CustomThemeSection, {
							t: t,
							snap: snap,
							store: store,
							getScheme: props.getScheme,
						})
					),
					React.createElement("span", {
						ref: resizeHandleRef,
						className: "dwb-resizeHandle",
						role: "presentation",
						"aria-hidden": "true",
						title: t("resizeDialog"),
						onPointerDown: onResizeStart,
						onDoubleClick: onResizeReset,
					})
				)
			);
		}

		// ── Settings row ───────────────────────────────────────────────
		// The "自定义外观" row in General settings: title + clickable preview
		// box; the modal above opens on click.
		function BackgroundRow(props) {
			var t = props.t;
			var store = props.store;
			var snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var openPair = React.useState(false);
			var openModal = openPair[0];
			var setOpenModal = openPair[1];

			var previewStyle = {
				backgroundImage: overlayLayer(snap.overlay) + ", " + wrapImage(snap.enabled ? snap.image : ""),
				backgroundSize: "cover, cover",
				backgroundPosition: "center, center",
			};

			return React.createElement(
				"div",
				{ className: "dwb-group" },
				React.createElement(
					"div",
					{ className: "dwb-title" },
					t("title")
				),
				React.createElement(
					"button",
					{
						type: "button",
						className: "dwb-preview",
						style: previewStyle,
						"aria-label": t("modalTitle"),
						title: t("modalTitle"),
						onClick: function () {
							setOpenModal(true);
						},
					},
					React.createElement(
						"span",
						{ className: "dwb-badge" },
						!snap.enabled ? t("disabled") : snap.image ? t("customized") : t("defaultLabel")
					),
					React.createElement(
						"span",
						{ className: "dwb-hint" },
						t("clickToCustomize")
					)
				),
				openModal
					? React.createElement(AppearanceDialog, {
							t: t,
							store: store,
							snap: snap,
							getScheme: props.getScheme,
							customMode: props.customMode,
							setCustomMode: props.setCustomMode,
							onClose: function () {
								setOpenModal(false);
							},
					  })
					: null
			);
		}

		// ── Plugin entry ─────────────────────────────────────────────────
		// Only the services actually used below. `theme` stays required for now
		// (ui-theme is always present in the web shell); the defensive checks on
		// ctx.theme keep the auto theme a graceful no-op if that ever changes.
		// DSH ≥ 0.1.7: durable preferences ride the `configForms` service
		// (ui-settings); the removed `settingsScope` service made the web boot
		// hold this entry pending forever.
		var inject = ["slots", "locale", "configForms", "theme"];

		function apply(ctx) {
			// NS doubles as the Host loader entry id (cordis.patch.yml), which is
			// the namespace the settings mirror serves this plugin under.
			var scope = ctx.configForms.get(NS);
			var store = createBackgroundStore(scope);
			// One-shot repair: the v0.2.0 diagnostic beacon briefly used the
			// themeFont field as a disk-readable channel and left "DBG …"
			// behind in the Host record; restore the user's previous font.
			var themeFontRestored = false;
			function repairBeaconFont() {
				if (themeFontRestored) return;
				try {
					var snap = scope.getSnapshot();
					var font = snap && snap.user && snap.user.themeFont;
					if (typeof font === "string" && font.indexOf("DBG ") === 0) {
						themeFontRestored = true;
						var r = scope.set("themeFont", "tech");
						if (r && typeof r.catch === "function") r.catch(function () {});
					}
				} catch (_error) {}
			}

			// Cancel the debounced persist timer when the plugin fiber dies.
			ctx.effect(
				function () {
					return function () {
						store.dispose();
					};
				},
				"dsh-web-background: store teardown"
			);

			// Settings row stylesheet — owned by the fiber so unloading the
			// plugin also removes the row styles.
			ctx.effect(
				function () {
					if (typeof document === "undefined") return undefined;
					var rowTag = document.createElement("style");
					rowTag.dataset.plugin = NS;
					rowTag.dataset.pluginCss = ROW_CSS_ID;
					rowTag.textContent = ROW_CSS;
					document.head.appendChild(rowTag);
					return function () {
						rowTag.remove();
					};
				},
				"dsh-web-background: settings row css"
			);

			// Active color scheme ("light"/"dark") for the per-surface preview
			// swatches: ask the theme service first, then the OS preference.
			function currentScheme() {
				try {
					if (ctx.theme && typeof ctx.theme.getTheme === "function") {
						var theme = ctx.theme.getTheme();
						var scheme = theme && theme.active && theme.active.colorScheme;
						if (scheme === "light" || scheme === "dark") return scheme;
					}
				} catch (_error) {}
				try {
					if (
						typeof window !== "undefined" &&
						window.matchMedia &&
						window.matchMedia("(prefers-color-scheme: light)").matches
					) {
						return "light";
					}
				} catch (_error) {}
				return "dark";
			}

			// ── Custom appearance mode ─────────────────────────────────
			// The plugin's image-derived look rides on top of the shell's
			// DARK appearance: entering the "自定义" mode persists the
			// built-in "dark" preference (a legal schema value) and stacks an
			// overrideTokens layer whose tokens carry the same value on both
			// scheme channels, so the custom look is scheme-independent.
			//
			// Why not a registered custom theme id: ui-theme's adopt()
			// re-imposes the PERSISTED preference on every settings sync
			// (~20s cadence in the desktop app), and its schema only accepts
			// light/dark/system — a session-only custom id gets stomped on
			// every cycle and the light flash between stomp and re-assert is
			// user-visible. With "dark" persisted, adopt() is a permanent
			// no-op while custom mode is active.
			//
			// The layer is stacked only while customActive is on; picking a
			// built-in appearance (cube click captured in the capture phase)
			// leaves custom mode and lifts the layer, so built-in
			// appearances stay stock. On shells without the full theme API
			// the plugin falls back to the legacy behavior: an overrideTokens
			// layer stacked over the active appearance.
			var customThemeMode = !!(
				ctx.theme &&
				typeof ctx.theme.overrideTokens === "function" &&
				typeof ctx.theme.setTheme === "function" &&
				typeof ctx.theme.getTheme === "function"
			);
			// (CUSTOM_BASE_PREFERENCE — "dark", a legal schema value — is
			// persisted while custom mode is on, so ui-theme's adopt()
			// never fights it; see the module-level declaration.)
			var currentPreference = "";
			// True while this plugin runs its own layer/setTheme sequence;
			// the theme/change handler must not react to those publishes.
			var themeSyncing = false;
			// The built-in preference the shell had before custom mode was
			// entered; restored when custom mode is left through the custom
			// cube or the dialog switch (a built-in cube click sets its own).
			var prevBuiltInPreference = "system";
			function readPreference() {
				try {
					var theme = ctx.theme.getTheme();
					if (theme && typeof theme.preference === "string") return theme.preference;
				} catch (_error) {}
				return "";
			}
			// The custom look must survive even a transient scheme flip (the
			// frame between a deliberate leave and the layer lift): lock both
			// scheme channels of every token to the dark value.
			function schemeLockedTokens(pairs) {
				var out = {};
				for (var name in pairs) {
					out[name] = { light: pairs[name].dark, dark: pairs[name].dark };
				}
				return out;
			}
			if (customThemeMode) currentPreference = readPreference();

			// Keep the image-derived GUI theme in sync with the settings
			// snapshot. The base theme plugin projects ctx.theme token layers
			// onto document.body, so this plugin only computes the palette.
			var disposeThemeLayer = null;
			var disposeCustomTheme = null;
			function releaseThemeLayer() {
				if (!disposeThemeLayer) return;
				var release = disposeThemeLayer;
				disposeThemeLayer = null;
				try {
					release();
				} catch (_error) {}
			}
			function releaseCustomTheme() {
				if (!disposeCustomTheme) return;
				var release = disposeCustomTheme;
				disposeCustomTheme = null;
				try {
					release();
				} catch (_error) {}
			}
			// Skip the full ~90-token rebuild + theme write when a store
			// change did not touch theme inputs (e.g. dragging the overlay
			// slider). JSON.stringify on themeCustom is cheap (11 small
			// entries) compared to rebuilding the token layer.
			var lastThemeKey = null;
			function themeKey(next) {
				if (customThemeMode) {
					// Custom mode paints nothing while the user is on a
					// built-in appearance; "plain" is the dark scheme with no
					// token overrides (background only, stock dark surfaces).
					if (!next.customActive) return "off";
					if (!next.themeEnabled || !next.themePalette.length) return "plain";
				} else if (!next.themeEnabled || !next.themePalette.length) return "off";
				return (
					next.themePalette.join(",") +
					"|" + next.themeFont +
					"|" + JSON.stringify(next.themeCustom)
				);
			}
			function paintTheme(next) {
				var key = themeKey(next);
				if (key === lastThemeKey) return;
				lastThemeKey = key;
				themeSyncing = true;
				try {
					releaseThemeLayer();
					releaseCustomTheme();
					if (customThemeMode) {
						if (key === "off") return;
						// "plain" = background only, stock dark surfaces: no
						// layer at all (an empty layer would still publish).
						if (key === "plain") return;
						var profile = deriveThemeProfile(next.themePalette, next.themeFont);
						try {
							disposeCustomTheme = ctx.theme.overrideTokens(
								THEME_OVERRIDE_SOURCE,
								schemeLockedTokens(buildThemeTokens(profile, next.themeCustom))
							);
						} catch (_error) {
							disposeCustomTheme = null;
							if (typeof console !== "undefined" && console.warn) {
								console.warn("[dsh-web-background] custom theme layer failed", _error);
							}
						}
						return;
					}
					if (key === "off") return;
					if (!ctx.theme || typeof ctx.theme.overrideTokens !== "function") return;
					var legacyProfile = deriveThemeProfile(next.themePalette, next.themeFont);
					try {
						disposeThemeLayer = ctx.theme.overrideTokens(THEME_OVERRIDE_SOURCE, buildThemeTokens(legacyProfile, next.themeCustom));
					} catch (_error) {
						disposeThemeLayer = null;
						if (typeof console !== "undefined" && console.warn) {
							console.warn("[dsh-web-background] auto theme override failed", _error);
						}
					}
				} finally {
					themeSyncing = false;
				}
			}
			// Re-assert the custom base preference after the shell moved it
			// elsewhere without a cube click (boot-time settings adoption,
			// cross-window settings sync). No-op when the user left
			// deliberately (onThemeChange clears customActive in that case).
			function assertCustomPreference(next) {
				if (!customThemeMode || !next.customActive) return;
				if (currentPreference === CUSTOM_BASE_PREFERENCE) return;
				themeSyncing = true;
				try {
					ctx.theme.setTheme(CUSTOM_BASE_PREFERENCE);
				} catch (_error) {
					if (typeof console !== "undefined" && console.warn) {
						console.warn("[dsh-web-background] cannot enter the custom appearance", _error);
					}
				}
				themeSyncing = false;
				currentPreference = readPreference();
			}
			function customModeVisible(snap) {
				return (
					snap.customActive && currentPreference === CUSTOM_BASE_PREFERENCE
				);
			}
			function repaintBackground() {
				var snap = store.getSnapshot();
				var visible = customThemeMode ? customModeVisible(snap) : true;
				paintBackground(snap.enabled && visible, snap.image, snap.overlay);
			}
			function onThemeChange(snapshot) {
				var pref =
					snapshot && typeof snapshot.preference === "string"
						? snapshot.preference
						: readPreference();
				currentPreference = pref;
				if (!themeSyncing) {
					var snap = store.getSnapshot();
					if (customThemeMode && snap.customActive && pref !== CUSTOM_BASE_PREFERENCE) {
						// No built-in cube was clicked (those leave custom
						// mode synchronously in the capture-phase listener):
						// a settings echo moved the preference — pull it
						// back onto the custom base.
						assertCustomPreference(snap);
					}
				}
				repaintBackground();
				refreshAppearanceCube();
			}

			// Keep the theme layer, preference and background in sync with
			// the settings snapshot; follow shell theme switches.
			ctx.effect(
				function () {
					paintTheme(store.getSnapshot());
					assertCustomPreference(store.getSnapshot());
					repaintBackground();
					var unsubscribe = store.subscribe(function () {
						var next = store.getSnapshot();
						paintTheme(next);
						assertCustomPreference(next);
						repaintBackground();
						refreshAppearanceCube();
					});
					var offThemeChange = null;
					if (customThemeMode && typeof ctx.on === "function") {
						try {
							offThemeChange = ctx.on("theme/change", onThemeChange);
						} catch (_error) {
							offThemeChange = null;
						}
					}
					// Boot watchdog: belt-and-braces recovery for the cases the
					// event path misses — a configForms scope that never fires
					// its ready notification (store stuck on the local mirror)
					// or a theme/change listener that sees nothing (event bus
					// isolation). Once a second, re-read the store until the
					// scope is ready, and re-assert the custom base preference
					// whenever custom mode is active in the store but the
					// shell sits on another preference. Cheap no-op once the
					// state is consistent.
					var watchdog = setInterval(function () {
						try {
							repairBeaconFont();
							var snap = store.getSnapshot();
							if (scope.getSnapshot().status !== "ready") {
								store.poke();
							}
							if (
								customThemeMode &&
								snap.customActive &&
								readPreference() !== CUSTOM_BASE_PREFERENCE
							) {
								currentPreference = readPreference();
								assertCustomPreference(snap);
								repaintBackground();
							}
						} catch (_error) {}
					}, 1000);
					// Never keep a (test/headless) event loop alive for this.
					if (watchdog && typeof watchdog.unref === "function") watchdog.unref();
					return function () {
						unsubscribe();
						if (typeof offThemeChange === "function") {
							try {
								offThemeChange();
							} catch (_error) {}
						}
						clearInterval(watchdog);
						lastThemeKey = null;
						releaseThemeLayer();
						releaseCustomTheme();
						lastBackgroundKey = null;
						var tag = ensureStyleTag();
						if (tag) tag.textContent = "";
					};
				},
				"dsh-web-background: appearance sync"
			);

			// Register the settings row dictionaries.
			ctx.effect(
				function () {
					return ctx.locale.register("settings.background", { zh: zh, en: en });
				},
				"dsh-web-background: settings row dictionaries"
			);

			// ── "自定义" cube in the shell Appearance row ──────────────
			// The shell's AppearanceRow hardcodes its three cubes, so the
			// plugin appends a fourth one into the cube row's DOM. Robustness
			// notes:
			//  - the row is located by hashed-class probes (per-build list
			//    APPEARANCE_CUBE_PROBES) with a structural fallback (a
			//    container of exactly three aria-pressed toggle buttons);
			//  - cube styling is copied from the shell's own cubes at runtime:
			//    the base class list from an unpressed cube, and the
			//    selected-marker classes as the classList delta between the
			//    pressed and an unpressed cube (cached in localStorage so the
			//    selected look is available even when the mode starts active
			//    and no built-in cube is pressed);
			//  - React re-renders of the row only patch the three known cubes
			//    in place; a MutationObserver re-asserts our cube if a remount
			//    drops it.
			var cubeButton = null;
			var cubeRoot = null;
			var cubeBaseClass = "";
			var cubeSelectedClasses = null;
			var cubeRowWarned = false;
			function loadCubeCache() {
				try {
					if (typeof window === "undefined" || !window.localStorage) return;
					var raw = window.localStorage.getItem(CUBE_CACHE_KEY);
					if (!raw) return;
					var parsed = JSON.parse(raw);
					if (parsed && Array.isArray(parsed.selected) && parsed.selected.length) {
						cubeSelectedClasses = parsed.selected;
					}
					if (parsed && typeof parsed.base === "string" && parsed.base && !cubeBaseClass) {
						cubeBaseClass = parsed.base;
					}
				} catch (_error) {}
			}
			function saveCubeCache() {
				try {
					if (typeof window === "undefined" || !window.localStorage) return;
					window.localStorage.setItem(
						CUBE_CACHE_KEY,
						JSON.stringify({ selected: cubeSelectedClasses || [], base: cubeBaseClass || "" })
					);
				} catch (_error) {}
			}
			function classListOf(element) {
				var out = [];
				if (!element || !element.classList) return out;
				for (var i = 0; i < element.classList.length; i++) out.push(element.classList[i]);
				return out;
			}
			function shellCubes(row) {
				var out = [];
				if (!row || !row.children) return out;
				for (var i = 0; i < row.children.length; i++) {
					var child = row.children[i];
					if (
						child &&
						child.tagName === "BUTTON" &&
						child.getAttribute("data-dwb-cube") == null
					) {
						out.push(child);
					}
				}
				return out;
			}
			function findAppearanceCubeRow() {
				if (typeof document === "undefined") return null;
				for (var i = 0; i < APPEARANCE_CUBE_PROBES.length; i++) {
					try {
						var el = document.querySelector(
							"[class*='" + APPEARANCE_CUBE_PROBES[i] + "_cubeRow']"
						);
						if (el) return el;
					} catch (_error) {}
				}
				// Structural fallback: a container whose children are exactly
				// the three aria-pressed Light/Dark/System toggle buttons.
				var candidates = document.querySelectorAll("button[aria-pressed]");
				for (var j = 0; j < candidates.length; j++) {
					var parent = candidates[j].parentElement;
					if (!parent || parent.getAttribute("data-dwb-cube") != null) continue;
					var cubes = shellCubes(parent);
					if (cubes.length !== 3) continue;
					var allToggles = true;
					for (var k = 0; k < cubes.length; k++) {
						if (!cubes[k].hasAttribute("aria-pressed")) {
							allToggles = false;
							break;
						}
					}
					if (allToggles) return parent;
				}
				return null;
			}
			// Refresh the copied cube styles while a pressed built-in cube is
			// observable (i.e. while a built-in appearance is selected).
			function captureCubeStyles(row) {
				var cubes = shellCubes(row);
				var pressed = null;
				var unpressed = null;
				for (var i = 0; i < cubes.length; i++) {
					if (cubes[i].getAttribute("aria-pressed") === "true") pressed = cubes[i];
					else if (!unpressed) unpressed = cubes[i];
				}
				var base = unpressed || pressed;
				if (!base) return;
				var dirty = false;
				var baseClasses = classListOf(base);
				if (pressed && unpressed) {
					var unpressedSet = {};
					var unpressedClasses = classListOf(unpressed);
					for (var u = 0; u < unpressedClasses.length; u++) unpressedSet[unpressedClasses[u]] = true;
					var pressedClasses = classListOf(pressed);
					var delta = [];
					for (var p = 0; p < pressedClasses.length; p++) {
						if (!unpressedSet[pressedClasses[p]]) delta.push(pressedClasses[p]);
					}
					if (delta.length && delta.join(" ") !== (cubeSelectedClasses || []).join(" ")) {
						cubeSelectedClasses = delta;
						dirty = true;
					}
				}
				if (baseClasses.length) {
					var joined = baseClasses.join(" ");
					if (joined !== cubeBaseClass) {
						cubeBaseClass = joined;
						dirty = true;
					}
				}
				if (dirty) saveCubeCache();
			}
			function cubeLabel() {
				try {
					if (ctx.locale && typeof ctx.locale.bind === "function") {
						return ctx.locale.bind("settings.background")("customCube");
					}
				} catch (_error) {}
				return "Custom";
			}
			function refreshAppearanceCube() {
				if (!cubeButton) return;
				var active = customThemeMode && customModeVisible(store.getSnapshot());
				cubeButton.setAttribute("aria-pressed", active ? "true" : "false");
				var cls = cubeBaseClass || "";
				var selected = cubeSelectedClasses || [];
				if (active && selected.length) cls = cls + " " + selected.join(" ");
				if (cls) cubeButton.className = cls;
				// While custom mode rides on the persisted "dark" preference,
				// the shell's dark cube keeps rendering selected (its
				// aria-pressed comes from the preference). Suppress that
				// look so only the custom cube appears active; restore it on
				// the way out. React re-renders reconcile this naturally.
				var row = cubeButton.parentElement;
				if (row && selected.length) {
					var cubes = shellCubes(row);
					for (var i = 0; i < cubes.length; i++) {
						if (cubes[i].getAttribute("aria-pressed") !== "true") continue;
						for (var s = 0; s < selected.length; s++) {
							if (active) cubes[i].classList.remove(selected[s]);
							else cubes[i].classList.add(selected[s]);
						}
					}
				}
				// Fallback selection marker for the rare first-ever run that
				// starts in custom mode before any built-in cube was observed.
				cubeButton.style.boxShadow =
					active && !selected.length
						? "inset 0 0 0 1.5px var(--dsw-alias-state-business-primary)"
						: "";
			}
			function onShellCubeClick() {
				// Picking a built-in appearance while custom mode is on is a
				// deliberate leave. Exit custom mode immediately (capture
				// phase, before the shell's own handler publishes) so even
				// re-clicking the dark cube — which never publishes, since
				// the preference already IS dark — restores the stock look.
				if (!customThemeMode || !store.getSnapshot().customActive) return;
				store.setCustomActive(false);
			}
			function leaveCustomMode() {
				// Leave through the custom cube / dialog switch: restore the
				// built-in preference the shell had before custom mode
				// ("system" when it was never observed).
				store.setCustomActive(false);
				var target = prevBuiltInPreference || "system";
				themeSyncing = true;
				try {
					ctx.theme.setTheme(target);
				} catch (_error) {}
				themeSyncing = false;
				currentPreference = readPreference();
				repaintBackground();
				refreshAppearanceCube();
			}
			function enterCustomMode() {
				// Remember the built-in preference being replaced; the
				// persisted value moves to the custom base ("dark") via
				// assertCustomPreference in the store subscriber.
				var cur = readPreference();
				if (cur === "light" || cur === "dark" || cur === "system") {
					prevBuiltInPreference = cur;
				}
				store.setCustomActive(true);
			}
			function onCustomCubeClick() {
				if (!customThemeMode) return;
				if (store.getSnapshot().customActive) {
					leaveCustomMode();
					return;
				}
				enterCustomMode();
			}
			function ensureAppearanceCube() {
				if (!customThemeMode) return;
				var row = findAppearanceCubeRow();
				if (!row) {
					// Warn only when a toggle-button group is on screen yet no
					// cube row matched (i.e. the probes went stale after a dsh
					// upgrade); a closed settings page stays silent.
					var togglesPresent = false;
					try {
						togglesPresent = !!document.querySelector("button[aria-pressed]");
					} catch (_error) {}
					if (togglesPresent && !cubeRowWarned) {
						cubeRowWarned = true;
						if (typeof console !== "undefined" && console.warn) {
							console.warn(
								"[dsh-web-background] Appearance cube row not found; " +
									"the \"自定义\" cube is unavailable (re-probe APPEARANCE_CUBE_PROBES " +
									"after a dsh upgrade). The dialog switch still toggles custom mode."
							);
						}
					}
					return;
				}
				cubeRowWarned = false;
				// Bind the deliberate-switch detector onto the shell cubes.
				var cubes = shellCubes(row);
				for (var i = 0; i < cubes.length; i++) {
					if (!cubes[i].__dwbBound) {
						cubes[i].__dwbBound = true;
						cubes[i].addEventListener("click", onShellCubeClick, true);
					}
				}
				if (cubeButton && cubeButton.parentElement === row && cubeButton.isConnected) {
					refreshAppearanceCube();
					return;
				}
				if (!cubeSelectedClasses && !cubeBaseClass) loadCubeCache();
				captureCubeStyles(row);
				var btn = document.createElement("button");
				btn.type = "button";
				btn.setAttribute("data-dwb-cube", "1");
				if (cubeBaseClass) btn.className = cubeBaseClass;
				btn.setAttribute("aria-pressed", "false");
				var label = cubeLabel();
				if (cubeRoot) {
					try {
						cubeRoot.unmount();
					} catch (_error) {}
					cubeRoot = null;
				}
				var Icon = primitives.IconSparkleMedium || primitives.IconEditOutlineMedium || null;
				if (ReactDOMClient && typeof ReactDOMClient.createRoot === "function") {
					try {
						cubeRoot = ReactDOMClient.createRoot(btn);
						cubeRoot.render(
							React.createElement(
								React.Fragment,
								null,
								Icon ? React.createElement(Icon, {}) : null,
								label
							)
						);
					} catch (_error) {
						cubeRoot = null;
						btn.textContent = label;
					}
				} else {
					btn.textContent = label;
				}
				btn.addEventListener("click", onCustomCubeClick);
				cubeButton = btn;
				row.appendChild(btn);
				refreshAppearanceCube();
			}
			ctx.effect(
				function () {
					if (!customThemeMode) return undefined;
					if (typeof document === "undefined" || typeof MutationObserver !== "function") {
						return undefined;
					}
					loadCubeCache();
					var scheduled = false;
					var observer = new MutationObserver(function () {
						if (scheduled) return;
						scheduled = true;
						Promise.resolve().then(function () {
							scheduled = false;
							ensureAppearanceCube();
						});
					});
					try {
						observer.observe(document.documentElement || document.body, {
							childList: true,
							subtree: true,
						});
					} catch (_error) {}
					ensureAppearanceCube();
					return function () {
						observer.disconnect();
						if (cubeRoot) {
							try {
								cubeRoot.unmount();
							} catch (_error) {}
							cubeRoot = null;
						}
						if (cubeButton) {
							cubeButton.remove();
							cubeButton = null;
						}
					};
				},
				"dsh-web-background: custom appearance cube"
			);

			// Single combined "自定义外观" row in the General settings
			// Appearance block, right below Light/Dark/System. One modal hosts
			// background + auto theme + per-surface custom theme controls.
			ctx.slots.inject("settings.general.item", function () {
				return ctx.slots.register(
					{
						name: "settings.general.item",
						id: "appearance-custom",
						order: 11,
						locale: "settings.background",
						inject: function () {
							return {
								store: store,
								getScheme: currentScheme,
								customMode: customThemeMode,
								setCustomMode: function (on) {
									if (!customThemeMode) return;
									if (on) enterCustomMode();
									else leaveCustomMode();
								},
							};
						},
					},
					BackgroundRow
				);
			});
		}

		// The client-side cordis loader applies this module as a plugin, so the
		// factory's return value must be an object with an apply() method.
		exports.apply = apply;
		exports.inject = inject;
		exports.name = NS;
		// Offline test hatch (not part of the public plugin surface).
		exports.__test = {
			CUSTOM_BASE_PREFERENCE: CUSTOM_BASE_PREFERENCE,
			normalizePalette: normalizePalette,
			deriveThemeProfile: deriveThemeProfile,
			buildThemeTokens: buildThemeTokens,
			extractPaletteFromImage: extractPaletteFromImage,
			cssColorToHex: cssColorToHex,
			scaleTokenAlpha: scaleTokenAlpha,
		};

		return module.exports;
	},
});
