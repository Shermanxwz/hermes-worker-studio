#!/usr/bin/env python3
"""Deterministically stage Product 3 UI for pinned Hermes product contracts.

The supported installer runs this transform on its temporary copy only. Every
substitution is exact-count checked so source drift fails closed instead of
silently shipping an image-only, inaccessible, or partially transformed browser
bundle. The transform does not add product features: it widens the existing
attachment rail to the Gateway's documented file family and closes keyboard,
touch, dialog, and accessible-name gaps in the existing controls.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"could not locate unique Product 3 {label} (count={count})")
    return text.replace(old, new, 1)


def stage_bundle(text: str) -> str:
    # Any-file composer. The Gateway wrapper owns the corresponding official
    # image.attach_bytes / pdf.attach / file.attach staging semantics.
    text = replace_once(
        text,
        "  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;",
        "  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;",
        "attachment size constant",
    )
    text = replace_once(
        text,
        "  function AttachmentChip({ item, onRemove }) {\n    return h('div', { className: 'hws3-attachment-chip' }, h('img', { src: item.dataUrl, alt: item.name }), h('div', null, h('strong', null, shortText(item.name, 24)), h('small', null, `${Math.max(1, Math.round(item.size / 1024))} KB`)), h('button', { onClick: onRemove, title: '移除' }, '×'));\n  }",
        "  function AttachmentChip({ item, onRemove }) {\n    const preview = item.kind === 'image'\n      ? h('img', { src: item.dataUrl, alt: item.name })\n      : h('span', { className: `hws3-file-icon ${item.kind || 'file'}`, 'aria-hidden': 'true' }, item.kind === 'pdf' ? 'PDF' : 'FILE');\n    return h('div', { className: 'hws3-attachment-chip' }, preview, h('div', null, h('strong', null, shortText(item.name, 24)), h('small', null, `${item.kind === 'image' ? '图片' : item.kind === 'pdf' ? 'PDF' : '文件'} · ${Math.max(1, Math.round(item.size / 1024))} KB`)), h('button', { onClick: onRemove, title: '移除', 'aria-label': `移除附件 ${item.name}` }, '×'));\n  }",
        "attachment chip",
    )
    text = replace_once(
        text,
        "    async function filesToAttachments(files) {\n      const valid = [...files].filter((file) => IMAGE_TYPES.has(file.type));\n      for (const file of valid) {\n        if (file.size > MAX_IMAGE_BYTES) throw new Error(`图片 ${file.name} 超过 25 MB`);\n      }\n      const converted = await Promise.all(valid.map((file) => new Promise((resolve, reject) => {\n        const reader = new FileReader();\n        reader.onerror = () => reject(reader.error || new Error('图片读取失败'));\n        reader.onload = () => resolve({ id: `${Date.now()}-${Math.random()}`, name: file.name || 'clipboard.png', type: file.type || 'image/png', size: file.size, dataUrl: String(reader.result || '') });\n        reader.readAsDataURL(file);\n      })));\n      setAttachments((xs) => [...xs, ...converted]);\n    }",
        "    async function filesToAttachments(files) {\n      const valid = [...files].filter(Boolean);\n      for (const file of valid) {\n        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`附件 ${file.name || 'attachment'} 超过 25 MB`);\n      }\n      const converted = await Promise.all(valid.map((file) => new Promise((resolve, reject) => {\n        const reader = new FileReader();\n        reader.onerror = () => reject(reader.error || new Error('附件读取失败'));\n        reader.onload = () => {\n          const kind = IMAGE_TYPES.has(file.type) ? 'image' : (file.type === 'application/pdf' || /\\.pdf$/i.test(file.name || '')) ? 'pdf' : 'file';\n          resolve({ id: `${Date.now()}-${Math.random()}`, name: file.name || (kind === 'image' ? 'clipboard.png' : 'attachment'), type: file.type || 'application/octet-stream', kind, size: file.size, dataUrl: String(reader.result || '') });\n        };\n        reader.readAsDataURL(file);\n      })));\n      setAttachments((xs) => [...xs, ...converted]);\n    }",
        "file conversion pipeline",
    )
    text = replace_once(
        text,
        "    const onPaste = async (e) => {\n      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));\n      if (!files.length) return;",
        "    const onPaste = async (e) => {\n      const files = [...(e.clipboardData?.files || [])];\n      if (!files.length) return;",
        "clipboard file pipeline",
    )
    text = replace_once(
        text,
        "          h('button', { type: 'button', className: 'hws3-plus', title: '添加图片', onClick: () => fileRef.current?.click() }, '+'),\n          h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: true, hidden: true, onChange: async (e) => { try { await filesToAttachments(e.target.files || []); } catch (err) { alert(errorText(err)); } finally { e.target.value = ''; } } }),",
        "          h('button', { type: 'button', className: 'hws3-plus', title: '添加文件', 'aria-label': '添加文件', onClick: () => fileRef.current?.click() }, '+'),\n          h('input', { ref: fileRef, type: 'file', multiple: true, hidden: true, onChange: async (e) => { try { await filesToAttachments(e.target.files || []); } catch (err) { alert(errorText(err)); } finally { e.target.value = ''; } } }),",
        "file picker",
    )
    text = replace_once(
        text,
        "        const executionRoute = await resolveExecutionRoute(route);\n        const session = current?.id ? current : await createSession(text || '图片对话', route);",
        "        const executionRoute = await resolveExecutionRoute(route);\n        const session = current?.id ? current : await createSession(text || '附件对话', route);",
        "attachment-only session label",
    )
    text = replace_once(text, "[${attachments.length} 张图片]", "[${attachments.length} 个附件]", "attachment-only message label")
    text = replace_once(
        text,
        "        for (const item of attachments) parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high' } });",
        "        for (const item of attachments) {\n          if (item.kind === 'image') parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high', name: item.name, mime_type: item.type, kind: 'image' } });\n          else parts.push({ type: 'file_url', file_url: { url: item.dataUrl, name: item.name, mime_type: item.type, kind: item.kind || 'file' } });\n        }",
        "mixed attachment Run payload",
    )

    # Existing product controls: accessibility and keyboard closure only.
    text = replace_once(
        text,
        "    return h('div', { className: 'hws3-error' }, h('span', null, error), onClear ? h('button', { onClick: onClear, title: '关闭' }, '×') : null);",
        "    return h('div', { className: 'hws3-error', role: 'alert', 'aria-live': 'assertive' }, h('span', null, error), onClear ? h('button', { onClick: onClear, title: '关闭', 'aria-label': '关闭错误提示' }, '×') : null);",
        "error alert semantics",
    )
    old_modal = """  function Modal({ title, body, inputValue, setInputValue, confirmText = '确认', destructive = false, onConfirm, onClose }) {
    return h('div', { className: 'hws3-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
      h('section', { className: 'hws3-modal', role: 'dialog', 'aria-modal': 'true' },
        h('header', null, h('h3', null, title), h('button', { onClick: onClose, title: '关闭' }, '×')),
        body ? h('p', null, body) : null,
        inputValue !== undefined ? h('input', { autoFocus: true, value: inputValue, onChange: (e) => setInputValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && inputValue.trim()) onConfirm(); } }) : null,
        h('footer', null,
          h(Button, { className: 'ghost', onClick: onClose }, '取消'),
          h(Button, { className: destructive ? 'danger' : 'primary', onClick: onConfirm, disabled: inputValue !== undefined && !inputValue.trim() }, confirmText),
        ),
      ),
    );
  }
"""
    new_modal = """  function Modal({ title, body, inputValue, setInputValue, confirmText = '确认', destructive = false, onConfirm, onClose }) {
    const dialogRef = useRef(null);
    const previousFocusRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    useEffect(() => {
      previousFocusRef.current = document.activeElement;
      const dialog = dialogRef.current;
      const initial = inputValue !== undefined
        ? dialog?.querySelector('input:not([disabled])')
        : dialog?.querySelector('button:not([disabled])');
      initial?.focus?.();
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCloseRef.current?.();
          return;
        }
        if (event.key !== 'Tab' || !dialog) return;
        const focusable = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', onKeyDown);
      return () => {
        document.removeEventListener('keydown', onKeyDown);
        previousFocusRef.current?.focus?.();
      };
    }, []);
    return h('div', { className: 'hws3-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
      h('section', { ref: dialogRef, className: 'hws3-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hws3-modal-title' },
        h('header', null, h('h3', { id: 'hws3-modal-title' }, title), h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭对话框' }, '×')),
        body ? h('p', null, body) : null,
        inputValue !== undefined ? h('input', { value: inputValue, 'aria-label': title, onChange: (e) => setInputValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && inputValue.trim()) onConfirm(); } }) : null,
        h('footer', null,
          h(Button, { className: 'ghost', onClick: onClose }, '取消'),
          h(Button, { className: destructive ? 'danger' : 'primary', onClick: onConfirm, disabled: inputValue !== undefined && !inputValue.trim() }, confirmText),
        ),
      ),
    );
  }
"""
    text = replace_once(text, old_modal, new_modal, "modal keyboard and focus lifecycle")
    text = replace_once(
        text,
        "    return h('div', { className: 'hws3-session-wrap' },",
        "    return h('div', { className: 'hws3-session-wrap', onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); } },",
        "session menu focus close",
    )
    text = replace_once(
        text,
        "      h('button', { className: 'hws3-session-more', title: '会话操作', onClick: (e) => { e.stopPropagation(); setOpen(!open); } }, '⋯'),",
        "      h('button', { className: 'hws3-session-more', title: '会话操作', 'aria-label': `会话操作：${sessionTitle(session)}`, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: (e) => { e.stopPropagation(); setOpen(!open); } }, '⋯'),",
        "session menu trigger semantics",
    )
    text = replace_once(
        text,
        "      open ? h('div', { className: 'hws3-session-menu' },",
        "      open ? h('div', { className: 'hws3-session-menu', role: 'menu', 'aria-label': `会话操作：${sessionTitle(session)}` },",
        "session menu semantics",
    )
    text = replace_once(
        text,
        "        h('button', { onClick: () => { setOpen(false); onRename(); } }, '重命名'),\n        h('button', { onClick: () => { setOpen(false); onArchive(); } }, session.archived ? '取消归档' : '归档'),\n        h('button', { className: 'danger', onClick: () => { setOpen(false); onDelete(); } }, '删除'),",
        "        h('button', { role: 'menuitem', onClick: () => { setOpen(false); onRename(); } }, '重命名'),\n        h('button', { role: 'menuitem', onClick: () => { setOpen(false); onArchive(); } }, session.archived ? '取消归档' : '归档'),\n        h('button', { role: 'menuitem', className: 'danger', onClick: () => { setOpen(false); onDelete(); } }, '删除'),",
        "session menu items",
    )
    text = replace_once(
        text,
        "      h('select', { value: normalized.provider, disabled: disabled || !providers.length, title: 'Provider', onChange:",
        "      h('select', { value: normalized.provider, disabled: disabled || !providers.length, title: 'Provider', 'aria-label': 'Provider', onChange:",
        "compact provider accessible name",
    )
    text = replace_once(
        text,
        "      h('select', { value: normalized.model, disabled: disabled || !models.length, title: '模型', onChange:",
        "      h('select', { value: normalized.model, disabled: disabled || !models.length, title: '模型', 'aria-label': '模型', onChange:",
        "compact model accessible name",
    )
    text = replace_once(
        text,
        "      h('button', { className: 'hws3-work-head', onClick: () => setExpanded(!expanded) },",
        "      h('button', { className: 'hws3-work-head', onClick: () => setExpanded(!expanded), 'aria-expanded': expanded },",
        "work timeline disclosure semantics",
    )
    text = replace_once(
        text,
        "          h('textarea', { ref: textareaRef, value: draft, disabled: commandBusy, onChange:",
        "          h('textarea', { ref: textareaRef, value: draft, disabled: commandBusy, 'aria-label': '给 Hermes 发送消息', onChange:",
        "composer accessible name",
    )
    text = replace_once(
        text,
        "h('button', { type: 'button', className: 'hws3-stop', disabled: true, title: '正在执行 Hermes 官方命令' },",
        "h('button', { type: 'button', className: 'hws3-stop', disabled: true, title: '正在执行 Hermes 官方命令', 'aria-label': 'Hermes 官方命令执行中' },",
        "command busy accessible name",
    )
    text = replace_once(
        text,
        "h('button', { type: 'button', className: 'hws3-stop', title: '停止 Run', onClick: onStop }, '■')",
        "h('button', { type: 'button', className: 'hws3-stop', title: '停止 Run', 'aria-label': '停止 Run', onClick: onStop }, '■')",
        "stop run accessible name",
    )
    text = replace_once(
        text,
        "h('button', { type: 'submit', className: 'hws3-send', disabled: !draft.trim() && !attachments.length, title: '发送' }, '↑')",
        "h('button', { type: 'submit', className: 'hws3-send', disabled: !draft.trim() && !attachments.length, title: '发送', 'aria-label': '发送消息' }, '↑')",
        "send accessible name",
    )
    text = replace_once(
        text,
        "h('button', { className: `hws3-switch ${ready ? 'on' : ''}`, disabled: busy, onClick: () => ready ? disable() : enable(), 'aria-pressed': ready },",
        "h('button', { className: `hws3-switch ${ready ? 'on' : ''}`, disabled: busy, onClick: () => ready ? disable() : enable(), 'aria-pressed': ready, 'aria-label': ready ? '关闭完全访问' : '开启完全访问' },",
        "full access switch accessible name",
    )
    text = replace_once(
        text,
        "h('nav', { className: 'hws3-nav' }, PRIMARY_NAV.map(([id, label, icon]) => h('button', { key: id, className: view === id ? 'active' : '', onClick:",
        "h('nav', { className: 'hws3-nav', 'aria-label': 'Worker Studio 主导航' }, PRIMARY_NAV.map(([id, label, icon]) => h('button', { key: id, className: view === id ? 'active' : '', 'aria-current': view === id ? 'page' : undefined, onClick:",
        "primary navigation semantics",
    )
    text = replace_once(
        text,
        "h('button', { className: 'hws3-mobile-close', onClick: () => setMobileOpen(false) }, '×')",
        "h('button', { className: 'hws3-mobile-close', onClick: () => setMobileOpen(false), title: '关闭菜单', 'aria-label': '关闭菜单' }, '×')",
        "mobile close accessible name",
    )
    text = replace_once(
        text,
        "h('div', { className: 'hws3-mobile-bar' }, h('button', { onClick: () => setMobileOpen(true), title: '菜单' }, '☰')",
        "h('div', { className: 'hws3-mobile-bar' }, h('button', { onClick: () => setMobileOpen(true), title: '菜单', 'aria-label': '打开菜单', 'aria-expanded': mobileOpen }, '☰')",
        "mobile menu semantics",
    )
    text = replace_once(
        text,
        "placeholder: 'https://example.com/v1 · 粘贴 /responses 也会自动识别模式'",
        "placeholder: 'https://example.com/v1 · 粘贴 /responses 会规范化到 API Root'",
        "endpoint normalization wording",
    )

    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    text = args.bundle.read_text(encoding="utf-8")
    args.bundle.write_text(stage_bundle(text), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
