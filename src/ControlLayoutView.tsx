import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CirclePlay, Eye, EyeOff,
  GripVertical, LogOut, PanelTopClose, PanelTopOpen, Pencil, Plus, RotateCcw, Search, SquarePlus,
  Trash2, Volume1, Volume2, VolumeX, X, type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { LanguagePreference } from "./i18n";

type Panel = "trackpad" | "keys" | "actions";
type ActionCommand =
  | { kind: "key"; key: string }
  | { kind: "shortcut"; modifiers: string[]; key: string }
  | { kind: "system"; action: string };
type ControlItem = { id: string; label: string; detail: string; symbol: string; visible: boolean; command?: ActionCommand };
type BackendLayout = {
  language: "en" | "zh-CN";
  trackpad: { pointerSpeed: number; scrollSpeed: number; showLeftClick: boolean; showRightClick: boolean; showModifiers: boolean };
  keys: Array<{ id: string; visible: boolean }>;
  actions: Array<{ id: string; label: string; visible: boolean; command: ActionCommand }>;
};
type Modifier = "control" | "option" | "shift" | "command";
type ShortcutDraft = { id: string | null; label: string; modifiers: string; key: string };
const STORAGE_KEY = "touchdock.control-layout";
const keyOptions = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Left Bracket", "Right Bracket", "Tab", "Space", "Enter", "Escape", "Backspace", "Delete", "Arrow Up", "Arrow Down", "F11"];
const actionPresets: ControlItem[] = [
  { id: "switch-apps", label: "Switch apps", detail: "⌘ + Tab", symbol: "⌘⇥", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "tab" } },
  { id: "search", label: "Search", detail: "⌘ + Space", symbol: "⌕", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "space" } },
  { id: "overview", label: "Overview", detail: "⌃ + ↑", symbol: "⌃↑", visible: true, command: { kind: "shortcut", modifiers: ["control"], key: "arrow_up" } },
  { id: "show-desktop", label: "Show desktop", detail: "F11", symbol: "▦", visible: true, command: { kind: "key", key: "f11" } },
  { id: "volume-up", label: "Volume up", detail: "System audio", symbol: "+", visible: true, command: { kind: "system", action: "volume_up" } },
  { id: "volume-down", label: "Volume down", detail: "System audio", symbol: "−", visible: true, command: { kind: "system", action: "volume_down" } },
  { id: "mute", label: "Mute audio", detail: "System audio", symbol: "×", visible: true, command: { kind: "system", action: "mute" } },
  { id: "play-pause", label: "Play / Pause", detail: "Media control", symbol: "▶", visible: true, command: { kind: "system", action: "play_pause" } },
  { id: "new-window", label: "New window", detail: "⌘ + N", symbol: "⌘N", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "n" } },
  { id: "new-tab", label: "New tab", detail: "⌘ + T", symbol: "⌘T", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "t" } },
  { id: "quick-search", label: "Quick search", detail: "⌘ + K", symbol: "⌘K", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "k" } },
  { id: "go-back", label: "Back", detail: "⌘ + [", symbol: "⌘[", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "left_bracket" } },
  { id: "go-forward", label: "Forward", detail: "⌘ + ]", symbol: "⌘]", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "right_bracket" } },
  { id: "close-window", label: "Close window", detail: "⌘ + W", symbol: "⌘W", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "w" } },
  { id: "quit-app", label: "Quit application", detail: "⌘ + Q", symbol: "⌘Q", visible: true, command: { kind: "shortcut", modifiers: ["meta"], key: "q" } },
];

const presetIcons: Record<string, LucideIcon> = {
  "volume-up": Volume2,
  "volume-down": Volume1,
  mute: VolumeX,
  "play-pause": CirclePlay,
  "new-window": PanelTopOpen,
  "new-tab": SquarePlus,
  "quick-search": Search,
  "go-back": ArrowLeft,
  "go-forward": ArrowRight,
  "close-window": PanelTopClose,
  "quit-app": LogOut,
};

const defaultKeys: ControlItem[] = [
  { id: "escape", label: "Esc", detail: "Escape", symbol: "×", visible: true },
  { id: "backspace", label: "Delete", detail: "Backspace", symbol: "⌫", visible: true },
  { id: "tab", label: "Tab", detail: "Tab", symbol: "⇥", visible: true },
  { id: "space", label: "Space", detail: "Space", symbol: "␣", visible: true },
  { id: "enter", label: "Enter", detail: "Enter", symbol: "↵", visible: true },
];

const defaultShortcuts: ControlItem[] = [
  actionPresets.find((item) => item.id === "switch-apps")!,
  actionPresets.find((item) => item.id === "search")!,
  actionPresets.find((item) => item.id === "overview")!,
  actionPresets.find((item) => item.id === "show-desktop")!,
  actionPresets.find((item) => item.id === "mute")!,
];

const keyValues: Record<string, string> = { ...Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((key) => [key, key.toLowerCase()])), "Left Bracket": "left_bracket", "Right Bracket": "right_bracket", Tab: "tab", Space: "space", Enter: "enter", Escape: "escape", Backspace: "backspace", Delete: "delete", "Arrow Up": "arrow_up", "Arrow Down": "arrow_down", F11: "f11" };
const modifierValue: Record<string, string> = { Command: "meta", Control: "control", Option: "alt", Shift: "shift" };
const modifierNames = ["Command", "Control", "Option", "Shift"] as const;
const modifierSymbols: Record<string, string> = { Command: "⌘", Control: "⌃", Option: "⌥", Shift: "⇧" };
const modifierDisplay: Record<string, string> = { meta: "Command", control: "Control", alt: "Option", shift: "Shift" };
const keyDisplay = Object.fromEntries(Object.entries(keyValues).map(([label, value]) => [value, label]));
const supportedSystemActions = new Set(["volume_up", "volume_down", "mute", "play_pause"]);
const legacyKeyOrder = ["escape", "tab", "space", "backspace", "enter"];
const defaultKeyOrder = ["escape", "backspace", "tab", "space", "enter"];

function decorateAction(action: BackendLayout["actions"][number]): ControlItem {
  const preset = actionPresets.find((item) => item.id === action.id || (item.command?.kind === "system" && action.command.kind === "system" && item.command.action === action.command.action));
  if (preset) return { ...preset, id: action.id, label: action.label, visible: action.visible, command: action.command };
  const labels: Record<string, string> = { f: "F", c: "C", v: "V", z: "Z", left_bracket: "[", right_bracket: "]", tab: "Tab", space: "Space", arrow_up: "Arrow Up", arrow_down: "Arrow Down", f11: "F11" };
  const modifierLabels: Record<string, string> = { meta: "Command", control: "Control", alt: "Option", shift: "Shift" };
  const modifiers = action.command.kind === "shortcut" ? action.command.modifiers.map((value) => modifierLabels[value]) : [];
  const key = action.command.kind === "system" ? "" : (labels[action.command.key] ?? action.command.key.toUpperCase());
  const detail = [...modifiers, key].filter(Boolean).join(" + ");
  const symbol = detail.replace("Command", "⌘").replace("Control", "⌃").replace("Option", "⌥").replace("Shift", "⇧").split(" + ").join("").replace("Arrow Up", "↑").replace("Arrow Down", "↓").replace("Space", "␣").replace("Tab", "⇥");
  return { ...action, detail, symbol };
}

function normalizeKeyOrder(items: ControlItem[]) {
  if (items.map((item) => item.id).join() !== legacyKeyOrder.join()) return items;
  return defaultKeyOrder.map((id) => items.find((item) => item.id === id)!);
}

function ItemSymbol({ item }: { item: ControlItem }) {
  const Icon = presetIcons[item.id];
  return Icon ? <Icon aria-hidden="true" size={16} strokeWidth={1.8} /> : <>{item.symbol}</>;
}

function moveItem(items: ControlItem[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function readSavedLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { keys?: ControlItem[]; shortcuts?: ControlItem[]; pointerSpeed?: number; scrollSpeed?: number; showLeftClick?: boolean; showRightClick?: boolean; showModifiers?: boolean } | null;
    if (saved && Array.isArray(saved.keys) && Array.isArray(saved.shortcuts)) {
      const allowedKeyIds = new Set(defaultKeys.map((item) => item.id));
      const migratedKeys = saved.keys.filter((item) => allowedKeyIds.has(item.id));
      return { keys: normalizeKeyOrder(migratedKeys.length ? migratedKeys : defaultKeys), shortcuts: saved.shortcuts, pointerSpeed: saved.pointerSpeed ?? 1.3, scrollSpeed: saved.scrollSpeed ?? 1.3, showLeftClick: saved.showLeftClick ?? true, showRightClick: saved.showRightClick ?? true, showModifiers: saved.showModifiers ?? true };
    }
  } catch {
    // Invalid local prototypes fall back to the product defaults.
  }
  return { keys: defaultKeys, shortcuts: defaultShortcuts, pointerSpeed: 1.3, scrollSpeed: 1.3, showLeftClick: true, showRightClick: true, showModifiers: true };
}

export function ControlLayoutView({ language }: { language: LanguagePreference }) {
  const zh = language === "zh-CN";
  const [panel, setPanel] = useState<Panel>("trackpad");
  const [savedLayout] = useState(readSavedLayout);
  const [keys, setKeys] = useState(savedLayout.keys);
  const [shortcuts, setShortcuts] = useState(savedLayout.shortcuts);
  const [heldModifiers, setHeldModifiers] = useState<Modifier[]>([]);
  const [pointerSpeed, setPointerSpeed] = useState(savedLayout.pointerSpeed);
  const [scrollSpeed, setScrollSpeed] = useState(savedLayout.scrollSpeed);
  const [showLeftClick, setShowLeftClick] = useState(savedLayout.showLeftClick);
  const [showRightClick, setShowRightClick] = useState(savedLayout.showRightClick);
  const [showModifiers, setShowModifiers] = useState(savedLayout.showModifiers);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft | null>(null);
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const isShortcutDialogOpen = shortcutDraft !== null;
  const [shortcutEditorTab, setShortcutEditorTab] = useState<"custom" | "presets">("presets");
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const draggedItemIdRef = useRef<string | null>(null);
  const dragTargetIndexRef = useRef<number | null>(null);
  const modifierPress = useRef<{ modifier: Modifier; startedAt: number; wasHeld: boolean } | null>(null);
  const shortcutDialogRef = useRef<HTMLDialogElement>(null);
  const backendReady = useRef(false);
  const items = panel === "keys" ? keys : shortcuts;
  const setItems = panel === "keys" ? setKeys : setShortcuts;
  const previewKeys = useMemo(() => normalizeKeyOrder(keys).map((item, slot) => ({ item, slot })).filter(({ item }) => item.visible), [keys]);
  const visibleShortcuts = useMemo(() => shortcuts.filter((item) => item.visible), [shortcuts]);
  const localizedLabels: Record<string, string> = zh ? {
    space: "空格", backspace: "删除", enter: "回车", "switch-apps": "切换应用", search: "搜索",
    overview: "调度中心", "show-desktop": "显示桌面", mute: "静音", "volume-up": "增大音量",
    "volume-down": "减小音量", "play-pause": "播放 / 暂停", "new-window": "新建窗口",
    "new-tab": "新建标签页", "quick-search": "快速搜索", "go-back": "后退", "go-forward": "前进",
    "close-window": "关闭窗口", "quit-app": "退出应用", copy: "复制", paste: "粘贴", undo: "撤销",
  } : {};

  function itemLabel(item: ControlItem) {
    return localizedLabels[item.id] ?? item.label;
  }

  function itemDetail(item: ControlItem) {
    if (!zh) return item.detail;
    if (item.detail === "System audio") return "系统音频";
    if (item.detail === "Media control") return "媒体控制";
    if (item.detail === "Application shortcut") return "应用快捷键";
    return item.detail;
  }

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys, shortcuts, pointerSpeed, scrollSpeed, showLeftClick, showRightClick, showModifiers })); } catch { /* Browser previews still work for this session. */ }
  }, [keys, shortcuts, pointerSpeed, scrollSpeed, showLeftClick, showRightClick, showModifiers]);

  useEffect(() => {
    invoke<BackendLayout>("control_layout").then((layout) => {
      setKeys(normalizeKeyOrder(layout.keys.map((key) => ({ ...defaultKeys.find((item) => item.id === key.id)!, visible: key.visible }))));
      setShortcuts(layout.actions.filter((action) => action.command.kind !== "system" || supportedSystemActions.has(action.command.action)).map(decorateAction));
      setPointerSpeed(layout.trackpad.pointerSpeed);
      setScrollSpeed(layout.trackpad.scrollSpeed);
      setShowLeftClick(layout.trackpad.showLeftClick);
      setShowRightClick(layout.trackpad.showRightClick);
      setShowModifiers(layout.trackpad.showModifiers);
      backendReady.current = true;
    }).catch(() => { /* Browser-only previews use local storage. */ });
  }, []);

  useEffect(() => {
    if (!backendReady.current) return;
    const timer = window.setTimeout(() => {
      const layout: BackendLayout = {
        language: zh ? "zh-CN" : "en",
        trackpad: { pointerSpeed, scrollSpeed, showLeftClick, showRightClick, showModifiers },
        keys: keys.map(({ id, visible }) => ({ id, visible })),
        actions: shortcuts.filter((item): item is ControlItem & { command: ActionCommand } => Boolean(item.command)).map(({ id, label, visible, command }) => ({ id, label, visible, command })),
      };
      void invoke("set_control_layout", { layout });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [zh, keys, shortcuts, pointerSpeed, scrollSpeed, showLeftClick, showRightClick, showModifiers]);

  useEffect(() => {
    const dialog = shortcutDialogRef.current;
    if (!dialog || !isShortcutDialogOpen) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [isShortcutDialogOpen]);

  useEffect(() => {
    if (!isRecordingShortcut) return;
    const captureKey = (event: KeyboardEvent) => recordShortcut(event);
    window.addEventListener("keydown", captureKey, true);
    return () => window.removeEventListener("keydown", captureKey, true);
  }, [isRecordingShortcut]);

  function reset() {
    setKeys(defaultKeys);
    setShortcuts(defaultShortcuts);
    setPointerSpeed(1.3);
    setScrollSpeed(1.3);
    setShowLeftClick(true);
    setShowRightClick(true);
    setShowModifiers(true);
  }

  function startModifierPress(event: PointerEvent<HTMLButtonElement>, modifier: Modifier) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const wasHeld = heldModifiers.includes(modifier);
    modifierPress.current = { modifier, startedAt: performance.now(), wasHeld };
    if (!wasHeld) setHeldModifiers((current) => [...current, modifier]);
  }

  function finishModifierPress(event: PointerEvent<HTMLButtonElement>, modifier: Modifier) {
    const press = modifierPress.current;
    if (!press || press.modifier !== modifier) return;
    const longPress = performance.now() - press.startedAt >= 320;
    if (longPress || press.wasHeld) setHeldModifiers((current) => current.filter((value) => value !== modifier));
    modifierPress.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function editShortcut(item?: ControlItem) {
    const command = item?.command;
    const key = command && command.kind !== "system" ? (keyDisplay[command.key] ?? "") : "";
    const modifiers = command?.kind === "shortcut" ? command.modifiers.map((value) => modifierDisplay[value]).filter(Boolean).join(" + ") || "None" : "None";
    setShortcutEditorTab(item ? "custom" : "presets");
    setSelectedPresetIds([]);
    setShortcutDraft({ id: item?.id ?? null, label: item?.label ?? "", modifiers, key });
  }

  function toggleDraftModifier(modifier: string) {
    setIsRecordingShortcut(false);
    setShortcutDraft((current) => {
      if (!current) return current;
      const selected = current.modifiers === "None" ? [] : current.modifiers.split(" + ");
      const next = selected.includes(modifier) ? selected.filter((value) => value !== modifier) : [...selected, modifier];
      const ordered = modifierNames.filter((value) => next.includes(value));
      return { ...current, modifiers: ordered.join(" + ") || "None" };
    });
  }

  function saveShortcut() {
    if (!shortcutDraft?.label.trim() || !shortcutDraft.key) return;
    const detail = shortcutDraft.modifiers === "None" ? shortcutDraft.key : `${shortcutDraft.modifiers} + ${shortcutDraft.key}`;
    const symbol = detail.replace("Command", "⌘").replace("Control", "⌃").replace("Option", "⌥").replace("Shift", "⇧").split(" + ").join("").replace("Arrow Up", "↑").replace("Arrow Down", "↓").replace("Left Bracket", "[").replace("Right Bracket", "]").replace("Space", "␣");
    const modifiers = shortcutDraft.modifiers === "None" ? [] : shortcutDraft.modifiers.split(" + ").map((value) => modifierValue[value]).filter(Boolean);
    const key = keyValues[shortcutDraft.key];
    const command: ActionCommand = modifiers.length ? { kind: "shortcut", modifiers, key } : { kind: "key", key };
    if (shortcutDraft.id) {
      setShortcuts((current) => current.map((item) => item.id === shortcutDraft.id ? { ...item, label: shortcutDraft.label.trim(), detail, symbol, command } : item));
    } else {
      setShortcuts((current) => [...current, { id: `custom-${Date.now()}`, label: shortcutDraft.label.trim(), detail, symbol, visible: true, command }]);
    }
    setShortcutDraft(null);
  }

  function recordShortcut(event: KeyboardEvent) {
    if (!isRecordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
    const keyMap: Record<string, string> = { " ": "Space", "[": "Left Bracket", "]": "Right Bracket", ArrowUp: "Arrow Up", ArrowDown: "Arrow Down" };
    const key = keyMap[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
    if (!keyOptions.includes(key)) return;
    setShortcutDraft((current) => current ? { ...current, key } : current);
    setIsRecordingShortcut(false);
  }

  function closeShortcutDialog() {
    setIsRecordingShortcut(false);
    setSelectedPresetIds([]);
    setShortcutDraft(null);
  }

  function togglePreset(presetId: string) {
    setSelectedPresetIds((current) => current.includes(presetId)
      ? current.filter((id) => id !== presetId)
      : [...current, presetId]);
  }

  function confirmPreset() {
    if (selectedPresetIds.length === 0) return;
    setShortcuts((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const selected = new Set(selectedPresetIds);
      const additions = actionPresets.filter((preset) => selected.has(preset.id) && !existingIds.has(preset.id));
      return [...current, ...additions];
    });
    closeShortcutDialog();
  }

  function reorderItem(itemId: string, targetSlot: number) {
    const draggedIndex = items.findIndex((item) => item.id === itemId);
    if (draggedIndex < 0) {
      return;
    }
    const next = [...items];
    const [dragged] = next.splice(draggedIndex, 1);
    const insertionIndex = draggedIndex < targetSlot ? targetSlot - 1 : targetSlot;
    next.splice(insertionIndex, 0, dragged);
    setItems(next);
  }

  function clearItemDrag() {
    draggedItemIdRef.current = null;
    dragTargetIndexRef.current = null;
    setDraggedItemId(null);
    setDragTargetIndex(null);
  }

  function startItemDrag(event: PointerEvent<HTMLButtonElement>, itemId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedItemIdRef.current = itemId;
    setDraggedItemId(itemId);
  }

  function moveItemDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!draggedItemIdRef.current) return;
    event.preventDefault();
    const list = event.currentTarget.closest(".control-list");
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".control-row"));
    const targetSlot = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    const nextTarget = targetSlot < 0 ? rows.length : targetSlot;
    dragTargetIndexRef.current = nextTarget;
    setDragTargetIndex(nextTarget);
  }

  function finishItemDrag(event: PointerEvent<HTMLButtonElement>) {
    const itemId = draggedItemIdRef.current;
    const targetSlot = dragTargetIndexRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (itemId && targetSlot !== null) reorderItem(itemId, targetSlot);
    clearItemDrag();
  }

  function removeAction(itemId: string) {
    setShortcuts((current) => current.filter((item) => item.id !== itemId));
  }

  return (
    <section className="view control-layout-view">
      <header className="page-header control-layout-header">
        <div><h1>{zh ? "控制布局" : "Control layout"}</h1><p>{zh ? "配置手机控制器中的固定按键与快捷操作。" : "Configure fixed keys and favorite actions on the phone controller."}</p></div>
        <button className="button secondary" type="button" onClick={reset}><RotateCcw aria-hidden="true" size={14} />{zh ? "恢复默认" : "Reset"}</button>
      </header>

      <div className="layout-workspace">
        <section className="layout-editor" aria-label={zh ? "布局编辑器" : "Layout editor"}>
          <div className="layout-toolbar">
            <div className="layout-tabs" role="tablist" aria-label={zh ? "控制类型" : "Control type"}>
              {(["trackpad", "keys", "actions"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={panel === value} className={panel === value ? "active" : ""} onClick={() => setPanel(value)}>{zh ? (value === "trackpad" ? "触控板" : value === "keys" ? "按键" : "快捷操作") : (value === "trackpad" ? "Trackpad" : value === "keys" ? "Keys" : "Actions")}</button>)}
            </div>
            {panel === "actions" && <button className="layout-add" type="button" onClick={() => editShortcut()}><Plus aria-hidden="true" size={14} />{zh ? "添加操作" : "Add action"}</button>}
          </div>
          <p className="layout-hint">{panel === "trackpad" ? (zh ? "调整触控板默认行为，右侧预览会立即更新。" : "Adjust the default trackpad behavior. The preview updates immediately.") : (zh ? "调整顺序或隐藏控制项，右侧预览会立即更新。" : "Reorder or hide controls. The preview updates immediately.")}</p>
          {panel === "trackpad" ? <div className="trackpad-settings">
            <label><span><strong>{zh ? "光标速度" : "Pointer speed"}</strong><small>{zh ? "手机首次打开时的默认灵敏度" : "Default sensitivity when the controller opens"}</small></span><input type="range" min="0.5" max="3" step="0.1" value={pointerSpeed} onChange={(event) => setPointerSpeed(Number(event.target.value))} /><output>{pointerSpeed.toFixed(1)}×</output></label>
            <label><span><strong>{zh ? "滚动速度" : "Scroll speed"}</strong><small>{zh ? "调节相同滑动距离滚动的内容量" : "Control how far content moves for the same gesture"}</small></span><input type="range" min="0.5" max="3" step="0.1" value={scrollSpeed} onChange={(event) => setScrollSpeed(Number(event.target.value))} /><output>{scrollSpeed.toFixed(1)}×</output></label>
            <div className="trackpad-toggle"><span><strong>{zh ? "左键" : "Left click"}</strong><small>{zh ? "在触控板下方显示左键" : "Show below the trackpad"}</small></span><button type="button" role="switch" aria-checked={showLeftClick} className={showLeftClick ? "active" : ""} onClick={() => setShowLeftClick((value) => !value)}><i></i></button></div>
            <div className="trackpad-toggle"><span><strong>{zh ? "右键" : "Right click"}</strong><small>{zh ? "在触控板下方显示右键" : "Show below the trackpad"}</small></span><button type="button" role="switch" aria-checked={showRightClick} className={showRightClick ? "active" : ""} onClick={() => setShowRightClick((value) => !value)}><i></i></button></div>
            <div className="trackpad-toggle"><span><strong>{zh ? "修饰键" : "Modifier keys"}</strong><small>{zh ? "在触控板底部显示修饰键" : "Show modifier keys below the trackpad"}</small></span><button type="button" role="switch" aria-checked={showModifiers} className={showModifiers ? "active" : ""} onClick={() => setShowModifiers((value) => !value)}><i></i></button></div>
          </div> : <><div className="control-list">
            {items.map((item, index) => (
              <div className={`control-row ${item.visible ? "" : "is-hidden"} ${draggedItemId === item.id ? "is-dragging" : ""} ${dragTargetIndex === index ? "is-drag-before" : ""} ${dragTargetIndex === index + 1 ? "is-drag-after" : ""}`} key={item.id}>
                <button className="drag-handle" type="button" aria-label={`${zh ? "拖拽排序" : "Drag to reorder"} ${itemLabel(item)}`} title={zh ? "按住并拖拽排序" : "Press and drag to reorder"} onPointerDown={(event) => startItemDrag(event, item.id)} onPointerMove={moveItemDrag} onPointerUp={finishItemDrag} onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); clearItemDrag(); }}><GripVertical aria-hidden="true" size={15} /></button>
                <span className="control-symbol" aria-hidden="true"><ItemSymbol item={item} /></span>
                <span className="control-copy"><strong>{itemLabel(item)}</strong><small>{itemDetail(item)}</small></span>
                <div className="row-actions">
                  <button type="button" aria-label={`${zh ? "上移" : "Move up"} ${itemLabel(item)}`} title={zh ? "上移" : "Move up"} disabled={index === 0} onClick={() => setItems(moveItem(items, index, -1))}><ArrowUp aria-hidden="true" size={14} /></button>
                  <button type="button" aria-label={`${zh ? "下移" : "Move down"} ${itemLabel(item)}`} title={zh ? "下移" : "Move down"} disabled={index === items.length - 1} onClick={() => setItems(moveItem(items, index, 1))}><ArrowDown aria-hidden="true" size={14} /></button>
                  {panel === "actions" && !actionPresets.some((preset) => preset.id === item.id) && <button type="button" aria-label={`${zh ? "编辑" : "Edit"} ${itemLabel(item)}`} title={zh ? "编辑" : "Edit"} onClick={() => editShortcut(item)}><Pencil aria-hidden="true" size={13} /></button>}
                  <button type="button" aria-pressed={item.visible} aria-label={`${item.visible ? (zh ? "隐藏" : "Hide") : (zh ? "显示" : "Show")} ${itemLabel(item)}`} title={item.visible ? (zh ? "隐藏" : "Hide") : (zh ? "显示" : "Show")} onClick={() => setItems(items.map((entry) => entry.id === item.id ? { ...entry, visible: !entry.visible } : entry))}>{item.visible ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}</button>
                  {panel === "actions" && <button className="danger-action" type="button" aria-label={`${zh ? "删除" : "Delete"} ${itemLabel(item)}`} title={zh ? "删除" : "Delete"} onClick={() => removeAction(item.id)}><Trash2 aria-hidden="true" size={14} /></button>}
                </div>
              </div>
            ))}
          </div></>}
        </section>

        <aside className="phone-preview" aria-label={zh ? "手机预览" : "Phone preview"}>
          <div className="preview-heading"><strong>{zh ? "手机预览" : "Phone preview"}</strong><span>{zh ? "实时" : "Live"}</span></div>
          <div className="phone-frame">
            <div className="phone-speaker" aria-hidden="true"></div>
            <div className="phone-header"><strong>TouchDock</strong><i aria-hidden="true"></i></div>
            <div className="phone-tabs"><span className={panel === "trackpad" ? "active" : ""}>{zh ? "触控板" : "Trackpad"}</span><span className={panel === "keys" ? "active" : ""}>{zh ? "按键" : "Keys"}</span><span className={panel === "actions" ? "active" : ""}>{zh ? "快捷操作" : "Actions"}</span></div>
            {panel === "trackpad" ? <div className="phone-controls preview-trackpad"><div className="mini-trackpad" style={{ "--preview-scroll-width": "24%" } as CSSProperties}><span>{zh ? "移动光标" : "Move pointer"}</span><i></i></div><div className="mini-clicks">{showLeftClick && <span>{zh ? "左键" : "Left click"}</span>}{showRightClick && <span>{zh ? "右键" : "Right click"}</span>}</div><div className={`preview-modifiers ${showModifiers ? "" : "is-hidden"}`}>
              <div className="modifier-heading"><span>{zh ? "修饰键" : "Modifiers"}</span>{heldModifiers.length > 0 && <button type="button" onClick={() => setHeldModifiers([])}><X aria-hidden="true" size={9} />{zh ? "全部释放" : "Release all"}</button>}</div>
              <div className="modifier-row">
                {([['control', '⌃'], ['option', '⌥'], ['shift', '⇧'], ['command', '⌘']] as const).map(([value, symbol]) => <button className={heldModifiers.includes(value) ? "active" : ""} key={value} type="button" aria-label={value} aria-pressed={heldModifiers.includes(value)} onPointerDown={(event) => startModifierPress(event, value)} onPointerUp={(event) => finishModifierPress(event, value)} onPointerCancel={(event) => finishModifierPress(event, value)}><b>{symbol}</b></button>)}
              </div>
              <p>{heldModifiers.length > 0 ? `${heldModifiers.map((value) => ({ control: "⌃", option: "⌥", shift: "⇧", command: "⌘" })[value]).join(" ")} ${zh ? "保持按下" : "held"}` : (zh ? "轻点锁定 · 长按临时按住" : "Tap to lock · Hold for momentary")}</p>
            </div></div> : panel === "keys" ? <div className="phone-controls"><div className="preview-dpad"><span className="up">↑</span><span className="left">←</span><span className="down">↓</span><span className="right">→</span></div><div className="preview-key-row">{previewKeys.map(({ item, slot }) => <span className={`preview-key-slot-${slot} ${item.id === "space" ? "preview-space-key" : ""}`} key={item.id}><b>{item.id === "escape" ? "esc" : item.id === "space" ? "" : item.symbol}</b>{item.id === "space" && <i aria-hidden="true"></i>}{item.id !== "escape" && <small>{itemLabel(item)}</small>}</span>)}</div></div> : <div className="phone-controls preview-shortcuts">{visibleShortcuts.map((item) => <span key={item.id}><b><ItemSymbol item={item} /></b><small>{itemLabel(item)}</small></span>)}</div>}
            <footer><i aria-hidden="true"></i>{zh ? "命令已加密" : "Commands encrypted"}</footer>
          </div>
        </aside>
      </div>
      {shortcutDraft && <dialog className="shortcut-dialog" ref={shortcutDialogRef} aria-labelledby="shortcut-dialog-title" onCancel={(event) => { event.preventDefault(); closeShortcutDialog(); }} onClick={(event) => { if (event.currentTarget === event.target) closeShortcutDialog(); }}>
        <div className="shortcut-dialog-panel">
          <header><div><h2 id="shortcut-dialog-title">{shortcutDraft.id ? (zh ? "编辑快捷操作" : "Edit action") : (zh ? "添加快捷操作" : "Add action")}</h2><p>{zh ? "选择预设，或创建单键与组合键操作。" : "Choose a preset or create a single-key or key-combination action."}</p></div><button type="button" aria-label={zh ? "关闭" : "Close"} onClick={closeShortcutDialog}><X aria-hidden="true" size={16} /></button></header>
          {!shortcutDraft.id && <div className="shortcut-dialog-tabs" role="tablist"><button className={shortcutEditorTab === "presets" ? "active" : ""} type="button" role="tab" aria-selected={shortcutEditorTab === "presets"} onClick={() => setShortcutEditorTab("presets")}>{zh ? "常用预设" : "Presets"}</button><button className={shortcutEditorTab === "custom" ? "active" : ""} type="button" role="tab" aria-selected={shortcutEditorTab === "custom"} onClick={() => setShortcutEditorTab("custom")}>{zh ? "自定义" : "Custom"}</button></div>}
          {shortcutEditorTab === "presets" && !shortcutDraft.id ? <div className="preset-dialog-body"><div className="preset-list">{actionPresets.map((preset) => { const added = shortcuts.some((item) => item.id === preset.id); const selected = selectedPresetIds.includes(preset.id); return <button type="button" key={preset.id} className={selected ? "selected" : ""} disabled={added} aria-pressed={selected} onClick={() => togglePreset(preset.id)}><span className="control-symbol" aria-hidden="true"><ItemSymbol item={preset} /></span><span><strong>{itemLabel(preset)}</strong><small>{itemDetail(preset)}</small></span><em>{added ? (zh ? "已添加" : "Added") : selected ? <Check aria-hidden="true" size={14} /> : <Plus aria-hidden="true" size={14} />}</em></button>; })}</div><footer className="preset-dialog-footer"><button type="button" onClick={closeShortcutDialog}>{zh ? "取消" : "Cancel"}</button><button className="primary" type="button" disabled={selectedPresetIds.length === 0} onClick={confirmPreset}><Check aria-hidden="true" size={13} />{zh ? `添加（${selectedPresetIds.length}）` : `Add (${selectedPresetIds.length})`}</button></footer></div> : <div className="shortcut-form">
            <label><span>{zh ? "名称" : "Name"}</span><input autoFocus type="text" maxLength={24} value={shortcutDraft.label} placeholder={zh ? "例如：打开文件" : "e.g. Open file"} onFocus={() => setIsRecordingShortcut(false)} onChange={(event) => setShortcutDraft({ ...shortcutDraft, label: event.target.value })} /></label>
            <div className="shortcut-modifier-field"><span>{zh ? "修饰键（可多选）" : "Modifiers (select multiple)"}</span><div className="shortcut-modifier-picker">{modifierNames.map((modifier) => { const selected = shortcutDraft.modifiers !== "None" && shortcutDraft.modifiers.split(" + ").includes(modifier); return <button key={modifier} type="button" className={selected ? "active" : ""} aria-pressed={selected} onClick={() => toggleDraftModifier(modifier)}><b aria-hidden="true">{modifierSymbols[modifier]}</b>{modifier}</button>; })}</div></div>
            <label><span>{zh ? "录制主键" : "Record main key"}</span><button className={`shortcut-recorder ${isRecordingShortcut ? "is-recording" : ""}`} type="button" aria-pressed={isRecordingShortcut} onClick={() => setIsRecordingShortcut(true)}><kbd aria-live="polite">{isRecordingShortcut ? (zh ? "正在录制…" : "Recording…") : shortcutDraft.key || (zh ? "点击开始录制" : "Click to record")}</kbd><small>{isRecordingShortcut ? (zh ? "只按主键，不要按修饰键" : "Press only the main key, without modifiers") : (zh ? "修饰键请在上方选择" : "Select modifiers above")}</small></button></label>
            <div className="shortcut-preview"><span>{zh ? "将发送" : "Sends"}</span><strong>{shortcutDraft.key ? (shortcutDraft.modifiers === "None" ? shortcutDraft.key : `${shortcutDraft.modifiers} + ${shortcutDraft.key}`) : (zh ? "尚未录制" : "Not recorded")}</strong></div>
            <footer><button type="button" onClick={closeShortcutDialog}>{zh ? "取消" : "Cancel"}</button><button className="primary" type="button" disabled={!shortcutDraft.label.trim() || !shortcutDraft.key} onClick={saveShortcut}><Check aria-hidden="true" size={13} />{zh ? "完成" : "Done"}</button></footer>
          </div>}
        </div>
      </dialog>}
    </section>
  );
}
