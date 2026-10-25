/**
 * The panel's own styles, scoped to its shadow root. A host restyles it through the `--vex-*`
 * custom properties on the element; the defaults are a dark panel that reads on any page.
 */
export const STYLES = `
:host {
  --vex-bg: var(--vex-surface, #1a1b1f);
  --vex-bg-2: var(--vex-surface-2, #202227);
  --vex-bg-3: var(--vex-surface-3, #1f2125);
  --vex-field: var(--vex-field-bg, #16171a);
  --vex-border: #2a2c31;
  --vex-border-strong: #3a3d44;
  --vex-text: #ecedee;
  --vex-text-2: #c9cbd0;
  --vex-text-3: #a1a4ab;
  --vex-text-muted: #6b6e75;
  --vex-accent: #2f5fe8;
  --vex-accent-text: #8fb0ff;
  --vex-accent-soft: #24314f;
  --vex-success: #9fe3b5;
  --vex-success-bg: #17321f;
  --vex-warning: #f2c14e;
  --vex-warning-bg: #3a2f10;
  --vex-danger: #e5484d;
  --vex-danger-bg: #3a1a1c;
  --vex-font: var(--vex-font-family, Inter, system-ui, sans-serif);
  --vex-radius: 8px;
  display: grid;
  grid-template-rows: auto 1fr auto auto auto;
  min-height: 0;
  height: 100%;
  background: var(--vex-bg);
  color: var(--vex-text);
  font: 13px/1.45 var(--vex-font);
  box-sizing: border-box;
}
*, *::before, *::after { box-sizing: border-box; }
button, textarea { font: inherit; color: inherit; }
.muted { color: var(--vex-text-3); }
.vex-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--vex-border); }
.avatar { width: 96px; height: 96px; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45)); }
.avatar:empty { display: none; }
.avatar vex-avatar { width: 100%; height: 100%; }
.vex-meta { display: grid; gap: 2px; }
.label { display: inline-block; width: max-content; padding: 2px 8px; border-radius: 999px; background: var(--vex-bg-2); color: var(--vex-text-2); font-size: 11px; }
.label[data-phase='awaiting_confirmation'] { background: var(--vex-warning-bg); color: var(--vex-warning); }
.label[data-phase='success'] { background: var(--vex-success-bg); color: var(--vex-success); }
.label[data-phase='error'] { background: var(--vex-danger-bg); color: var(--vex-danger); }
.log { overflow: auto; padding: 12px 16px; display: grid; align-content: start; gap: 14px; }
.empty { display: grid; gap: 6px; color: var(--vex-text-3); }
.empty p { margin: 0; }
.suggestion { text-align: left; padding: 8px 10px; border: 1px dashed var(--vex-border-strong); border-radius: var(--vex-radius); background: transparent; color: var(--vex-text-2); cursor: pointer; }
.suggestion:hover { border-color: var(--vex-accent-text); }
.turn { display: grid; gap: 8px; }
.msg { padding: 8px 12px; border-radius: 12px; max-width: 92%; white-space: pre-wrap; }
.msg.user { justify-self: end; background: var(--vex-accent-soft); color: #e3eaff; }
.msg.vex { justify-self: start; background: var(--vex-bg-2); }
.msg.is-error { background: var(--vex-danger-bg); color: var(--vex-danger); }
.steps { list-style: none; margin: 0; padding: 0 0 0 6px; display: grid; gap: 4px; border-left: 2px solid var(--vex-border-strong); }
.step { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; padding-left: 8px; font-size: 12px; color: var(--vex-text-2); }
.step-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vex-border-strong); }
.step.is-pending .step-dot { background: var(--vex-accent-text); animation: vex-pulse 1s infinite; }
.step.is-confirming .step-dot { background: var(--vex-warning); }
.step.is-ok .step-dot { background: var(--vex-success); }
.step.is-error .step-dot, .step.is-denied .step-dot, .step.is-rejected .step-dot, .step.is-invalid .step-dot { background: var(--vex-danger); }
.step-state { font-size: 10px; color: var(--vex-text-muted); }
.step em { color: var(--vex-text-3); }
@keyframes vex-pulse { 50% { opacity: 0.4; } }
.confirm { padding: 10px 12px; border: 1px solid var(--vex-warning); border-radius: var(--vex-radius); background: var(--vex-warning-bg); }
.confirm p { margin: 0 0 6px; }
.confirm-details { margin: 0 0 8px; display: grid; gap: 4px; }
.confirm-row { display: grid; grid-template-columns: 72px 1fr; gap: 8px; }
.confirm-row dt { color: var(--vex-text-3); }
.confirm-row dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
.confirm-actions { display: flex; gap: 8px; }
.btn { padding: 6px 12px; border: 1px solid var(--vex-border-strong); border-radius: 6px; background: var(--vex-bg-3); cursor: pointer; }
.btn.primary { background: var(--vex-accent); border-color: var(--vex-accent); color: #fff; }
.btn.danger { background: var(--vex-danger-bg); border-color: var(--vex-danger); color: var(--vex-danger); }
.btn:disabled { opacity: 0.5; cursor: default; }
.news { display: grid; gap: 8px; }
.news-item { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--vex-accent-soft); border-radius: var(--vex-radius); background: var(--vex-accent-soft); }
.news-item p { margin: 0; white-space: pre-wrap; color: var(--vex-text-2); }
.news-actions { display: flex; gap: 8px; flex-wrap: wrap; }
a.btn { text-decoration: none; display: inline-block; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px 0; border-top: 1px solid var(--vex-border); }
.quick-actions[hidden] { display: none; }
.quick-action { padding: 4px 10px; border: 1px solid var(--vex-border-strong); border-radius: 999px; background: var(--vex-bg-3); color: var(--vex-text-2); cursor: pointer; font-size: 12px; }
.quick-action:hover:not(:disabled) { border-color: var(--vex-accent-text); color: var(--vex-text); }
.quick-action:disabled { opacity: 0.5; cursor: default; }
.quick-actions + .composer { border-top: 0; }
.tour-stage { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
.tour-highlight { position: fixed; border: 2px solid var(--vex-accent-text); border-radius: 8px; box-shadow: 0 0 0 4px rgba(143, 176, 255, 0.25); pointer-events: none; transition: left 0.25s, top 0.25s, width 0.25s, height 0.25s; }
.tour-highlight[hidden] { display: none; }
.tour-mascot { position: fixed; width: 96px; height: 96px; pointer-events: none; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45)); transition: left 0.35s ease, top 0.35s ease; }
.tour-mascot[hidden] { display: none; }
.tour-mascot vex-avatar { width: 100%; height: 100%; }
.tour-bubble { position: fixed; display: grid; gap: 8px; padding: 12px 14px; border: 1px solid var(--vex-border-strong); border-radius: 12px; background: var(--vex-bg); color: var(--vex-text); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45); pointer-events: auto; font: 13px/1.45 var(--vex-font); transition: left 0.25s, top 0.25s; }
.tour-bubble p { margin: 0; white-space: pre-wrap; }
.tour-count { font-size: 11px; color: var(--vex-text-muted); }
.tour-actions { display: flex; gap: 8px; }
.tour-stage.reduced * { transition: none !important; }
@media (prefers-reduced-motion: reduce) { .tour-highlight, .tour-mascot, .tour-bubble { transition: none; } }
.composer { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 12px 16px 0; border-top: 1px solid var(--vex-border); margin: 0; }
.composer textarea { resize: none; padding: 8px 10px; border: 1px solid var(--vex-border-strong); border-radius: var(--vex-radius); background: var(--vex-field); color: var(--vex-text); }
.hint { margin: 0; padding: 8px 16px 12px; color: var(--vex-text-muted); font-size: 11px; }
.hint code { font-family: ui-monospace, monospace; }
.error { color: var(--vex-danger); }
@media (prefers-reduced-motion: reduce) { .step.is-pending .step-dot { animation: none; } }
`;
