/**
 * Void sale and stock-adjustment both gate on this before writing anything.
 * The two platforms take genuinely different code paths -- web never
 * reaches Alert.alert at all, because react-native-web's Alert.alert is a
 * documented no-op (`static alert() {}`): it would silently do nothing,
 * not even show a browser dialog. These pin both paths directly, not
 * through a mock of this module, so a change that quietly breaks the
 * native branch (wrong button order, wrong resolved value, a missing
 * Cancel) fails here instead of only showing up on a real device.
 */
import { Alert, Platform } from "react-native";

import { confirmDestructive } from "../src/lib/confirmDestructive";

const originalOS = Platform.OS;
// jest-expo's test environment is Node, not jsdom: `window` exists (RN's
// own setup aliases it to `global`) but carries none of a real browser's
// methods, so there is no existing window.confirm to jest.spyOn -- it has
// to be installed before each web test and removed after, same as any
// other DOM API this environment doesn't provide out of the box.
afterEach(() => {
  Platform.OS = originalOS;
  delete (window as unknown as { confirm?: unknown }).confirm;
  jest.restoreAllMocks();
});

describe("confirmDestructive on web", () => {
  beforeEach(() => {
    Platform.OS = "web";
  });

  it("asks window.confirm with the title and message, and resolves true on OK", async () => {
    const confirmSpy = jest.fn().mockReturnValue(true);
    (window as unknown as { confirm: typeof confirmSpy }).confirm = confirmSpy;

    const result = await confirmDestructive(
      "Void this sale?",
      "14.50 DH will be reversed.",
      "Void",
      "Cancel"
    );

    expect(confirmSpy).toHaveBeenCalledWith("Void this sale?\n\n14.50 DH will be reversed.");
    expect(result).toBe(true);
  });

  it("resolves false when the browser dialog is cancelled", async () => {
    (window as unknown as { confirm: () => boolean }).confirm = jest.fn().mockReturnValue(false);

    const result = await confirmDestructive(
      "Void this sale?",
      "14.50 DH will be reversed.",
      "Void",
      "Cancel"
    );

    expect(result).toBe(false);
  });

  it("never calls Alert.alert on web -- it is a no-op there and would silently do nothing", async () => {
    (window as unknown as { confirm: () => boolean }).confirm = jest.fn().mockReturnValue(true);
    const alertSpy = jest.spyOn(Alert, "alert");

    await confirmDestructive("Title", "Message", "Confirm", "Cancel");

    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe.each(["ios", "android"] as const)("confirmDestructive on native (%s)", (os) => {
  beforeEach(() => {
    Platform.OS = os;
  });

  it("shows Alert.alert with the title, message, and Cancel before Confirm", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      // Simulate the person tapping the confirm button.
      buttons?.[1]?.onPress?.();
    });

    const result = await confirmDestructive(
      "Void this sale?",
      "14.50 DH will be reversed.",
      "Void",
      "Cancel"
    );

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Void this sale?");
    expect(message).toBe("14.50 DH will be reversed.");
    expect(buttons).toHaveLength(2);
    expect(buttons?.[0]).toMatchObject({ text: "Cancel", style: "cancel" });
    expect(buttons?.[1]).toMatchObject({ text: "Void", style: "destructive" });
    expect(result).toBe(true);
  });

  it("passes no options, so Android keeps its own cancelable:false default", async () => {
    // RN's Alert.alert defaults { cancelable: false } on Android when no
    // 4th argument is given -- the dialog can't be dismissed by the back
    // button or an outside tap without a button press, so the Promise
    // this wraps is guaranteed to resolve either way. Passing an explicit
    // `cancelable: true` here (even meaning well, e.g. for a back-button
    // escape) would reopen a hole where that Promise never resolves.
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());

    await confirmDestructive("Title", "Message", "Confirm", "Cancel");

    expect(alertSpy.mock.calls[0]).toHaveLength(3);
  });

  it("resolves false when Cancel is pressed, and never writes", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      buttons?.[0]?.onPress?.();
    });

    const result = await confirmDestructive(
      "Void this sale?",
      "14.50 DH will be reversed.",
      "Void",
      "Cancel"
    );

    expect(result).toBe(false);
  });

  it("never calls window.confirm on native", async () => {
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
    const confirmSpy = jest.fn();
    (window as unknown as { confirm: typeof confirmSpy }).confirm = confirmSpy;

    await confirmDestructive("Title", "Message", "Confirm", "Cancel");

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
