// Shared state machine: it decides, per key event, whether to swallow the event.
//
// Swallowing rule: a sacrificial prefix is always swallowed, and while any prefix is
// held every further key is swallowed too, so the focused window sees nothing at all
// — no orphan modifier press that a page could observe. A normal modifier that was
// pressed before the prefix keeps leaking (its keydown already reached the window);
// in that case its keyup leaks as well, so no orphan keyup is created either.
#pragma once

#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "hook.h"

namespace hook_state {

// The macOS tap runs on its own thread, so bindings and state are guarded.
inline std::mutex g_mutex;

inline std::vector<HookBinding> g_bindings;
inline std::set<int> g_prefixes;
inline std::set<int> g_plain_modifiers;
inline std::set<int> g_swallowed_keys;  // keydown swallowed -> swallow its keyup
inline std::set<int> g_pressed_modifiers;
inline std::set<int> g_pressed_prefixes;

inline std::set<int> g_shift_keys;
inline std::set<int> g_ctrl_keys;
inline std::set<int> g_alt_keys;
inline std::set<int> g_meta_keys;

inline void SetModifierKeys(const std::set<int>& shift,
                            const std::set<int>& ctrl,
                            const std::set<int>& alt,
                            const std::set<int>& meta) {
  g_shift_keys = shift;
  g_ctrl_keys = ctrl;
  g_alt_keys = alt;
  g_meta_keys = meta;
  g_plain_modifiers.clear();
  g_plain_modifiers.insert(g_shift_keys.begin(), g_shift_keys.end());
  g_plain_modifiers.insert(g_ctrl_keys.begin(), g_ctrl_keys.end());
  g_plain_modifiers.insert(g_alt_keys.begin(), g_alt_keys.end());
  g_plain_modifiers.insert(g_meta_keys.begin(), g_meta_keys.end());
}

inline bool IsPrefix(int vk) { return g_prefixes.count(vk) > 0; }

inline bool IsPlainModifier(int vk) { return g_plain_modifiers.count(vk) > 0; }

inline bool AnyPressed(const std::set<int>& keys) {
  for (int key : keys) {
    if (g_pressed_modifiers.count(key) > 0) return true;
  }
  return false;
}

inline void SetBindings(const std::vector<HookBinding>& bindings) {
  const std::lock_guard<std::mutex> lock(g_mutex);
  g_bindings = bindings;
  g_prefixes.clear();
  for (const HookBinding& binding : g_bindings) {
    g_prefixes.insert(binding.prefix_vk);
  }
  g_swallowed_keys.clear();
  g_pressed_modifiers.clear();
  g_pressed_prefixes.clear();
}

inline const HookBinding* Match(int vk) {
  for (const HookBinding& binding : g_bindings) {
    if (binding.final_vk != vk) continue;
    if (g_pressed_prefixes.count(binding.prefix_vk) == 0) continue;
    if (binding.shift != AnyPressed(g_shift_keys)) continue;
    if (binding.ctrl != AnyPressed(g_ctrl_keys)) continue;
    if (binding.alt != AnyPressed(g_alt_keys)) continue;
    if (binding.meta != AnyPressed(g_meta_keys)) continue;
    return &binding;
  }
  return nullptr;
}

struct KeyDownResult {
  std::string id;
  bool swallow;
};

// Decides what to do with a keydown.
inline KeyDownResult HandleKeyDown(int vk) {
  const std::lock_guard<std::mutex> lock(g_mutex);

  if (IsPrefix(vk)) {
    g_pressed_prefixes.insert(vk);
    g_swallowed_keys.insert(vk);
    return {"", true};
  }

  const bool isModifier = IsPlainModifier(vk);
  if (!isModifier && g_pressed_prefixes.empty()) {
    return {"", false};
  }
  if (isModifier) {
    g_pressed_modifiers.insert(vk);
  }

  if (g_pressed_prefixes.empty()) return {"", false};

  std::string id;
  if (!isModifier) {
    const HookBinding* binding = Match(vk);
    if (binding != nullptr) id = binding->id;
  }
  g_swallowed_keys.insert(vk);
  return {id, true};
}

// Returns true when the keyup must be swallowed.
inline bool HandleKeyUp(int vk) {
  const std::lock_guard<std::mutex> lock(g_mutex);
  if (IsPlainModifier(vk)) {
    g_pressed_modifiers.erase(vk);
  }
  if (IsPrefix(vk)) {
    g_pressed_prefixes.erase(vk);
  }
  return g_swallowed_keys.erase(vk) > 0;
}

}  // namespace hook_state
