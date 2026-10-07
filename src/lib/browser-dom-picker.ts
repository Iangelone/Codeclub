export type BrowserMarkerOrder = { total: number; items: { markerId: string; number: number }[] };

/** Self-contained guest-page runtime. Never interpolates page content as JavaScript. */
export function createBrowserPickerScript(cursor: string, accent: string, order: BrowserMarkerOrder, removeLabel: string) {
  return String.raw`(() => {
    const settings = ${JSON.stringify({ cursor, accent, order, removeLabel })};
    if (window.__codeclubDomPicker) { window.__codeclubDomPicker.start(settings); return true; }
    window.__codeclubStopPicker?.();
    const records = new Map();
    const groups = new Map();
    const removed = [];
    let options = settings, frame = 0, hovered = null, disposed = false;
    const host = document.createElement('div');
    host.dataset.codeclubMarkerLayer = 'true';
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:2147483647!important;pointer-events:none!important;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const markerStyle = document.createElement('style');
    markerStyle.textContent = 'button:focus-visible{outline:2px solid white;outline-offset:2px}';
    shadow.appendChild(markerStyle);
    const pickerStyle = document.createElement('style');
    pickerStyle.id = 'codeclub-picker-style';
    const palette = (color) => {
      options.accent = color;
      pickerStyle.textContent = '.codeclub-picker-active,.codeclub-picker-active *{cursor:' + (options.cursor ? 'url(' + options.cursor + ') 0 0,' : '') + 'crosshair!important}.codeclub-picker-hover{outline:2px solid ' + color + '!important;outline-offset:2px!important;background-color:color-mix(in srgb,' + color + ' 10%,transparent)!important}';
      records.forEach((record) => { record.marker.style.background = color; });
    };
    const rebuild = (element) => {
      const group = groups.get(element);
      if (!group) return;
      if (group.style === null) element.removeAttribute('style'); else element.setAttribute('style', group.style);
      if (group.textChanged) { element.replaceChildren(...group.nodes); group.textChanged = false; }
      let edited = false;
      for (const record of records.values()) {
        if (record.element !== element || !record.changes) continue;
        edited = true;
        for (const [property, change] of Object.entries(record.changes.styles)) element.style.setProperty(property, change.after, 'important');
        if (record.changes.text && record.textEditable && element.childElementCount === 0) { element.textContent = record.changes.text.after; group.textChanged = true; }
      }
      if (!edited) groups.delete(element);
    };
    const renumber = () => {
      const numbers = new Map(options.order.items.map((item) => [item.markerId, item.number]));
      let next = options.order.total + 1;
      for (const record of records.values()) {
        if (record.archived) continue;
        const number = numbers.get(record.id) || next++;
        record.marker.textContent = String(number);
        record.marker.title = options.removeLabel + ' ' + number;
        record.marker.setAttribute('aria-label', record.marker.title);
      }
    };
    const remove = (id, notify = false) => {
      const record = records.get(id);
      if (!record) return;
      records.delete(id); record.marker.remove(); rebuild(record.element);
      if (notify) removed.push(id);
      renumber();
    };
    const visibleRect = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || Number(style.opacity) === 0) return null;
      const box = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (css.visibility === 'hidden' || Number(css.opacity) === 0) return null;
        const bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { box.left = Math.max(box.left, bounds.left); box.right = Math.min(box.right, bounds.right); }
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { box.top = Math.max(box.top, bounds.top); box.bottom = Math.min(box.bottom, bounds.bottom); }
      }
      return box.right > box.left && box.bottom > box.top ? box : null;
    };
    const tick = () => {
      frame = 0;
      if (disposed) return;
      // Read page geometry before writing overlay positions; markers never affect page layout.
      const positions = [], duplicates = new Map();
      for (const record of records.values()) {
        if (!record.element.isConnected || record.pageUrl !== location.href) { remove(record.id, true); continue; }
        if (record.archived) continue;
        const rect = visibleRect(record.element);
        const duplicate = duplicates.get(record.element) || 0;
        duplicates.set(record.element, duplicate + 1);
        const columns = rect ? Math.max(1, Math.floor((rect.right - 2) / 26)) : 1;
        positions.push({ record, rect, x: rect ? Math.max(2, Math.min(innerWidth - 26, rect.right - 12 - (duplicate % columns) * 26)) : 0, y: rect ? Math.max(2, Math.min(innerHeight - 26, rect.top - 12 + Math.floor(duplicate / columns) * 26)) : 0 });
      }
      for (const { record, rect, x, y } of positions) {
        const position = rect ? x + ',' + y : 'hidden';
        record.anchor = rect ? { x, y } : null;
        if (position === record.position) continue;
        record.position = position;
        record.marker.style.display = rect ? 'grid' : 'none';
        if (rect) record.marker.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      }
      if (Array.from(records.values()).some((record) => !record.archived)) frame = requestAnimationFrame(tick);
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(tick); };
    const stop = () => {
      hovered?.classList.remove('codeclub-picker-hover'); hovered = null;
      document.documentElement.classList.remove('codeclub-picker-active'); pickerStyle.remove();
      document.removeEventListener('mouseover', over, true); document.removeEventListener('mouseout', out, true); document.removeEventListener('click', pick, true); document.removeEventListener('keydown', escape, true);
    };
    const pickable = (node) => node instanceof Element ? (node.closest('svg,button,a,input,textarea,select,[role="button"],section,article,header,main,div') || node) : null;
    const over = (event) => {
      if (event.composedPath().includes(host)) return;
      const element = pickable(event.target);
      if (hovered !== element) hovered?.classList.remove('codeclub-picker-hover');
      hovered = element; hovered?.classList.add('codeclub-picker-hover');
    };
    const out = () => { hovered?.classList.remove('codeclub-picker-hover'); hovered = null; };
    const escape = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(); window.__codeclubPickerCancelled = true; } };
    const pick = (event) => {
      if (event.composedPath().includes(host)) return;
      const element = pickable(event.target);
      if (!element || element === host) return;
      event.preventDefault(); event.stopPropagation();
      stop();
      const clean = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
      const clone = element.cloneNode(true);
      clone.querySelectorAll('script,style,iframe,canvas,[data-codeclub-marker-layer]').forEach((node) => node.remove());
      [clone, ...clone.querySelectorAll('*')].forEach((node) => Array.from(node.attributes).forEach((attribute) => { if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name); }));
      const properties = ['color', 'background-color', 'opacity', 'font-family', 'font-size', 'font-weight', 'border-radius', 'border-color', 'border-width', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
      const computed = getComputedStyle(element), path = [];
      for (let node = element; node; node = node.parentElement) {
        if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) { path.unshift('#' + CSS.escape(node.id)); break; }
        const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((sibling) => sibling.localName === node.localName) : [node];
        path.unshift(CSS.escape(node.localName) + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
      }
      const id = 'codeclub-comment-' + (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'));
      const marker = document.createElement('button');
      marker.type = 'button'; marker.tabIndex = -1; marker.dataset.codeclubMarkerId = id;
      marker.style.cssText = 'all:initial;box-sizing:border-box;position:absolute;top:0;left:0;display:none;place-items:center;width:24px;height:24px;border:2px solid white;border-radius:50%;color:#111;font:600 12px/1 Arial,sans-serif;box-shadow:0 1px 8px #0008;pointer-events:none;cursor:pointer;';
      marker.style.background = options.accent;
      marker.addEventListener('click', (click) => { click.preventDefault(); click.stopPropagation(); if (records.get(id)?.committed) remove(id, true); });
      shadow.appendChild(marker);
      const textEditable = element instanceof HTMLElement && element.children.length === 0 && !['input', 'textarea', 'select'].includes(element.localName);
      records.set(id, { id, element, marker, textEditable, pageUrl: location.href, committed: false, archived: false, changes: null, position: '', anchor: null });
      renumber(); schedule();
      window.__codeclubSelection = { title: clean(element.getAttribute('aria-label') || element.textContent || element.tagName, 100), text: clean(element.textContent, 2000), html: clone.outerHTML.slice(0, 12000), x: event.clientX, y: event.clientY, markerId: id, selector: path.join(' > '), pageUrl: location.href, tagName: element.localName, textEditable, originalText: element.textContent || '', styles: Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property)])) };
    };
    const start = (next) => {
      stop(); options = next;
      for (const record of records.values()) if (!record.committed) remove(record.id);
      window.__codeclubSelection = null; window.__codeclubPickerCancelled = false;
      palette(next.accent); renumber();
      document.documentElement.appendChild(pickerStyle); document.documentElement.classList.add('codeclub-picker-active');
      document.addEventListener('mouseover', over, true); document.addEventListener('mouseout', out, true); document.addEventListener('click', pick, true); document.addEventListener('keydown', escape, true);
    };
    window.__codeclubPreviewCommentMarker = (id, changes) => {
      const record = records.get(id);
      if (!record || !record.element.isConnected || record.pageUrl !== location.href) return false;
      if (!groups.has(record.element)) groups.set(record.element, { style: record.element.getAttribute('style'), nodes: Array.from(record.element.childNodes), textChanged: false });
      const valid = {};
      for (const [property, change] of Object.entries(changes.styles)) if (propertiesAllowed.has(property) && CSS.supports(property, change.after) && (property !== 'opacity' || (Number(change.after) >= 0 && Number(change.after) <= 1))) valid[property] = change;
      record.changes = { styles: valid, ...(changes.text && record.textEditable ? { text: changes.text } : {}) };
      rebuild(record.element); schedule(); return true;
    };
    const propertiesAllowed = new Set(['color', 'background-color', 'opacity', 'font-family', 'font-size', 'font-weight', 'border-radius', 'border-color', 'border-width', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
    window.__codeclubRollbackCommentMarker = (id) => { const record = records.get(id); if (record) { record.changes = null; rebuild(record.element); schedule(); } };
    window.__codeclubFinalizeCommentMarker = (id) => { const record = records.get(id); if (!record?.element.isConnected || record.pageUrl !== location.href) return false; record.committed = true; record.marker.tabIndex = 0; record.marker.style.pointerEvents = 'auto'; renumber(); return true; };
    window.__codeclubRemoveCommentMarker = remove;
    window.__codeclubRenumberCommentMarkers = renumber;
    window.__codeclubSetCommentMarkerOrder = (order) => {
      options.order = order;
      const ids = new Set(order.items.map((item) => item.markerId));
      for (const record of records.values()) if (record.committed) {
        // Sending clears composer attachments, but the accepted DOM preview stays visible.
        record.archived = !ids.has(record.id);
        if (record.archived) record.marker.remove(); else if (!record.marker.isConnected) { record.position = ''; shadow.appendChild(record.marker); }
      }
      renumber(); schedule();
    };
    window.__codeclubTakeCommentMarkerState = (id) => {
      // Also expire retired previews after SPA navigation when no marker animation is running.
      for (const record of records.values()) if (!record.element.isConnected || record.pageUrl !== location.href) remove(record.id, true);
      return { removed: removed.splice(0), active: id && records.has(id) ? { exists: true, anchor: records.get(id).anchor } : null };
    };
    window.__codeclubSetPickerPalette = palette;
    window.__codeclubStopPicker = () => { stop(); for (const record of records.values()) if (!record.committed) remove(record.id); window.__codeclubSelection = null; };
    const dispose = () => {
      disposed = true; stop(); cancelAnimationFrame(frame);
      for (const record of records.values()) remove(record.id);
      host.remove(); window.removeEventListener('pagehide', dispose);
      window.__codeclubDomPicker = null;
    };
    window.__codeclubDisposeDomPicker = dispose;
    window.__codeclubDomPicker = { start };
    window.addEventListener('pagehide', dispose, { once: true });
    start(settings);
    return true;
  })()`;
}
