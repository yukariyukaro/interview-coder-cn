// Windows implementation: WH_KEYBOARD_LL.
//
// The hook is installed on the calling thread (Electron's main process main thread,
// which pumps a message loop). Returning 1 from the callback swallows the event
// before it is delivered to the focused window.
#ifdef _WIN32

#include <windows.h>

#include <atomic>

#include "hook.h"
#include "state.h"

namespace {

HHOOK g_hook = nullptr;
HookTriggerFn g_trigger;
std::atomic<unsigned long long> g_last_event_tick{0};

unsigned long long NowTicks() { return GetTickCount64(); }

void NotifyEvent() { g_last_event_tick.store(NowTicks()); }

LRESULT CALLBACK LowLevelKeyboardProc(int code, WPARAM wparam, LPARAM lparam) {
  if (code != HC_ACTION) return CallNextHookEx(g_hook, code, wparam, lparam);

  const KBDLLHOOKSTRUCT* info = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lparam);
  const bool isKeyDown = wparam == WM_KEYDOWN || wparam == WM_SYSKEYDOWN;

  // Never touch our own synthetic events
  if ((info->flags & LLKHF_INJECTED) != 0) {
    NotifyEvent();
    return CallNextHookEx(g_hook, code, wparam, lparam);
  }

  NotifyEvent();

  const int vk = static_cast<int>(info->vkCode);
  bool swallow = false;
  if (isKeyDown) {
    const hook_state::KeyDownResult result = hook_state::HandleKeyDown(vk);
    swallow = result.swallow;
    if (!result.id.empty() && g_trigger) g_trigger(result.id);
  } else {
    swallow = hook_state::HandleKeyUp(vk);
  }

  if (swallow) return 1;
  return CallNextHookEx(g_hook, code, wparam, lparam);
}

}  // namespace

bool HookSupported() { return true; }

bool HookInstall() {
  if (g_hook != nullptr) return true;

  hook_state::SetModifierKeys({0x10, 0xA0, 0xA1}, {0x11, 0xA2, 0xA3}, {0x12, 0xA4, 0xA5},
                              {0x5B, 0x5C});

  g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
  if (g_hook == nullptr) return false;
  g_last_event_tick.store(NowTicks());
  return true;
}

void HookUninstall() {
  if (g_hook == nullptr) return;
  UnhookWindowsHookEx(g_hook);
  g_hook = nullptr;
}

bool HookIsInstalled() { return g_hook != nullptr; }

void HookSetBindings(const std::vector<HookBinding>& bindings) {
  hook_state::SetBindings(bindings);
}

void HookSetTrigger(HookTriggerFn fn) { g_trigger = std::move(fn); }

HookHealth HookGetHealth() {
  HookHealth health{};
  const unsigned long long last = g_last_event_tick.load();
  const unsigned long long now = NowTicks();
  health.hook_silent_ms = last == 0 ? 0.0 : static_cast<double>(now - last);

  LASTINPUTINFO last_input{};
  last_input.cbSize = sizeof(LASTINPUTINFO);
  if (GetLastInputInfo(&last_input)) {
    health.system_idle_ms = static_cast<double>(now - last_input.dwTime);
  } else {
    health.system_idle_ms = health.hook_silent_ms;
  }
  return health;
}

#endif  // _WIN32
