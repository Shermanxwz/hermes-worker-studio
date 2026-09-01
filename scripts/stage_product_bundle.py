#!/usr/bin/env python3
"""Deterministically widen the Product 3 composer for pinned Hermes attachments.

The supported installer runs this transform on its temporary copy only. Every
substitution is exact-count checked so source drift fails closed instead of
silently shipping an image-only or partially transformed browser bundle.
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
    text = replace_once(
        text,
        "  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;",
        "  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;",
        "attachment size constant",
    )
    text = replace_once(
        text,
        "  function AttachmentChip({ item, onRemove }) {\n    return h('div', { className: 'hws3-attachment-chip' }, h('img', { src: item.dataUrl, alt: item.name }), h('div', null, h('strong', null, shortText(item.name, 24)), h('small', null, `${Math.max(1, Math.round(item.size / 1024))} KB`)), h('button', { onClick: onRemove, title: '移除' }, '×'));\n  }",
        "  function AttachmentChip({ item, onRemove }) {\n    const preview = item.kind === 'image'\n      ? h('img', { src: item.dataUrl, alt: item.name })\n      : h('span', { className: `hws3-file-icon ${item.kind || 'file'}` }, item.kind === 'pdf' ? 'PDF' : 'FILE');\n    return h('div', { className: 'hws3-attachment-chip' }, preview, h('div', null, h('strong', null, shortText(item.name, 24)), h('small', null, `${item.kind === 'image' ? '图片' : item.kind === 'pdf' ? 'PDF' : '文件'} · ${Math.max(1, Math.round(item.size / 1024))} KB`)), h('button', { onClick: onRemove, title: '移除' }, '×'));\n  }",
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
        "          h('button', { type: 'button', className: 'hws3-plus', title: '添加文件', onClick: () => fileRef.current?.click() }, '+'),\n          h('input', { ref: fileRef, type: 'file', multiple: true, hidden: true, onChange: async (e) => { try { await filesToAttachments(e.target.files || []); } catch (err) { alert(errorText(err)); } finally { e.target.value = ''; } } }),",
        "file picker",
    )
    text = replace_once(
        text,
        "        h('div', { className: 'hws3-composer-hint' }, h('span', null, 'Enter 发送 · Shift+Enter 换行 · Ctrl/Cmd+V 粘贴图片'), sending ? h('span', null, '运行中再次发送 = 调整方向') : null),",
        "        h('div', { className: 'hws3-composer-hint' }, h('span', null, 'Enter 发送 · Shift+Enter 换行 · Ctrl/Cmd+V 粘贴文件'), sending ? h('span', null, '运行中再次发送 = 调整方向') : null),",
        "composer hint",
    )
    text = replace_once(
        text,
        "        const session = current?.id ? current : await createSession(text || '图片对话');\n        const route = await lockRuntime(session, chatRoute);\n        const localContent = text || `[${attachments.length} 张图片]`;",
        "        const session = current?.id ? current : await createSession(text || '附件对话');\n        const route = await lockRuntime(session, chatRoute);\n        const localContent = text || `[${attachments.length} 个附件]`;",
        "attachment-only conversation labels",
    )
    text = replace_once(
        text,
        "        for (const item of attachments) parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high' } });",
        "        for (const item of attachments) {\n          if (item.kind === 'image') parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high', name: item.name, mime_type: item.type, kind: 'image' } });\n          else parts.push({ type: 'file_url', file_url: { url: item.dataUrl, name: item.name, mime_type: item.type, kind: item.kind || 'file' } });\n        }",
        "mixed attachment Run payload",
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
