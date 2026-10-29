'use strict';

// Picks the window title bar colour from the theme the page reports (see src/preload.js), so the bar
// matches the app beneath it: black in dark mode, white in light mode. No Electron imports, so it is
// unit-tested in test/title-bar.test.js.

const { BACKGROUND } = require('./config');

// On Mac the window hides macOS's own title bar, which is grey whatever theme XUNA shows, and keeps its
// three buttons over a strip in XUNA's black or white (src/title-strip.html), with the XUNA page below.
// The strip is 40px, a little taller than macOS's own 28px bar, so its 28px-tall tabs and buttons (Ask
// AI among them) sit in it with room round them. The three buttons move down to its middle, level with
// them: macOS draws each in a 16px-tall frame, from this top-left corner.
const MAC_TITLE_STRIP_HEIGHT = 40;
const MAC_TRAFFIC_LIGHTS = { x: 14, y: 12 };

// report: { colorScheme: the page's computed CSS color-scheme, prefersDark: the system is in dark mode }
function titleBarColor(report) {
  const tokens = typeof report?.colorScheme === 'string' ? report.colorScheme.trim().split(/\s+/) : [];
  const dark = tokens.includes('dark');
  const light = tokens.includes('light');
  if (dark !== light) return dark ? BACKGROUND.dark : BACKGROUND.light;
  return report?.prefersDark === true ? BACKGROUND.dark : BACKGROUND.light;
}

// Where the XUNA pages go in a Mac window with this content size: below the strip, or the whole window
// in full screen, where macOS shows the buttons over the page only while the pointer is at the top.
// With more than one workspace tab open the strip stays in full screen, so the tabs can still be switched.
function macAppViewBounds({ width, height, fullScreen, tabCount = 1 }) {
  const top = fullScreen && tabCount < 2 ? 0 : MAC_TITLE_STRIP_HEIGHT;
  return { x: 0, y: top, width: Math.max(0, width), height: Math.max(0, height - top) };
}

// In one row, the window has no strip above the page: the XUNA page fills it, and its own header is
// the title bar. The strip's view covers only the bar's left end, which holds the three buttons, Back
// and Forward, the tabs and +, and XUNA's header moves over to make room (src/one-row.css), keeping at
// least this much of itself empty to drag the window by. The three buttons sit in the middle of the
// header, this far from the window's edge.
const ONE_ROW_MIN_DRAG = 64;
const ONE_ROW_TRAFFIC_LIGHTS_X = 20;
const TRAFFIC_LIGHT_HEIGHT = 16; // the frame macOS draws each button in

const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const CSS_COLOR = /^[#a-z0-9\s(),.%-]{1,120}$/i;
const isColor = (value) => typeof value === 'string' && CSS_COLOR.test(value) && !/url\(/i.test(value);
const BACKDROP_FILTER = /^(?:(?:blur|saturate|brightness|contrast)\(\s*[\d.]+(?:px|%)?\s*\)\s*)+$/;

// What a tab's page says about XUNA's header (see watchHeader in src/preload.js), or null when it isn't
// plausible: its height and the room its contents need, in the page's CSS pixels; the page's own width
// in them, which gives its zoom; its colours; and how anything covering it looks, such as the blurred
// backdrop behind a XUNA dialog. Colours and filters that aren't plain CSS are dropped.
function headerReport(report) {
  if (!within(report?.height, 40, 80) || !within(report.minWidth, 0, 4000) || !within(report.innerWidth, 200, 10000)) return null;
  const cover = report.cover && typeof report.cover === 'object'
    ? {
        filter: typeof report.cover.filter === 'string' && BACKDROP_FILTER.test(report.cover.filter) ? report.cover.filter : null,
        tint: isColor(report.cover.tint) ? report.cover.tint : null,
      }
    : null;
  return {
    height: report.height,
    minWidth: report.minWidth,
    innerWidth: report.innerWidth,
    background: isColor(report.background) ? report.background : null,
    border: isColor(report.border) ? report.border : null,
    cover,
  };
}

// The strip's measure of the bar's left end in one row (see src/title-strip-layout.js): its width with
// the tabs at their full width, and with them as narrow as they go. Null until it makes sense.
function clusterReport(widths) {
  const { natural, minimum } = widths ?? {};
  return within(minimum, 1, 5000) && within(natural, minimum, 5000) ? { natural, minimum } : null;
}

// Where everything goes in a Mac window with this content size. header: the tab in front's XUNA header
// (headerReport), or null; cluster: the strip's measure (clusterReport), or null until it has measured
// itself. One row needs both, and room beside XUNA's header for the tabs at their narrowest; otherwise,
// and in full screen, the strip sits above the page as before. inset is the room made in XUNA's header,
// in its CSS pixels; barBottom is where the bar ends, which the + panel opens below.
function macWindowLayout({ width, height, fullScreen, tabCount = 1, header = null, cluster = null, oneRow = true }) {
  if (oneRow && !fullScreen && header && cluster) {
    const zoom = width / header.innerWidth;
    const available = width - Math.ceil(header.minWidth * zoom) - ONE_ROW_MIN_DRAG;
    if (cluster.minimum <= available) {
      const barHeight = Math.round(header.height * zoom);
      const stripWidth = Math.round(Math.min(cluster.natural, available));
      return {
        mode: 'one-row',
        page: { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) },
        strip: { x: 0, y: 0, width: stripWidth, height: barHeight },
        trafficLights: { x: ONE_ROW_TRAFFIC_LIGHTS_X, y: Math.round((barHeight - TRAFFIC_LIGHT_HEIGHT) / 2) },
        inset: Math.round((stripWidth / zoom) * 100) / 100,
        barHeight,
        barBottom: barHeight,
      };
    }
  }
  const page = macAppViewBounds({ width, height, fullScreen, tabCount });
  return {
    mode: 'strip',
    page,
    strip: page.y > 0 ? { x: 0, y: 0, width: Math.max(0, width), height: MAC_TITLE_STRIP_HEIGHT } : null,
    trafficLights: { ...MAC_TRAFFIC_LIGHTS },
    inset: 0,
    barHeight: MAC_TITLE_STRIP_HEIGHT,
    barBottom: page.y,
  };
}

// The + button's panel of workspaces (src/workspace-picker-panel.html), as wide as XUNA's own picker.
// Its view keeps a transparent margin round the panel for the panel's shadow, and it sits 8px below the
// button, as XUNA's popovers sit below the control that opens them.
const PICKER_PANEL_WIDTH = 384;
const PANEL_MARGIN = { side: 12, top: 4, bottom: 16 };
const PANEL_GAP = 8;

// Where the panel's view goes in a window with this content size: under the + button (anchor: its
// rectangle in the strip), right edges in line, kept inside the window. panelHeight: what the panel's
// page measured itself at. barBottom: where the bar ends. The view never reaches into the bar, whose
// empty space drags the window wherever it lies under another view, the panel's top included.
function pickerPanelBounds({ anchor, width, height, panelHeight, barBottom = 0 }) {
  const viewWidth = Math.min(PICKER_PANEL_WIDTH + 2 * PANEL_MARGIN.side, width);
  const right = anchor.x + anchor.width + PANEL_MARGIN.side;
  const x = Math.max(0, Math.min(right - viewWidth, width - viewWidth));
  const y = Math.max(anchor.y + anchor.height + PANEL_GAP - PANEL_MARGIN.top, barBottom);
  const wanted = panelHeight + PANEL_MARGIN.top + PANEL_MARGIN.bottom;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(viewWidth), height: Math.round(Math.max(0, Math.min(wanted, height - y))) };
}

// What the tab in front's page says about XUNA's own Ask AI button (see src/preload.js), as the strip's
// Ask AI shows it: whether there is one to press, whether the assistant is open, and the orb's four
// colours, which follow the workspace's branding. Colours that aren't plain CSS colours are dropped,
// and the strip uses XUNA's own.
function askAiState(report) {
  const colors = Array.isArray(report?.colors) && report.colors.length === 4 && report.colors.every(isColor);
  return { available: report?.available === true, open: report?.open === true, colors: colors ? [...report.colors] : null };
}

module.exports = {
  MAC_TITLE_STRIP_HEIGHT,
  MAC_TRAFFIC_LIGHTS,
  ONE_ROW_MIN_DRAG,
  titleBarColor,
  macAppViewBounds,
  macWindowLayout,
  headerReport,
  clusterReport,
  PICKER_PANEL_WIDTH,
  pickerPanelBounds,
  askAiState,
};
