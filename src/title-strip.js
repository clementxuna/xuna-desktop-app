'use strict';

// Draws the Mac title strip (src/title-strip.html) from what the main process sends (see
// addWorkspaceTabs in src/main.js), and passes its clicks back through src/title-strip-preload.js: XUNA's
// logo, which goes home in the tab in front, Back and Forward, the workspace tabs, the + button and, in
// the strip, Ask AI. Signed in, you are always in a workspace, so its tab shows, alone too (shownTabs),
// without its × then, as the last tab can't close. + opens a menu of the account's workspaces, below it. Clicking a
// tab shows it, double-clicking renames it, right-clicking opens its menu and dragging moves it. Ask AI
// presses XUNA's own in the tab in front, and is drawn as XUNA draws it.

const bridge = window.workspaceTabs;
const layout = window.titleStripLayout;
const root = document.documentElement;
const list = document.querySelector('.tabs');
const homeButton = document.querySelector('.home');
const history = document.querySelector('.history');
const backButton = document.querySelector('.back');
const forwardButton = document.querySelector('.forward');
const addButton = document.querySelector('.add');
const askButton = document.querySelector('.ask-ai');
const orb = document.querySelector('.orb');
const measurer = document.querySelector('.measure');
let current = {
  tabs: [],
  dark: false,
  askAi: { available: false, open: false, colors: null },
  bar: { mode: 'strip', lights: true },
  history: { back: false, forward: false },
};
let renaming = null; // the tab whose name is being typed; it is redrawn once that ends
let dragging = null; // the tab being dragged along the strip; the tabs are redrawn once it is let go
let clicksIgnoredUntil = 0; // the click that ends a drag doesn't also show the tab
let measured = '';
// The bar's measure waits for what it is made of: the tabs, which the main process sends, and XUNA's type,
// Inter, whose arrival changes their widths. Until then the main process keeps the measure it has, the one
// the window opened with, so the bar keeps its size while the window opens.
let told = false; // the main process has said what to draw
let typeArrived = false; // Inter has loaded, or isn't coming: offline, or not within FONT_WAIT_MS
const FONT_WAIT_MS = 3000;

bridge.onChange((state) => {
  current = state;
  told = true;
  root.dataset.theme = state.dark ? 'dark' : 'light';
  showBar(state.bar);
  showHistory(state.history, state.bar);
  showAskAi(state.askAi);
  if (!renaming && !dragging) render();
  root.dataset.ready = '';
  measure();
});
bridge.onRename(startRename);
bridge.onPick(pick); // ⌘T
addButton.addEventListener('click', pick);
askButton.addEventListener('click', () => bridge.askAi());
homeButton.addEventListener('click', () => bridge.home());
backButton.addEventListener('click', () => bridge.back());
forwardButton.addEventListener('click', () => bridge.forward());
const typeLoaded = () => {
  typeArrived = true;
  measure();
};
document.fonts?.load('500 13px Inter').then(typeLoaded, typeLoaded);
setTimeout(typeLoaded, FONT_WAIT_MS);
document.fonts?.addEventListener('loadingdone', measure); // more of Inter, for a name in another script say

// bar: the mode, height and colours the main process chose (see macWindowLayout in src/title-bar.js),
// whether the window has macOS's three buttons, and how anything covering XUNA's page looks.
function showBar(bar = {}) {
  const mode = bar.mode === 'one-row' ? 'one-row' : 'strip';
  root.dataset.mode = mode;
  setVariable('--lights', `${layout.lightsZone({ lights: bar.lights !== false, mode })}px`);
  setVariable('--bar-height', Number.isFinite(bar.height) ? `${bar.height}px` : null);
  setVariable('--bar-background', bar.background);
  setVariable('--bar-border', bar.border);
  setVariable('--cover-filter', bar.cover?.filter);
  setVariable('--cover-tint', bar.cover?.tint);
  root.toggleAttribute('data-covered', Boolean(bar.cover));
}

function setVariable(name, value) {
  if (value) root.style.setProperty(name, value);
  else root.style.removeProperty(name);
}

// Back and Forward act in the tab in front, and are dimmed while there is nowhere to go.
function showHistory({ back = false, forward = false } = {}, bar = {}) {
  const mac = bar.lights !== false;
  backButton.disabled = !back;
  forwardButton.disabled = !forward;
  backButton.title = mac ? 'Back (⌘[)' : 'Back (Alt+Left)';
  forwardButton.title = mac ? 'Forward (⌘])' : 'Forward (Alt+Right)';
}

// askAi: what the tab in front says about XUNA's own Ask AI (askAiState in src/title-bar.js). Without
// one to press, as on the sign-in page, the button waits, dimmed.
function showAskAi({ available, open, colors } = {}) {
  askButton.disabled = !available;
  askButton.setAttribute('aria-pressed', String(Boolean(open)));
  askButton.title = available ? 'Ask AI' : 'Ask AI is ready once XUNA has loaded';
  ['--c1', '--c2', '--c3', '--c4'].forEach((name, index) => {
    if (colors) orb.style.setProperty(name, colors[index]);
    else orb.style.removeProperty(name);
  });
}

// The main process pops the menu up at the + button, so it is told where the button is.
function pick() {
  const { x, y, width, height } = addButton.getBoundingClientRect();
  bridge.add({ x, y, width, height });
}

// The bar's left end in one row, at full width and at its narrowest (clusterWidths), by which the main
// process chooses between one row and the strip. It is measured the same way in either mode, so the
// choice never changes what it was made on.
function measure() {
  if (!told || !typeArrived) return;
  const tabNaturals = [...measurer.children].map((item) => item.getBoundingClientRect().width);
  const widths = layout.clusterWidths({
    lights: current.bar?.lights !== false,
    logo: homeButton.getBoundingClientRect().width,
    history: history.getBoundingClientRect().width,
    add: addButton.getBoundingClientRect().width,
    tabNaturals,
  });
  const serialized = JSON.stringify(widths);
  if (serialized === measured) return;
  measured = serialized;
  bridge.measure(widths);
}

function render() {
  const shown = layout.shownTabs(current.tabs);
  list.replaceChildren(...shown.map((tab) => tabButtons(tab, true)));
  measurer.replaceChildren(...shown.map((tab) => tabButtons(tab, false)));
}

// A tab's buttons: its name, which shows it, and its close button. live: false for the measurer's copy.
function tabButtons(tab, live) {
  const item = document.createElement('div');
  item.className = tab.active ? 'tab active' : 'tab';
  item.dataset.id = tab.id;

  const select = document.createElement('button');
  select.className = 'select';
  select.type = 'button';
  select.role = 'tab';
  select.ariaSelected = String(tab.active);
  select.title = tab.label;
  select.textContent = tab.label;

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.title = `Close ${tab.label}`;
  close.ariaLabel = `Close ${tab.label}`;
  close.append(crossIcon());

  item.append(select, close);
  if (!live) return item;
  select.addEventListener('click', () => {
    if (Date.now() >= clicksIgnoredUntil) bridge.select(tab.id);
  });
  select.addEventListener('dblclick', () => startRename(tab.id));
  select.addEventListener('pointerdown', (event) => startDrag(event, tab.id, item));
  close.addEventListener('click', () => bridge.close(tab.id));
  item.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    bridge.tabMenu(tab.id);
  });
  return item;
}

function crossIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M1 1l6 6M7 1L1 7');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

// Dragging a tab along the strip: it follows the pointer, the tabs it passes move aside, and where it is
// let go it moves to (see moveTab in src/workspace-tabs.js). A press that barely moves is a click. The
// pointer isn't captured, since a captured press sends its click to the tab instead of its name, which
// then never shows the tab; the page follows the press instead, for as long as the button is down.
function startDrag(event, id, item) {
  if (event.button !== 0 || renaming || list.children.length < 2) return; // a tab on its own has nowhere to go
  const items = [...list.children];
  const centers = items.map((element) => {
    const box = element.getBoundingClientRect();
    return box.left + box.width / 2;
  });
  const from = items.indexOf(item);
  dragging = { id, item, items, from, to: from, centers, startX: event.clientX, width: item.getBoundingClientRect().width, moved: false };
  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerup', dragEnd);
  window.addEventListener('pointercancel', dragEnd);
}

function dragMove(event) {
  if (!dragging) return;
  const dx = event.clientX - dragging.startX;
  if (!dragging.moved && Math.abs(dx) < 4) return;
  dragging.moved = true;
  dragging.item.classList.add('dragging');
  dragging.item.style.transform = `translateX(${dx}px)`;
  dragging.to = layout.dropIndex({ centers: dragging.centers, from: dragging.from, x: dragging.centers[dragging.from] + dx });
  const shifts = layout.dragShifts({ count: dragging.items.length, from: dragging.from, to: dragging.to, width: dragging.width });
  dragging.items.forEach((element, index) => {
    if (element !== dragging.item) element.style.transform = shifts[index] ? `translateX(${shifts[index]}px)` : '';
  });
}

function dragEnd() {
  const ended = dragging;
  dragging = null;
  window.removeEventListener('pointermove', dragMove);
  window.removeEventListener('pointerup', dragEnd);
  window.removeEventListener('pointercancel', dragEnd);
  if (!ended?.moved) return; // a click, which the tab's name handles
  clicksIgnoredUntil = Date.now() + 100;
  if (ended.to !== ended.from) bridge.move(ended.id, ended.to); // the tabs come back in their new order
  else render();
}

// Swaps the tab's name for a text field. Enter or clicking away keeps what was typed (an empty name
// brings back the workspace's name); Escape keeps the old name.
function startRename(id) {
  const tab = current.tabs.find((entry) => entry.id === id);
  const select = [...list.querySelectorAll('.tab')].find((item) => item.dataset.id === id)?.querySelector('.select');
  if (!tab || !select || renaming) return;
  renaming = id;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = tab.label;
  input.maxLength = 32; // MAX_NAME_LENGTH in src/workspace-tabs.js
  input.spellcheck = false;
  input.ariaLabel = 'Workspace tab name';
  select.replaceWith(input);
  bridge.editing(true); // keys go to the strip while the name is typed, not to the XUNA page
  input.focus();
  input.select();

  const finish = (keep) => {
    if (renaming !== id) return;
    renaming = null;
    if (keep) bridge.rename(id, input.value); // the main process sends the tabs back, and they are redrawn
    else {
      render();
      bridge.editing(false);
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}
