// Icône d'état dans la zone de notification sous Linux (protocole StatusNotifierItem + DBusMenu,
// affiché nativement par KDE Plasma, Xfce, Cinnamon, et par GNOME avec l'extension AppIndicator).
//
//   node dist/server/tray/linux.js [--port 8787]
//
// Processus séparé du serveur : il reste affiché (en rouge) quand le serveur est arrêté, et
// peut le relancer. Démarré à l'ouverture de session (~/.config/autostart/jellyfin-en-boucle-tray.desktop).

import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { TraySummary } from "../shared/types.js";
import { renderIcon, toArgb } from "./icon.js";
import { STOPPED } from "./status.js";

// --- Types minimaux de @homebridge/dbus-native ------------------------------------------------

interface DBusMessage {
  destination?: string;
  path?: string;
  interface?: string;
  member: string;
  signature?: string;
  body?: unknown[];
}
interface Bus {
  name?: string;
  connection: EventEmitter;
  invoke(message: DBusMessage, callback: (error: { name: string; message: string } | null, ...values: unknown[]) => void): void;
  requestName(name: string, flags: number, callback: (error: unknown, code: number) => void): void;
  exportInterface(obj: object, path: string, iface: object): void;
}
const require = createRequire(import.meta.url);
const dbus = require("@homebridge/dbus-native") as { sessionBus(): Bus };

// --- Paramètres -------------------------------------------------------------------------------

const portIndex = process.argv.indexOf("--port");
const PORT = Number((portIndex >= 0 && process.argv[portIndex + 1]) || process.env.PORT || 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const UI_URL = `http://localhost:${PORT}/`;
const POLL_MS = 3000;
const UNIQUE_NAME = "org.jellyfin_en_boucle.Tray";
const ITEM_NAME = `org.kde.StatusNotifierItem-${process.pid}-1`;
const ITEM_PATH = "/StatusNotifierItem";
const MENU_PATH = "/MenuBar";
const DO_NOT_QUEUE = 4;
const PRIMARY_OWNER = 1;

const log = (message: string) => console.log(`[tray] ${message}`);

// --- Menu ----------------------------------------------------------------------------------------

export interface MenuItem {
  id: number;
  label?: string;
  enabled?: boolean;
  separator?: boolean;
  visible?: boolean;
  action?: () => void;
}

export function buildMenu(summary: TraySummary, actions: Record<string, () => void>): MenuItem[] {
  const running = summary.level !== "stopped";
  const toggle = summary.canResume
    ? { label: "Reprendre", enabled: true, action: actions.resume }
    : { label: "Pause", enabled: summary.canPause, action: actions.pause };
  return [
    { id: 1, label: `Jellyfin en boucle : ${summary.title}`, enabled: false },
    { id: 2, label: summary.detail, enabled: false, visible: Boolean(summary.detail) },
    { id: 3, separator: true },
    { id: 10, label: "Ouvrir l'interface", enabled: running, action: actions.open },
    { id: 11, label: "Afficher le QR code (téléphone)", enabled: running, action: actions.qr },
    { id: 12, separator: true },
    { id: 20, ...toggle },
    { id: 21, label: "Épisode suivant", enabled: summary.canSkip, action: actions.skip },
    { id: 22, separator: true },
    { id: 30, label: running ? "Redémarrer le serveur" : "Démarrer le serveur", enabled: true, action: actions.restart },
    { id: 31, label: "Masquer cette icône", enabled: true, action: actions.quit },
  ];
}

type Variant = [string, unknown];
type Layout = [number, [string, Variant][], [string, Layout][]];

function itemProperties(item: MenuItem): [string, Variant][] {
  if (item.separator) return [["type", ["s", "separator"]]];
  return [
    ["label", ["s", (item.label ?? "").replace(/_/g, "__")]],
    ["enabled", ["b", item.enabled !== false]],
    ["visible", ["b", item.visible !== false]],
  ];
}

// --- Icône ---------------------------------------------------------------------------------------

const pixmapCache = new Map<string, [number, number, Buffer][]>();
function pixmaps(level: TraySummary["level"]): [number, number, Buffer][] {
  let cached = pixmapCache.get(level);
  if (!cached) {
    cached = [22, 32, 48, 64].map((size) => [size, size, toArgb(renderIcon(level, size))] as [number, number, Buffer]);
    pixmapCache.set(level, cached);
  }
  return cached;
}

// --- Actions ---------------------------------------------------------------------------------------

function openUrl(url: string): void {
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).on("error", () => log("xdg-open introuvable")).unref();
}

async function post(path: string): Promise<void> {
  await fetch(BASE + path, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  void refresh();
}

async function fetchSummary(): Promise<TraySummary> {
  try {
    const response = await fetch(`${BASE}/api/tray`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return STOPPED;
    return (await response.json()) as TraySummary;
  } catch {
    return STOPPED;
  }
}

// --- StatusNotifierItem ----------------------------------------------------------------------------

let summary: TraySummary = STOPPED;
let menu: MenuItem[] = [];
let revision = 1;

const actions = {
  open: () => openUrl(UI_URL),
  qr: () => openUrl(`${UI_URL}?qr=1`),
  pause: () => void post("/api/player/pause"),
  resume: () => void post("/api/player/resume"),
  skip: () => void post("/api/player/skip"),
  restart: () =>
    execFile("systemctl", ["--user", "restart", "jellyfin-office.service"], (err) => {
      if (err) log(`Redémarrage impossible : ${err.message}`);
      setTimeout(() => void refresh(), 2000);
    }),
  quit: () => process.exit(0),
};

class Item extends EventEmitter {
  Category = "ApplicationStatus";
  Id = "jellyfin-en-boucle";
  Title = "Jellyfin en boucle";
  Status = "Active";
  WindowId = 0;
  IconName = "";
  IconThemePath = "";
  OverlayIconName = "";
  AttentionIconName = "";
  AttentionIconPixmap: [number, number, Buffer][] = [];
  OverlayIconPixmap: [number, number, Buffer][] = [];
  ItemIsMenu = false;
  Menu = MENU_PATH;
  get IconPixmap() {
    return pixmaps(summary.level);
  }
  get ToolTip() {
    return ["", [], `Jellyfin en boucle : ${summary.title}`, summary.detail];
  }
  Activate() {
    if (summary.level !== "stopped") return actions.open();
    // Serveur arrêté : on le relance, puis on ouvre l'interface quand il a eu le temps de démarrer.
    actions.restart();
    setTimeout(actions.open, 4000);
  }
  SecondaryActivate() {
    if (summary.canPause) actions.pause();
    else if (summary.canResume) actions.resume();
  }
  ContextMenu() {}
  Scroll() {}
}

class Menu extends EventEmitter {
  Version = 3;
  TextDirection = "ltr";
  Status = "normal";
  IconThemePath: string[] = [];

  GetLayout(parentId: number): [number, Layout] {
    const children: [string, Layout][] = menu.map((item) => ["(ia{sv}av)", [item.id, itemProperties(item), []]]);
    const root: Layout = [0, [["children-display", ["s", "submenu"]]], parentId === 0 ? children : []];
    return [revision, root];
  }
  GetGroupProperties(ids: number[]) {
    return menu.filter((item) => ids.length === 0 || ids.includes(item.id)).map((item) => [item.id, itemProperties(item)]);
  }
  GetProperty(id: number, name: string): Variant {
    const found = itemProperties(menu.find((item) => item.id === id) ?? { id }).find(([key]) => key === name);
    return found ? found[1] : ["s", ""];
  }
  Event(id: number, eventId: string) {
    if (eventId === "clicked") menu.find((item) => item.id === id)?.action?.();
  }
  EventGroup(events: [number, string][]) {
    for (const [id, eventId] of events) this.Event(id, eventId);
    return [];
  }
  AboutToShow() {
    return false;
  }
  AboutToShowGroup() {
    return [[], []];
  }
}

const item = new Item();
const menuObject = new Menu();

async function refresh(): Promise<void> {
  const next = await fetchSummary();
  const changed = JSON.stringify(next) !== JSON.stringify(summary);
  const iconChanged = next.level !== summary.level;
  summary = next;
  menu = buildMenu(summary, actions);
  if (!changed) return;
  revision++;
  if (iconChanged) item.emit("NewIcon");
  item.emit("NewToolTip");
  menuObject.emit("LayoutUpdated", revision, 0);
}

// --- Bus ---------------------------------------------------------------------------------------------

function call<T>(bus: Bus, message: DBusMessage): Promise<T> {
  return new Promise((resolve, reject) =>
    bus.invoke(message, (error, value) => (error ? reject(new Error(error.message || error.name)) : resolve(value as T))),
  );
}

function requestName(bus: Bus, name: string): Promise<number> {
  return new Promise((resolve, reject) =>
    bus.requestName(name, DO_NOT_QUEUE, (error, code) => (error ? reject(error) : resolve(code))),
  );
}

async function main(): Promise<void> {
  if (!process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.XDG_RUNTIME_DIR) {
    log("Pas de session graphique (bus D-Bus de session introuvable).");
    process.exit(0);
  }
  const bus = dbus.sessionBus();
  bus.connection.on("error", (err: Error) => {
    log(`Bus D-Bus : ${err.message}`);
    process.exit(1);
  });

  // Une seule icône à la fois.
  if ((await requestName(bus, UNIQUE_NAME)) !== PRIMARY_OWNER) {
    log("Icône déjà affichée.");
    process.exit(0);
  }
  await requestName(bus, ITEM_NAME);

  bus.exportInterface(item, ITEM_PATH, {
    name: "org.kde.StatusNotifierItem",
    methods: { Activate: ["ii", ""], SecondaryActivate: ["ii", ""], ContextMenu: ["ii", ""], Scroll: ["is", ""] },
    properties: {
      Category: "s", Id: "s", Title: "s", Status: "s", WindowId: "i", IconName: "s", IconPixmap: "a(iiay)",
      IconThemePath: "s", OverlayIconName: "s", OverlayIconPixmap: "a(iiay)", AttentionIconName: "s",
      AttentionIconPixmap: "a(iiay)", ToolTip: "(sa(iiay)ss)", ItemIsMenu: "b", Menu: "o",
    },
    signals: { NewTitle: [""], NewIcon: [""], NewToolTip: [""], NewStatus: ["s"] },
  });
  bus.exportInterface(menuObject, MENU_PATH, {
    name: "com.canonical.dbusmenu",
    methods: {
      GetLayout: ["iias", "u(ia{sv}av)"],
      GetGroupProperties: ["aias", "a(ia{sv})"],
      GetProperty: ["is", "v"],
      Event: ["isvu", ""],
      EventGroup: ["a(isvu)", "ai"],
      AboutToShow: ["i", "b"],
      AboutToShowGroup: ["ai", "aiai"],
    },
    properties: { Version: "u", TextDirection: "s", Status: "s", IconThemePath: "as" },
    signals: { ItemsPropertiesUpdated: ["a(ia{sv})a(ias)"], LayoutUpdated: ["ui"], ItemActivationRequested: ["iu"] },
  });

  await refresh();
  setInterval(() => void refresh(), POLL_MS);

  // Enregistrement auprès de la zone de notification ; renouvelé si elle redémarre.
  let registeredWith = "";
  let warned = false;
  const register = async () => {
    try {
      const owner = await call<string>(bus, {
        destination: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "GetNameOwner",
        signature: "s",
        body: ["org.kde.StatusNotifierWatcher"],
      });
      if (owner === registeredWith) return;
      await call(bus, {
        destination: "org.kde.StatusNotifierWatcher",
        path: "/StatusNotifierWatcher",
        interface: "org.kde.StatusNotifierWatcher",
        member: "RegisterStatusNotifierItem",
        signature: "s",
        body: [ITEM_NAME],
      });
      registeredWith = owner;
      warned = false;
      log("Icône affichée dans la zone de notification.");
    } catch {
      registeredWith = "";
      if (!warned) {
        log("Aucune zone de notification compatible (sous GNOME : extension « AppIndicator »). Nouvel essai régulier.");
        warned = true;
      }
    }
  };
  await register();
  setInterval(() => void register(), 10000);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((err) => {
    log(`Erreur : ${(err as Error).message}`);
    process.exit(1);
  });
}
