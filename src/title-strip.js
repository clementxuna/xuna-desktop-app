'use strict';

// Draws the workspace tab buttons at the right end of the Mac title strip (src/title-strip.html) from
// what the main process sends (see addWorkspaceTabs in src/main.js), and passes their clicks back
// through src/title-strip-preload.js. With one tab open only the + button shows. Double-clicking a tab
// renames it.

const bridge = window.workspaceTabs;
const list = document.querySelector('.tabs');
const addButton = document.querySelector('.add');
let current = { tabs: [], canAdd: false, dark: false };
let renaming = null; // the tab whose name is being typed; it is redrawn once that ends

bridge.onChange((state) => {
  current = state;
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  if (!renaming) render();
});
bridge.onRename(startRename);
addButton.addEventListener('click', () => bridge.add());

function render() {
  addButton.hidden = !current.canAdd;
  list.replaceChildren(...(current.tabs.length > 1 ? current.tabs.map(tabButtons) : []));
}

function tabButtons(tab) {
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
  select.addEventListener('click', () => bridge.select(tab.id));
  select.addEventListener('dblclick', () => startRename(tab.id));

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.title = `Close ${tab.label}`;
  close.ariaLabel = `Close ${tab.label}`;
  close.append(crossIcon());
  close.addEventListener('click', () => bridge.close(tab.id));

  item.append(select, close);
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

// Swaps the tab's name for a text field. Enter or clicking away keeps what was typed (an empty name
// brings back "Workspace N"); Escape keeps the old name.
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
