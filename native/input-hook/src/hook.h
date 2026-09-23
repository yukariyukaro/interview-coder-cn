// Platform-neutral interface implemented by hook_win.cc / hook_mac.mm.
//
// The state machine lives here rather than in JavaScript because macOS CGEventTap
// callbacks must decide synchronously on the tap thread, where calling into JS is
// not allowed. Bindings are pushed in as plain numbers; the ids are opaque to C++.
#pragma once

#include <functional>
#include <string>
#include <vector>

struct HookBinding {
  std::string id;
  int prefix_vk;
  int final_vk;
  bool shift;
  bool ctrl;
  bool alt;
  bool meta;
};

struct HookHealth {
  double hook_silent_ms;
  double system_idle_ms;
};

using HookTriggerFn = std::function<void(const std::string& id)>;

bool HookSupported();
bool HookInstall();
void HookUninstall();
bool HookIsInstalled();
void HookSetBindings(const std::vector<HookBinding>& bindings);
void HookSetTrigger(HookTriggerFn fn);
HookHealth HookGetHealth();
