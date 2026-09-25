/**
 * Offline smoke test for lib/client.js — no browser needed.
 *
 * Loads the bundle with mocked document/window and real React, drives the
 * plugin's apply() through a mocked cordis ctx, then server-renders the
 * settings row once with a live fake settings scope. Catches ReferenceErrors,
 * wrong service shapes, and hook misuse before the bundle reaches the page.
 *
 * Usage: node scripts/smoke-test.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Resolve React from the dsh install's flat node_modules (the same tree the
// plugin runs against at runtime). Override with DSH_PACKAGE_JSON when the
// global install lives somewhere else.
const dshPackageJson =
	process.env.DSH_PACKAGE_JSON ||
	join(homedir(), ".local/lib/node_modules/@deepseek-ai/dsh/package.json");
const dshRequire = createRequire(dshPackageJson);
const React = dshRequire("react");
const { renderToString } = dshRequire("react-dom/server");

// SSR cannot satisfy useSyncExternalStore without getServerSnapshot; the real
// shell renders client-side, so stand in a useState-based store hook for the test.
React.useSyncExternalStore = function smokeUseSyncExternalStore(subscribe, getSnapshot) {
	const pair = React.useState(getSnapshot());
	const value = pair[0];
	const setValue = pair[1];
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

// ── Fake DOM ────────────────────────────────────────────────────────────
function makeElement() {
	return {
		dataset: {},
		style: {},
		isConnected: true,
		textContent: "",
		appendChild() {},
		remove() {},
		setAttribute(name, value) {
			this.dataset[name] = value;
		},
		getAttribute(name) {
			return this.dataset[name];
		},
	};
}
const head = makeElement();
const created = [];
const fakeDocument = {
	head,
	querySelector(selector) {
		if (typeof selector === "string" && selector.startsWith("style[data-plugin-css=")) {
			return created.find((el) => el.dataset.pluginCss === JSON.parse(selector.slice(22, -1)));
		}
		return null;
	},
	createElement(tag) {
		if (tag === "canvas") {
			return {
				width: 0,
				height: 0,
				getContext() {
					return {
						drawImage() {},
						getImageData(x, y, width, height) {
							const data = new Uint8Array(width * height * 4);
							// Gray-green border/background + coral subject in the center:
							// the full-image bucket for the border has more pixels, so only
							// center + border-contrast subject detection can pick the coral.
							for (let py = 0; py < height; py++) {
								for (let px = 0; px < width; px++) {
									const offset = (py * width + px) * 4;
									const inSubject = px >= width * 0.3 && px < width * 0.7 && py >= height * 0.3 && py < height * 0.7;
									if (inSubject) {
										data[offset] = 235; data[offset + 1] = 64; data[offset + 2] = 36;
									} else if (px < 2 && py < 2) {
										// Small dark detail in the far corner: adds a third
										// palette entry without competing for subject weight.
										data[offset] = 30; data[offset + 1] = 40; data[offset + 2] = 90;
									} else {
										data[offset] = 118; data[offset + 1] = 138; data[offset + 2] = 128;
									}
									data[offset + 3] = 255;
								}
							}
							return { data };
						},
					};
				},
			};
		}
		const el = makeElement();
		created.push(el);
		return el;
	},
};

const fakeWindow = { localStorage: undefined };
const fakeModuleLoader = { load(handoff) {
	fakeModuleLoader.handoff = handoff;
} };
fakeWindow.__ModuleLoader__ = fakeModuleLoader;
globalThis.window = fakeWindow;
globalThis.document = fakeDocument;

// ── Module table ────────────────────────────────────────────────────────
const fakeRequire = (spec) => {
	if (spec === "react") return React;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") {
		return {
			Input: (props) => React.createElement("input", props),
			Button: (props) => React.createElement("button", props),
			Modal: (props) =>
				props.open
					? React.createElement("div", { role: "dialog", "aria-label": props.title }, props.children)
					: null,
		};
	}
	throw new Error("unexpected require: " + spec);
};

// ── Load bundle ─────────────────────────────────────────────────────────
const source = readFileSync(join(root, "lib", "client.js"), "utf8");
eval(source);
const handoff = fakeModuleLoader.handoff;
if (!handoff || handoff.id !== "dsh-web-background") throw new Error("bundle did not register");
const plugin = handoff.factory(fakeRequire);
if (typeof plugin.apply !== "function") throw new Error("plugin has no apply");
if (!plugin.__test || typeof plugin.__test.deriveThemeProfile !== "function") throw new Error("theme test hatch missing");

// ── Fake settings scope (status transitions) ────────────────────────────
const defaultCustom = () => ({
	base: { color: "", alpha: 1 },
	dialog: { color: "", alpha: 0.72 },
	panel: { color: "", alpha: 0.66 },
	code: { color: "", alpha: 0.6 },
	bubble: { color: "", alpha: 0.66 },
	input: { color: "", alpha: 0.66 },
	menu: { color: "", alpha: 0.72 },
	selector: { color: "", alpha: 0.66 },
	sidebar: { color: "", alpha: 0.52 },
	sidebarActive: { color: "", alpha: 0.6 },
	highlight: { color: "", alpha: 1 },
});
let hostValue = null; // includes themeCustom once "ready"
let hostUser = null;
let hostStatus = "loading";
const scopeListeners = [];
const fakeScope = {
	getSnapshot() {
		return {
			status: hostStatus,
			value: hostValue,
			user: hostUser,
			writable: true,
			mode: "host",
			revision: 1,
		};
	},
	subscribe(fn) {
		scopeListeners.push(fn);
		return () => {};
	},
	set(field, value) {
		hostUser = hostUser ?? {};
		hostUser[field] = value;
		hostValue = {
			image: hostUser.image ?? "",
			overlay: hostUser.overlay ?? 0.55,
			enabled: hostUser.enabled !== false,
			themeEnabled: hostUser.themeEnabled !== false,
			themePalette: Array.isArray(hostUser.themePalette) ? hostUser.themePalette : [],
			themeFont: hostUser.themeFont ?? "",
			themeCustom: hostUser.themeCustom ?? defaultCustom(),
			dialogWidth: hostUser.dialogWidth ?? 0,
			dialogHeight: hostUser.dialogHeight ?? 0,
		};
		hostStatus = "ready";
		for (const fn of scopeListeners) fn();
		return Promise.resolve();
	},
	unset(field) {
		if (hostUser) delete hostUser[field];
		hostValue = {
			image: (hostUser && hostUser.image) ?? "",
			overlay: (hostUser && hostUser.overlay) ?? 0.55,
			enabled: (hostUser && hostUser.enabled) !== false,
			themeEnabled: (hostUser && hostUser.themeEnabled) !== false,
			themePalette: hostUser && Array.isArray(hostUser.themePalette) ? hostUser.themePalette : [],
			themeFont: (hostUser && hostUser.themeFont) ?? "",
			themeCustom: hostUser && hostUser.themeCustom ? hostUser.themeCustom : defaultCustom(),
			dialogWidth: (hostUser && hostUser.dialogWidth) ?? 0,
			dialogHeight: (hostUser && hostUser.dialogHeight) ?? 0,
		};
		for (const fn of scopeListeners) fn();
		return Promise.resolve();
	},
};

// ── Fake cordis ctx ─────────────────────────────────────────────────────
const registered = [];
const themeLayers = [];
const fakeTheme = {
	overrideTokens(source, tokens) {
		if (source !== "auto-theme") throw new Error("wrong theme override source: " + source);
		if (!tokens || typeof tokens !== "object") throw new Error("theme tokens missing");
		for (const [name, pair] of Object.entries(tokens)) {
			if (!name.startsWith("--dsw-")) throw new Error("unexpected theme token: " + name);
			if (!pair || typeof pair.light !== "string" || typeof pair.dark !== "string") {
				throw new Error("theme token must be a light/dark pair: " + name);
			}
		}
		themeLayers.push(tokens);
		return () => {
			const index = themeLayers.indexOf(tokens);
			if (index >= 0) themeLayers.splice(index, 1);
		};
	},
	getTheme() {
		return { preference: "system", active: { colorScheme: "dark", tokens: {} }, revision: 1 };
	},
};
const fakeCtx = {
	theme: fakeTheme,
	// DSH ≥ 0.1.7 settings service: configForms.get(entryId) returns a form with
	// the same getSnapshot/subscribe/set/unset shape as the retired settingsScope.
	configForms: { get(entryId) {
		if (entryId !== "dsh-web-background") throw new Error("wrong settings entry id: " + entryId);
		return fakeScope;
	} },
	effect(cb) {
		return cb();
	},
	locale: {
		register(ns, dicts) {
			if (ns !== "settings.background") throw new Error("wrong locale ns");
			if (JSON.stringify(Object.keys(dicts.zh)) !== JSON.stringify(Object.keys(dicts.en))) {
				throw new Error("zh/en key sets differ");
			}
			return () => {};
		},
	},
	slots: {
		inject(_name, cb) {
			return cb();
		},
		register(opts, Component) {
			registered.push({ opts, Component });
			return () => {};
		},
	},
};

// ── Drive apply ─────────────────────────────────────────────────────────
// The service inject list must target live DSH ≥ 0.1.7 services: the removed
// settingsScope service held the web boot pending forever on desktop.
if (!Array.isArray(plugin.inject)) throw new Error("client inject list missing");
if (plugin.inject.includes("settingsScope")) throw new Error("inject still targets the removed settingsScope service");
for (const svc of ["slots", "locale", "configForms", "theme"]) {
	if (!plugin.inject.includes(svc)) throw new Error("inject missing live service: " + svc);
}
plugin.apply(fakeCtx);
if (registered.length !== 1) throw new Error("expected one combined appearance registration, got " + registered.length);
const reg = registered[0];
const opts = reg.opts;
const Component = reg.Component;
if (opts.name !== "settings.general.item") throw new Error("wrong slot name");
if (opts.id !== "appearance-custom") throw new Error("combined row id should be appearance-custom");
if (opts.order !== 11) throw new Error("wrong combined appearance row order: " + opts.order);
const injected = opts.inject();
if (!injected.store) throw new Error("inject face missing store");

const store = injected.store;
let snap = store.getSnapshot();
if (snap.overlay !== 0.55 || snap.enabled !== true) throw new Error("default state wrong");
if (snap.dialogWidth !== 0 || snap.dialogHeight !== 0) {
	throw new Error("default dialog size should be 0/0 (natural modal size)");
}
if (snap.themeEnabled !== true || snap.themePalette.length !== 0 || snap.themeFont !== "") {
	throw new Error("default theme state wrong");
}
if (!snap.themeCustom || snap.themeCustom.sidebar.alpha !== 0.52) {
	throw new Error("default themeCustom state wrong: " + JSON.stringify(snap.themeCustom));
}
if (themeLayers.length !== 0) throw new Error("theme layer should stay absent for the default state");

// offline auto-theme algorithm probes (no browser canvas needed)
// 16x16 fake image: gray-green border occupies 75% of the pixels, coral
// subject occupies the central 40% — subject detection must still win.
const palette = plugin.__test.extractPaletteFromImage({ naturalWidth: 16, naturalHeight: 16 });
if (palette.length < 3) throw new Error("palette extraction failed: " + JSON.stringify(palette));
if (palette[0] !== "#eb4024") {
	throw new Error("subject color was not promoted to palette[0]: " + JSON.stringify(palette));
}
const testProfile = plugin.__test.deriveThemeProfile(palette, "");
if (!testProfile.fontId || !testProfile.fontStack.includes("PingFang SC")) {
	throw new Error("font derivation failed");
}
const brandDark = testProfile.accentDark;
if (!(brandDark.h >= 5 && brandDark.h <= 20)) {
	throw new Error("highlight hue drifted away from the coral subject: " + brandDark.h);
}
const testTokens = plugin.__test.buildThemeTokens(testProfile);
if (!testTokens["--dsw-alias-brand-primary"].dark.includes("hsl(")) {
	throw new Error("color token projection failed");
}
if (Object.keys(testTokens).length < 40) throw new Error("theme token coverage too small");
// Dialog, code-block, sidebar and expanded-sidebar surfaces must carry a
// clearly visible tint of the subject color (not remain near-black boxes).
for (const name of [
	"--dsw-alias-bg-overlay",
	"--dsw-alias-bg-layer-2",
	"--dsw-alias-markdown-code-block",
	"--dsw-specific-sidebar-fill",
	"--dsw-specific-sidebar-nav-item-active",
]) {
	const dark = testTokens[name].dark;
	if (!/^hsla?\(/.test(dark) || !dark.includes(", 38.0%")) {
		throw new Error(name + " is not subject-tinted: " + dark);
	}
}
if (!String(store.getSnapshot().image).length) {
	// image empty means default — fine
}

// default paint
const bgTag = created.find((el) => el.dataset.pluginCss === "dsh-web-background/inject");
if (!bgTag || !bgTag.textContent.includes("data:image/jpeg;base64")) {
	throw new Error("background tag not painted with default photo");
}

// render the single combined row closed (background + theme editors live
// inside one modal, so assert the source is wired even though SSR keeps the
// modal closed here)
if (!source.includes("sectionAutoTheme") || !source.includes("dwb-themeSection")) {
	throw new Error("background theme editor markup missing from bundle");
}
if (!source.includes("dwb-resizeHandle") || !source.includes("dwb-dialog")) {
	throw new Error("dialog resize handle/class missing from bundle");
}
// all-expanded dialog must stay inside the viewport: section bodies scroll
if (!source.includes("max-height:max(180px, calc(100vh - 300px))!important")) {
	throw new Error("accordion body overflow guard missing from bundle");
}
if (!source.includes("dwb-surfaceList") || !source.includes("sectionCustomTheme")) {
	throw new Error("custom surface editor markup missing from bundle");
}
// the dead single-purpose row was removed; the combined modal hosts everything
if (source.includes("CustomThemeRow")) {
	throw new Error("dead CustomThemeRow component should be removed from the bundle");
}
// resolved-auto-color preview plumbing (swatch + picker default) must ship
if (!source.includes("cssColorToHex") || !source.includes("dwb-swatch")) {
	throw new Error("auto color preview helpers missing from bundle");
}
const hexProbe = plugin.__test.cssColorToHex;
if (typeof hexProbe !== "function") throw new Error("cssColorToHex test hatch missing");
if (hexProbe("#abc") !== "#aabbcc") throw new Error("cssColorToHex #rgb failed: " + hexProbe("#abc"));
if (hexProbe("rgba(18, 52, 86, 0.4)") !== "#123456") {
	throw new Error("cssColorToHex rgba failed: " + hexProbe("rgba(18, 52, 86, 0.4)"));
}
const hslHex = hexProbe("hsl(222.0, 30.0%, 47.0%)");
const hslaHex = hexProbe("hsla(222.0, 30.0%, 47.0%, 0.66)");
if (!hslHex || hslHex !== hslaHex) {
	throw new Error("cssColorToHex hsl/hsla mismatch: " + hslHex + " vs " + hslaHex);
}
if (hexProbe("var(--dsw-alias-bg-base)") !== "") {
	throw new Error("cssColorToHex should reject non-color values");
}
const scaleProbe = plugin.__test.scaleTokenAlpha;
if (typeof scaleProbe !== "function") throw new Error("scaleTokenAlpha test hatch missing");
if (scaleProbe("hsl(222.0, 50.0%, 35.0%)", 0.5) !== "hsla(222.0, 50.0%, 35.0%, 0.5)") {
	throw new Error("scaleTokenAlpha solid hsl failed: " + scaleProbe("hsl(222.0, 50.0%, 35.0%)", 0.5));
}
if (scaleProbe("rgba(255, 85, 51, 0.28)", 0.5) !== "rgba(255, 85, 51, 0.14)") {
	throw new Error("scaleTokenAlpha rgba failed: " + scaleProbe("rgba(255, 85, 51, 0.28)", 0.5));
}
if (scaleProbe("#ffffff", 0.25) !== "rgba(255, 255, 255, 0.25)") {
	throw new Error("scaleTokenAlpha hex failed: " + scaleProbe("#ffffff", 0.25));
}
if (scaleProbe("hsla(10.0, 38.0%, 40.0%, 0.52)", 2) !== "hsla(10.0, 38.0%, 40.0%, 1)") {
	throw new Error("scaleTokenAlpha should clamp the scaled alpha to 1");
}
const t = (key) => key;
const html = renderToString(React.createElement(Component, { t, store }));
for (const probe of ["title", "clickToCustomize", "dwb-preview", "defaultLabel"]) {
	if (!html.includes(probe)) throw new Error("row html missing: " + probe);
}

// simulate customization
store.setImage("https://example.com/bg.jpg");
store.setOverlay(0.3);
snap = store.getSnapshot();
if (snap.image !== "https://example.com/bg.jpg") throw new Error("setImage failed");
if (Math.abs(snap.overlay - 0.3) > 1e-9) throw new Error("setOverlay failed");
if (!bgTag.textContent.includes("https://example.com/bg.jpg")) {
	throw new Error("paint not updated after setImage");
}
if (!bgTag.textContent.includes("rgba(7,12,26,0.3)")) {
	throw new Error("paint not updated after setOverlay");
}

store.setEnabled(false);
if (!(bgTag.textContent === "")) throw new Error("disable should clear the style tag");
store.setEnabled(true);

// auto-theme layer lifecycle
store.setThemeProfile(["#ff5533", "#1b2a41", "#f4efe6"], "tech");
snap = store.getSnapshot();
if (snap.themePalette.length !== 3 || snap.themeFont !== "tech") throw new Error("setThemeProfile failed");
if (themeLayers.length !== 1) throw new Error("theme override layer was not applied");
const tokens = themeLayers[0];
for (const name of ["--dsw-alias-bg-base", "--dsw-alias-brand-primary", "--dsw-alias-label-primary", "--dsw-specific-sidebar-fill", "--dsw-font-family", "--dsw-font-base-16"]) {
	if (!tokens[name]) throw new Error("theme tokens missing: " + name);
}
if (!tokens["--dsw-font-family"].light.includes("PingFang SC")) throw new Error("font stack lost CJK fallback");

// With a palette present, re-render the row WITH THE MODAL OPEN: every
// surface row must show a resolved auto-color swatch and the picker must
// default to that auto color (never the misleading #000000). The component
// renders without a getScheme prop here, so the dark fallback path runs.
// Force every boolean state (openModal/busy/…) to true so SSR walks the
// open-modal tree.
const realUseState = React.useState;
React.useState = function forceOpenModal(initial) {
	return realUseState.call(React, typeof initial === "boolean" ? true : initial);
};
const themedHtml = renderToString(React.createElement(Component, { t, store }));
if (!themedHtml.includes("dwb-swatch")) throw new Error("surface rows lost their preview swatch");
const themedProfile = plugin.__test.deriveThemeProfile(snap.themePalette, snap.themeFont);
const themedAuto = plugin.__test.buildThemeTokens(themedProfile);
const sidebarAutoHex = plugin.__test.cssColorToHex(themedAuto["--dsw-specific-sidebar-fill"].dark);
if (!sidebarAutoHex) throw new Error("sidebar auto color did not resolve to hex");
if (!themedHtml.includes('value="' + sidebarAutoHex + '"')) {
	throw new Error("color picker does not default to the auto color: " + sidebarAutoHex);
}
if (themedHtml.includes('value="#000000"')) {
	throw new Error("color picker fell back to misleading black");
}
if ((themedHtml.match(/dwb-autoBadge/g) || []).length !== 11) {
	throw new Error("every untouched surface row should carry the auto badge");
}
// untouched rows: alpha slider stays enabled (opacity also rescales auto
// colors now, so there is no dead control)
if ((themedHtml.match(/dwb-alphaSlider/g) || []).length !== 11) {
	throw new Error("expected 11 alpha sliders");
}
if (/dwb-alphaSlider[^>]*disabled/.test(themedHtml)) {
	throw new Error("alpha sliders should stay enabled in auto mode");
}
// untouched rows: no per-row reset button, no reset-all button
if (themedHtml.includes("customThemeResetSurface")) {
	throw new Error("reset-to-auto button should hide on untouched rows");
}
if (themedHtml.includes("customThemeResetAll")) {
	throw new Error("reset-all button should hide when nothing is customized");
}
// font row now offers an explicit Auto choice, active when themeFont is set…
if (!themedHtml.includes("themeFontAuto")) throw new Error("font auto option missing");
// …and after a manual surface override the row shows custom UI instead.
store.setThemeSurface("sidebar", { color: "#123456", alpha: 0.4 });
const editedHtml = renderToString(React.createElement(Component, { t, store }));
if (!editedHtml.includes("customThemeResetSurface")) {
	throw new Error("customized row should offer reset-to-auto");
}
if (!editedHtml.includes("customThemeResetAll")) {
	throw new Error("reset-all should appear once something is customized");
}
if ((editedHtml.match(/dwb-autoBadge/g) || []).length !== 10) {
	throw new Error("customized row should drop the auto badge");
}
React.useState = realUseState;
store.setThemeSurface("sidebar", { color: "", alpha: 0.52 });
// User-authored surface overrides: exact color + exact alpha, both modes.
store.setThemeSurface("sidebar", { color: "#123456", alpha: 0.4 });
if (themeLayers.length !== 1) throw new Error("surface override should rebuild the layer");
const customTokens = themeLayers[0];
if (customTokens["--dsw-specific-sidebar-fill"].dark !== "rgba(18, 52, 86, 0.4)") {
	throw new Error("custom sidebar color not applied verbatim: " + customTokens["--dsw-specific-sidebar-fill"].dark);
}
if (customTokens["--dsw-specific-sidebar-fill"].light !== "rgba(18, 52, 86, 0.4)") {
	throw new Error("custom sidebar color must apply to both modes");
}
store.setThemeSurface("sidebar", { color: "", alpha: 0.52 });
if (themeLayers.length !== 1) throw new Error("reset-to-auto surface should rebuild the layer");
if (!themeLayers[0]["--dsw-specific-sidebar-fill"].dark.includes("hsla(")) {
	throw new Error("reset-to-auto surface did not restore automatic tint");
}

// Alpha-only override (no color): the auto tint's baked alpha rescales
// relative to the surface default, per token, preserving group hierarchy.
store.setThemeSurface("sidebar", { alpha: 0.26 });
const alphaTokens = themeLayers[0];
if (alphaTokens["--dsw-specific-sidebar-fill"].dark !== "hsla(10.0, 38.0%, 40.0%, 0.26)") {
	throw new Error("alpha-only override did not rescale the sidebar tint: " + alphaTokens["--dsw-specific-sidebar-fill"].dark);
}
if (!alphaTokens["--dsw-specific-sidebar-fill"].light.includes(", 0.26)")) {
	throw new Error("alpha-only override should also apply to the light scheme: " + alphaTokens["--dsw-specific-sidebar-fill"].light);
}
store.setThemeSurface("sidebarActive", { alpha: 0.3 });
const scaledTokens = themeLayers[0];
if (!scaledTokens["--dsw-specific-sidebar-nav-item-active"].dark.includes(", 0.3)")) {
	throw new Error("active item alpha should scale to 0.3: " + scaledTokens["--dsw-specific-sidebar-nav-item-active"].dark);
}
if (!scaledTokens["--dsw-specific-sidebar-nav-item-active-accent"].dark.includes(", 0.14)")) {
	throw new Error("accent alpha should keep hierarchy (0.28 → 0.14): " + scaledTokens["--dsw-specific-sidebar-nav-item-active-accent"].dark);
}
if (!scaledTokens["--dsw-specific-sidebar-nav-item-hover"].dark.includes(", 0.08)")) {
	throw new Error("hover alpha should keep hierarchy (0.16 → 0.08): " + scaledTokens["--dsw-specific-sidebar-nav-item-hover"].dark);
}
store.clearThemeCustom();
const restoredTokens = themeLayers[0];
if (restoredTokens["--dsw-specific-sidebar-fill"].dark !== "hsla(10.0, 38.0%, 40.0%, 0.52)") {
	throw new Error("clearing overrides should restore the baked sidebar alpha: " + restoredTokens["--dsw-specific-sidebar-fill"].dark);
}
store.clearThemeCustom();
snap = store.getSnapshot();
if (snap.themeCustom.sidebar.color !== "" || snap.themeCustom.sidebar.alpha !== 0.52) {
	throw new Error("clearThemeCustom failed");
}
store.setThemeEnabled(false);
if (themeLayers.length !== 0) throw new Error("disabling theme should release the override layer");
store.setThemeEnabled(true);
if (themeLayers.length !== 1) throw new Error("re-enabling theme should restore the override layer");
store.clearTheme();
snap = store.getSnapshot();
if (snap.themePalette.length !== 0 || snap.themeFont !== "") throw new Error("clearTheme failed");
if (themeLayers.length !== 0) throw new Error("clearTheme should release the override layer");

store.reset();
snap = store.getSnapshot();
if (
	snap.image !== "" ||
	snap.overlay !== 0.55 ||
	snap.enabled !== true ||
	snap.themeEnabled !== true ||
	snap.themePalette.length !== 0 ||
	snap.themeFont !== "" ||
	snap.themeCustom.sidebar.color !== "" ||
	snap.themeCustom.sidebar.alpha !== 0.52
) {
	throw new Error("reset failed: " + JSON.stringify(snap));
}

// dialog resize: size persists through the store; reset restores natural size
store.setDialogSize(640, 480);
snap = store.getSnapshot();
if (snap.dialogWidth !== 640 || snap.dialogHeight !== 480) {
	throw new Error("setDialogSize failed: " + JSON.stringify(snap));
}
store.setDialogSize(0, 0);
snap = store.getSnapshot();
if (snap.dialogWidth !== 0 || snap.dialogHeight !== 0) {
	throw new Error("dialog size reset to natural failed");
}

// host-ready path with existing user override must NOT be clobbered by migration
store.setImage("https://example.com/keep.jpg");
const migrated = store.getSnapshot();
if (migrated.image !== "https://example.com/keep.jpg") throw new Error("host write lost");

// ── Node half (DSH ≥ 0.1.7): volatile Config drives the settings mirror ──
const nodeHalf = await import(join(root, "lib", "index.js"));
if (typeof nodeHalf.apply !== "function") throw new Error("node half has no apply");
if (!nodeHalf.Config || typeof nodeHalf.Config.toJSON !== "function") {
	throw new Error("node half must export a schemastery Config");
}
const configDict = nodeHalf.Config.dict ?? {};
const EXPECTED_FIELDS = ["image", "overlay", "enabled", "themeEnabled", "themePalette", "themeFont", "themeCustom", "dialogWidth", "dialogHeight"];
for (const field of EXPECTED_FIELDS) {
	const schema = configDict[field];
	if (!schema) throw new Error("Config missing field: " + field);
	if (schema.meta?.volatile !== true) throw new Error("Config field is not volatile: " + field);
}
// apply must only register the no-auto-page presentation policy
{
	const calls = [];
	const childCtx = {
		effect(cb) { return cb(); },
		settings: { configure(policy, owner) { calls.push({ policy, owner }); return () => {}; } },
	};
	const fakeFiber = { id: "fiber-1" };
	nodeHalf.apply({
		inject(services, cb) {
			if (JSON.stringify(services) !== JSON.stringify(["settings"])) throw new Error("node half injects wrong services: " + services);
			return cb(childCtx);
		},
		fiber: fakeFiber,
	});
	if (calls.length !== 1) throw new Error("expected one settings.configure call, got " + calls.length);
	if (calls[0].policy.auto !== false) throw new Error("auto settings page should be disabled");
	if (calls[0].owner !== fakeFiber) throw new Error("presentation policy must be owned by the plugin fiber");
}

console.log("smoke test passed");
console.log("row html length:", html.length);
console.log("bg tag length:", bgTag.textContent.length);
