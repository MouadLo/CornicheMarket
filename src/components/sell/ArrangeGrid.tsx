import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  I18nManager,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { GAP, TILE_HEIGHT, Tile, gridMetrics } from "@/src/components/sell/ProductGrid";
import { Banner } from "@/src/components/ui/Banner";
import { Icon } from "@/src/components/ui/Icon";
import { InlineError } from "@/src/components/ui/InlineError";
import { errorKey } from "@/src/lib/errors/userMessage";
import {
  buildArrangementPayload,
  contentHeight,
  dropIndexForDrag,
  moveItem,
  moveTab,
  moveTile,
  slotOrigin,
  toggleTabVisible,
  toggleTileHidden,
  type ArrangeTab,
  type ArrangementPayload,
  type GridGeometry,
} from "@/src/lib/sellGrid/arrange";
import { appDirection, isolateBidi } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing } from "@/src/theme/tokens";

const LONG_PRESS_MS = 350;
const SLOP = 10;

type Props = {
  // The grid as the owner sees it now, hidden tabs and tiles included.
  initial: ArrangeTab[];
  // Saves the arrangement in one call; throws on failure (the grid then stays in
  // arrange mode with the owner's changes).
  onSave: (payload: ArrangementPayload) => Promise<void>;
  // Leaves arrange mode: after a save, or when the owner cancels.
  onClose: () => void;
};

// The Sell grid in arrange mode (UX_REVIEW O7). Same tabs and tiles as Sell,
// but a tap adds nothing: tiles are dragged (press and drag with a mouse, long
// press on a touch screen) or moved with their earlier/later buttons, and can
// be hidden. Changes are held here until "Terminer".
export function ArrangeGrid({ initial, onSave, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;
  const [working, setWorking] = useState<ArrangeTab[]>(initial);
  const [tabId, setTabId] = useState<string | null>(initial[0]?.id ?? null);
  const [paneWidth, setPaneWidth] = useState(0);
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastTabNote, setLastTabNote] = useState(false);

  const current = working.find((tab) => tab.id === tabId) ?? working[0];
  const rtl = Platform.OS === "web" ? appDirection(language ?? "") === "rtl" : I18nManager.isRTL;
  const { columns, tileWidth } = gridMetrics(paneWidth);
  const geometry: GridGeometry = useMemo(
    () => ({ columns, tileWidth, tileHeight: TILE_HEIGHT, gap: GAP, rtl }),
    [columns, tileWidth, rtl]
  );
  const innerWidth = Math.max(0, paneWidth - spacing.s4 * 2);

  const tiles = current?.tiles ?? [];
  const shownCount = tiles.filter((x) => !x.hidden).length;
  const tabIndex = working.findIndex((tab) => tab.id === current?.id);

  const dragFrom = drag ? tiles.findIndex((x) => x.key === drag.key) : -1;
  const dropAt =
    drag && dragFrom >= 0 ? dropIndexForDrag(dragFrom, drag, shownCount, geometry) : -1;
  // While dragging, the other tiles already sit where the drop would leave them.
  const preview = dragFrom >= 0 ? moveItem(tiles, dragFrom, dropAt) : tiles;
  const slotOf = new Map(preview.map((x, i) => [x.key, i]));

  const edit = (change: (tabs: ArrangeTab[]) => ArrangeTab[]) => {
    setFailure(null);
    setWorking(change);
  };

  const finishDrag = (key: string, dx: number, dy: number) => {
    setDrag(null);
    if (!current) return;
    const from = tiles.findIndex((x) => x.key === key);
    if (from < 0 || tiles[from].hidden) return;
    const to = dropIndexForDrag(from, { dx, dy }, shownCount, geometry);
    if (to !== from) edit((tabs) => moveTile(tabs, current.id, from, to));
  };

  const done = async () => {
    const payload = buildArrangementPayload(initial, working);
    if (!payload) {
      onClose();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await onSave(payload);
      onClose();
    } catch (error) {
      setFailure(errorKey(error));
      setSaving(false);
    }
  };

  if (!current) return null;

  // On web `left` is physical. On native in RTL it is swapped, so mirror it back.
  const leftFor = (x: number) => (Platform.OS !== "web" && rtl ? innerWidth - x - tileWidth : x);

  return (
    <View
      style={styles.wrap}
      onLayout={(e: LayoutChangeEvent) => setPaneWidth(e.nativeEvent.layout.width)}
    >
      <View style={styles.top}>
        <Banner tone="info" icon="sliders" text={t("sell.grid.arrangeBanner")} />
        <View style={styles.actions}>
          <View style={styles.flex}>
            <BigButton
              label={t("sell.grid.arrangeCancel")}
              variant="secondary"
              disabled={saving}
              onPress={onClose}
            />
          </View>
          <View style={styles.flex}>
            <BigButton
              label={saving ? t("sell.grid.arrangeSaving") : t("sell.grid.arrangeDone")}
              disabled={saving}
              onPress={() => void done()}
            />
          </View>
        </View>
        {failure ? <InlineError reasonKey={failure} /> : null}
        {lastTabNote ? <Banner tone="warn" text={t("sell.grid.keepOneTab")} /> : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
        accessibilityLabel={t("sell.grid.tabs")}
      >
        {working.map((tab) => {
          const on = tab.id === current.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                tab.visible ? tab.label : t("sell.grid.tabHidden", { name: tab.label })
              }
              onPress={() => setTabId(tab.id)}
              style={[styles.tab, on && styles.tabOn, !tab.visible && styles.dimmed]}
            >
              {tab.kind === "favorites" ? (
                <Icon name="star" size={18} color={on ? colors.white : colors.sand500} />
              ) : null}
              <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                {isolateBidi(tab.label)}
              </Text>
              {!tab.visible ? (
                <Icon name="eyeOff" size={18} color={on ? colors.white : colors.ink600} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.tabTools}>
        <RoundButton
          label={t("sell.grid.tabEarlier", { name: current.label })}
          icon="chevronBack"
          disabled={tabIndex <= 0}
          onPress={() => edit((tabs) => moveTab(tabs, tabIndex, tabIndex - 1))}
        />
        <RoundButton
          label={t("sell.grid.tabLater", { name: current.label })}
          icon="chevron"
          disabled={tabIndex >= working.length - 1}
          onPress={() => edit((tabs) => moveTab(tabs, tabIndex, tabIndex + 1))}
        />
        <RoundButton
          label={t(current.visible ? "sell.grid.hideTab" : "sell.grid.showTab", {
            name: current.label,
          })}
          icon={current.visible ? "eye" : "eyeOff"}
          onPress={() => {
            const next = toggleTabVisible(working, current.id);
            setLastTabNote(next === working);
            if (next !== working) edit(() => next);
          }}
        />
      </View>

      <ScrollView
        style={styles.tilesScroll}
        contentContainerStyle={styles.tilesContent}
        scrollEnabled={drag === null}
      >
        <View style={{ height: contentHeight(tiles.length, geometry) }}>
          {tiles.map((tile, index) => {
            const dragging = drag !== null && drag.key === tile.key;
            const slot = slotOrigin(slotOf.get(tile.key) ?? index, geometry);
            const own = slotOrigin(index, geometry);
            const x = dragging && drag ? own.x + drag.dx : slot.x;
            const y = dragging && drag ? own.y + drag.dy : slot.y;
            return (
              <DragSlot
                key={tile.key}
                enabled={!tile.hidden && !saving}
                label={t("sell.grid.dragTile", { name: tile.product.name })}
                style={[
                  styles.slot,
                  { width: tileWidth, height: TILE_HEIGHT, top: y, left: leftFor(x) },
                  tile.hidden && styles.dimmed,
                  dragging && styles.dragging,
                ]}
                onStart={() => setDrag({ key: tile.key, dx: 0, dy: 0 })}
                onMove={(dx, dy) => setDrag({ key: tile.key, dx, dy })}
                onEnd={(dx, dy) => finishDrag(tile.key, dx, dy)}
                onCancel={() => setDrag(null)}
              >
                {/* A picture of the tile only: on web even a disabled Pressable
                    claims the press, so the drag would never start. */}
                <View pointerEvents="none">
                  <Tile tile={tile} width={tileWidth} count={0} />
                </View>
                <View style={styles.tileTools}>
                  <MiniButton
                    label={t("sell.grid.moveEarlier", { name: tile.product.name })}
                    icon="chevronBack"
                    disabled={tile.hidden || index === 0}
                    onPress={() => edit((tabs) => moveTile(tabs, current.id, index, index - 1))}
                  />
                  <MiniButton
                    label={t("sell.grid.moveLater", { name: tile.product.name })}
                    icon="chevron"
                    disabled={tile.hidden || index >= shownCount - 1}
                    onPress={() => edit((tabs) => moveTile(tabs, current.id, index, index + 1))}
                  />
                  <MiniButton
                    label={t(tile.hidden ? "sell.grid.showTile" : "sell.grid.hideTile", {
                      name: tile.product.name,
                    })}
                    icon={tile.hidden ? "eyeOff" : "eye"}
                    onPress={() => edit((tabs) => toggleTileHidden(tabs, current.id, tile.key))}
                  />
                </View>
              </DragSlot>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function RoundButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "chevronBack" | "chevron" | "eye" | "eyeOff";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.round, disabled && styles.dimmed]}
    >
      <Icon name={icon} size={22} color={colors.brand700} />
    </Pressable>
  );
}

function MiniButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "chevronBack" | "chevron" | "eye" | "eyeOff";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={[styles.mini, disabled && styles.dimmed]}
    >
      <Icon name={icon} size={18} color={colors.ink900} />
    </Pressable>
  );
}

// A mouse press-and-drag starts the drag at once; a finger must hold for a
// moment first (moving sooner is a scroll), and a drag then takes over from the
// scroll view. Pure geometry lives in lib/sellGrid/arrange.ts.
function isTouch(event: GestureResponderEvent): boolean {
  const native = event.nativeEvent as unknown as { type?: string; pointerType?: string };
  return String(native?.type ?? "").startsWith("touch") || native?.pointerType === "touch";
}

function DragSlot({
  enabled,
  label,
  style,
  children,
  onStart,
  onMove,
  onEnd,
  onCancel,
}: {
  enabled: boolean;
  label: string;
  style: ViewStyle | (ViewStyle | false | undefined)[];
  children: ReactNode;
  onStart: () => void;
  onMove: (dx: number, dy: number) => void;
  onEnd: (dx: number, dy: number) => void;
  onCancel: () => void;
}) {
  const latest = useRef({ enabled, onStart, onMove, onEnd, onCancel });
  latest.current = { enabled, onStart, onMove, onEnd, onCancel };
  const armed = useRef(false);
  const granted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (event) =>
        latest.current.enabled && Platform.OS === "web" && !isTouch(event),
      onMoveShouldSetPanResponder: () => armed.current,
      onMoveShouldSetPanResponderCapture: () => armed.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        granted.current = true;
        if (!armed.current) {
          armed.current = true;
          latest.current.onStart();
        }
      },
      onPanResponderMove: (_event, g) => latest.current.onMove(g.dx, g.dy),
      onPanResponderRelease: (_event, g) => {
        armed.current = false;
        granted.current = false;
        latest.current.onEnd(g.dx, g.dy);
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        granted.current = false;
        latest.current.onCancel();
      },
    })
  ).current;

  return (
    <View
      {...pan.panHandlers}
      accessibilityHint={label}
      style={[style, Platform.OS === "web" && (webDragStyle as ViewStyle)]}
      onTouchStart={(event) => {
        if (!latest.current.enabled) return;
        origin.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        clearTimer();
        timer.current = setTimeout(() => {
          armed.current = true;
          latest.current.onStart();
        }, LONG_PRESS_MS);
      }}
      onTouchMove={(event) => {
        if (armed.current || !timer.current) return;
        const moved = Math.hypot(
          event.nativeEvent.pageX - origin.current.x,
          event.nativeEvent.pageY - origin.current.y
        );
        if (moved > SLOP) clearTimer();
      }}
      onTouchEnd={() => {
        clearTimer();
        // Held but never moved: the responder never started, so end the drag here.
        if (armed.current && !granted.current) {
          armed.current = false;
          latest.current.onCancel();
        }
      }}
      onTouchCancel={() => {
        clearTimer();
        if (armed.current && !granted.current) {
          armed.current = false;
          latest.current.onCancel();
        }
      }}
    >
      {children}
    </View>
  );
}

// Web only: no text selection while dragging, a grab cursor.
const webDragStyle = { userSelect: "none", cursor: "grab", touchAction: "none" } as object;

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  flex: { flex: 1 },
  top: { gap: spacing.s2, paddingHorizontal: spacing.s4, paddingTop: spacing.s3 },
  actions: { flexDirection: "row", gap: spacing.s3 },
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabs: { gap: spacing.s2, paddingHorizontal: spacing.s4, paddingVertical: spacing.s3 },
  tab: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  tabText: { fontSize: 17, fontWeight: "600", color: colors.ink700 },
  tabTextOn: { color: colors.white },
  tabTools: {
    flexDirection: "row",
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s2,
  },
  round: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tilesScroll: { flex: 1, minHeight: 0 },
  tilesContent: { marginHorizontal: spacing.s4, paddingBottom: spacing.s4 },
  slot: { position: "absolute" },
  dragging: { zIndex: 10, elevation: 8, opacity: 0.9, transform: [{ scale: 1.04 }] },
  dimmed: { opacity: 0.45 },
  tileTools: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 36,
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomLeftRadius: radius.control,
    borderBottomRightRadius: radius.control,
  },
  mini: {
    minHeight: 32,
    minWidth: 36,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
});
