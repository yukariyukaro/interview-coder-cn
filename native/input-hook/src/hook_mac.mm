// macOS implementation: a CGEventTap that deletes the events it swallows.
//
// The tap runs on its own thread with a dedicated run loop so it can never be stalled
// by the Electron main thread, and it decides synchronously — which is exactly why
// the state machine lives in C++ instead of being called back into JavaScript.
#ifdef __APPLE__

#include <ApplicationServices/ApplicationServices.h>

#include <atomic>
#include <chrono>
#include <set>
#include <thread>

#include "hook.h"
#include "state.h"

namespace {

CFMachPortRef g_tap = nullptr;
CFRunLoopSourceRef g_source = nullptr;
CFRunLoopRef g_run_loop = nullptr;
std::thread g_thread;
HookTriggerFn g_trigger;
std::atomic<unsigned long long> g_last_event_ms{0};
std::atomic<bool> g_tap_started{false};
std::set<CGKeyCode> g_pressed_keys;

double NowMs() { return CFAbsoluteTimeGetCurrent() * 1000.0; }

void NotifyEvent() { g_last_event_ms.store(static_cast<unsigned long long>(NowMs())); }

CGEventRef TapCallback(CGEventTapProxy /*proxy*/, CGEventType type, CGEventRef event,
                       void* /*user*/) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    // The system disabled us (a slow callback, a permission change, ...). Re-enable
    // instead of silently going deaf.
    if (g_tap != nullptr) CGEventTapEnable(g_tap, true);
    return event;
  }

  const CGKeyCode keycode = static_cast<CGKeyCode>(
      CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));

  NotifyEvent();

  switch (type) {
    case kCGEventKeyDown: {
      const hook_state::KeyDownResult result = hook_state::HandleKeyDown(keycode);
      if (!result.id.empty() && g_trigger) g_trigger(result.id);
      if (result.swallow) return nullptr;
      return event;
    }
    case kCGEventKeyUp: {
      if (hook_state::HandleKeyUp(keycode)) return nullptr;
      return event;
    }
    case kCGEventFlagsChanged: {
      const bool goingDown = g_pressed_keys.count(keycode) == 0;
      if (goingDown) {
        g_pressed_keys.insert(keycode);
        const hook_state::KeyDownResult result = hook_state::HandleKeyDown(keycode);
        if (!result.id.empty() && g_trigger) g_trigger(result.id);
        if (result.swallow) return nullptr;
      } else {
        g_pressed_keys.erase(keycode);
        if (hook_state::HandleKeyUp(keycode)) return nullptr;
      }
      return event;
    }
    default:
      return event;
  }
}

void RunTap() {
  const CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) |
                           CGEventMaskBit(kCGEventFlagsChanged);
  g_tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault,
                           mask, TapCallback, nullptr);
  g_tap_started.store(true);
  if (g_tap == nullptr) {
    return;
  }

  g_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
  g_run_loop = CFRunLoopGetCurrent();
  CFRunLoopAddSource(g_run_loop, g_source, kCFRunLoopCommonModes);
  CGEventTapEnable(g_tap, true);
  NotifyEvent();
  CFRunLoopRun();
}

}  // namespace

bool HookSupported() { return true; }

bool HookInstall() {
  if (g_tap != nullptr) return true;
  if (!AXIsProcessTrusted()) {
    // Accessibility / Input Monitoring has not been granted yet; prompt once.
    const void* keys[] = {kAXTrustedCheckOptionPrompt};
    const void* values[] = {kCFBooleanTrue};
    CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
                                                 &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
    AXIsProcessTrustedWithOptions(options);
    CFRelease(options);
    return false;
  }

  // Shift / Control / Option / Command, both sides
  hook_state::SetModifierKeys({0x38, 0x3C}, {0x3B, 0x3E}, {0x3A, 0x3D}, {0x37, 0x36});

  g_thread = std::thread(RunTap);
  // Wait briefly for the tap to come up so install() can report a real result
  for (int attempt = 0; attempt < 50 && !g_tap_started.load(); ++attempt) {
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return g_tap != nullptr;
}

void HookUninstall() {
  if (g_run_loop != nullptr) {
    CFRunLoopStop(g_run_loop);
  }
  if (g_thread.joinable()) g_thread.join();
  if (g_source != nullptr) {
    CFRelease(g_source);
    g_source = nullptr;
  }
  if (g_tap != nullptr) {
    CFRelease(g_tap);
    g_tap = nullptr;
  }
  g_run_loop = nullptr;
  g_pressed_keys.clear();
}

bool HookIsInstalled() { return g_tap != nullptr; }

void HookSetBindings(const std::vector<HookBinding>& bindings) {
  hook_state::SetBindings(bindings);
}

void HookSetTrigger(HookTriggerFn fn) { g_trigger = std::move(fn); }

HookHealth HookGetHealth() {
  HookHealth health{};
  const unsigned long long last = g_last_event_ms.load();
  const double now = NowMs();
  health.hook_silent_ms = last == 0 ? 0.0 : now - static_cast<double>(last);
  health.system_idle_ms =
      CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState,
                                            kCGAnyInputEventType) *
      1000.0;
  return health;
}

#endif  // __APPLE__
