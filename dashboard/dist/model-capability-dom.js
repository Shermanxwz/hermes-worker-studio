(function () {
  'use strict';
  const API = window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__;
  const R = API?._runtime;
  const I = API?._internal;
  if (!R || !I) return;
  let queued = false;

  function moaSlot(preset, kind, index) {
    const row = R.moaConfig?.presets?.[preset];
    return kind === 'aggregator' ? (row?.aggregator || {}) : (row?.reference_models?.[index] || {});
  }
  function renderMoa(slotNode, preset, kind, index) {
    const selects = slotNode.querySelectorAll('.hws3-moa-slot-grid select');
    if (selects.length < 2 || !R.modelOptions) return;
    const provider = selects[0].value, model = selects[1].value;
    const d = I.descriptor(R.modelOptions, provider, model);
    const key = R.moaKey(preset, kind, index);
    const effort = R.moaOverrides.has(key) ? R.moaOverrides.get(key) : String(moaSlot(preset, kind, index)?.reasoning_effort || 'auto');
    let root = slotNode.querySelector(':scope > .hws3-moa-reasoning-capability');
    const sig = JSON.stringify([preset, kind, index, provider, model, d.control, d.canDisable, d.efforts.map((x) => x.value), effort]);
    if (root?.dataset.hwsSignature === sig) return;
    if (!root) { root = document.createElement('div'); root.className = 'hws3-moa-reasoning-capability'; slotNode.appendChild(root); }
    root.dataset.hwsSignature = sig; root.textContent = '';
    const title = document.createElement('small'); title.textContent = `思考 · ${API.reasoningLabel(d)}`; root.appendChild(title);
    if (['none', 'fixed', 'auto'].includes(d.control)) return;
    const enabledEffort = d.efforts[0]?.value || d.defaultEffort || 'medium';
    if (d.canDisable === true) {
      const label = document.createElement('label'); label.className = 'hws3-reasoning-switch';
      const text = document.createElement('span'); text.className = 'hws3-reasoning-switch-label'; text.textContent = '思考';
      const input = document.createElement('input'); input.className = 'hws3-switch-input'; input.type = 'checkbox'; input.checked = effort !== 'none'; input.setAttribute('aria-label', '开启思考');
      const track = document.createElement('span'); track.className = 'hws3-switch-track'; track.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('i'); thumb.className = 'hws3-switch-thumb'; track.appendChild(thumb);
      const state = document.createElement('b'); state.className = 'hws3-switch-state'; state.textContent = input.checked ? '开启' : '关闭';
      input.addEventListener('change', () => { R.setMoaOverride(key, input.checked ? enabledEffort : 'none'); renderMoa(slotNode, preset, kind, index); });
      label.append(text, input, track, state); root.appendChild(label);
    }
    if (d.control === 'toggle') return;
    if (d.efforts.length) {
      const values = ['auto', ...d.efforts.map((x) => x.value)];
      const label = document.createElement('label'); label.className = 'hws3-reasoning-effort'; label.title = '只显示 Hermes 上游明确给出的 effort vocabulary';
      const head = document.createElement('span'); head.className = 'hws3-reasoning-effort-head';
      const name = document.createElement('span'); name.textContent = '强度';
      const selected = effort !== 'none' && values.includes(effort) ? effort : 'auto';
      const selectedText = document.createElement('b'); selectedText.textContent = selected === 'auto' ? 'Auto' : selected;
      head.append(name, selectedText);
      const shell = document.createElement('span'); shell.className = 'hws3-reasoning-slider-shell';
      const slider = document.createElement('input'); slider.className = 'hws3-reasoning-slider'; slider.type = 'range'; slider.min = '0'; slider.max = String(values.length - 1); slider.step = '1'; slider.value = String(Math.max(0, values.indexOf(selected))); slider.disabled = effort === 'none'; slider.setAttribute('aria-label', 'MOA 思考强度');
      const ticks = document.createElement('span'); ticks.className = 'hws3-reasoning-slider-ticks'; ticks.setAttribute('aria-hidden', 'true');
      values.forEach((value, tickIndex) => { const tick = document.createElement('i'); if (tickIndex === Number(slider.value)) tick.className = 'active'; const dot = document.createElement('em'); const caption = document.createElement('small'); caption.textContent = value === 'auto' ? 'Auto' : value; tick.append(dot, caption); ticks.appendChild(tick); });
      slider.addEventListener('change', () => R.setMoaOverride(key, values[Number(slider.value)] || 'auto'));
      shell.append(slider, ticks); label.append(head, shell); root.appendChild(label);
    }
  }
  function enhanceMoa() {
    const page = document.querySelector('.hws3-moa-page');
    if (!page || !R.moaConfig || !R.modelOptions) return;
    const preset = page.querySelector('.hws3-moa-preset-control select')?.value || R.moaConfig.default_preset || Object.keys(R.moaConfig.presets || {})[0] || 'default';
    page.querySelectorAll('.hws3-moa-slot').forEach((node, index) => {
      const agg = node.classList.contains('aggregator'), kind = agg ? 'aggregator' : 'reference', slotIndex = agg ? 0 : index;
      renderMoa(node, preset, kind, slotIndex);
      node.querySelectorAll('.hws3-moa-slot-grid select').forEach((select) => {
        if (select.dataset.hwsReasoningWatch) return;
        select.dataset.hwsReasoningWatch = '1';
        select.addEventListener('change', () => { R.setMoaOverride(R.moaKey(preset, kind, slotIndex), 'auto'); setTimeout(() => renderMoa(node, preset, kind, slotIndex), 0); });
      });
    });
  }
  function enhanceVerifier() {
    for (const card of document.querySelectorAll('.hws3-two-col .hws3-card')) {
      if (String(card.querySelector('header small')?.textContent || '').trim() !== 'VERIFIER') continue;
      for (const control of card.querySelectorAll('.hws3-reasoning-capability,.hws3-reasoning-toggle,.hws3-reasoning-switch,.hws3-reasoning-effort')) {
        control.classList.add('hws3-reasoning-readonly'); control.querySelectorAll('input,select,button').forEach((n) => { n.disabled = true; });
      }
      if (!card.querySelector('[data-hws-verifier-reasoning-note]')) { const note = document.createElement('small'); note.dataset.hwsVerifierReasoningNote = '1'; note.className = 'hws3-muted'; note.textContent = 'Verifier reasoning 仅展示模型能力；当前 Hermes auxiliary.review.* 未公开独立 reasoning 写入契约。'; card.appendChild(note); }
    }
  }
  function enhanceModels() {
    if (!R.modelOptions) return;
    for (const card of document.querySelectorAll('.hws3-model-catalog .hws3-card')) {
      const provider = String(card.querySelector('header small')?.textContent || '').trim();
      for (const row of card.querySelectorAll('.hws3-model-row')) {
        const model = String(row.querySelector('strong')?.textContent || '').trim(), detail = row.querySelector('small');
        if (!provider || !model || !detail || !String(detail.textContent).includes('思考：')) continue;
        const d = I.descriptor(R.modelOptions, provider, model), text = String(detail.textContent).replace(/思考：.*$/, `思考：${API.reasoningLabel(d)}`), title = `能力来源：${d.source}${d.explicitControl ? ' · 上游明确 control' : ' · Hermes picker capability'}`;
        if (detail.textContent !== text) detail.textContent = text; if (detail.title !== title) detail.title = title;
      }
    }
  }
  function refresh() { queued = false; enhanceVerifier(); enhanceMoa(); enhanceModels(); }
  function schedule() { if (queued) return; queued = true; queueMicrotask(refresh); }
  window.__HWS_MODEL_CAPABILITY_DOM_REFRESH__ = schedule;
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  API._testing = { ...(API._testing || {}), enhanceVerifier, enhanceMoa, enhanceModels, moaKey: R.moaKey, setMoaOverride: R.setMoaOverride, applyReasoning: R.applyReasoning, sourceRoute: R.sourceRoute, runRoutes: R.runRoutes };
})();
