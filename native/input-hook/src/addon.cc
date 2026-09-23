// N-API glue: exposes the platform hook to Node/Electron.
#include <napi.h>

#include <string>
#include <vector>

#include "hook.h"

namespace {

Napi::ThreadSafeFunction g_trigger;

std::vector<HookBinding> ParseBindings(const Napi::Value& config) {
  std::vector<HookBinding> bindings;
  if (!config.IsObject()) return bindings;

  const Napi::Value list = config.As<Napi::Object>().Get("bindings");
  if (!list.IsArray()) return bindings;

  const Napi::Array array = list.As<Napi::Array>();
  bindings.reserve(array.Length());
  for (uint32_t index = 0; index < array.Length(); index += 1) {
    const Napi::Value entry = array.Get(index);
    if (!entry.IsObject()) continue;
    const Napi::Object item = entry.As<Napi::Object>();

    HookBinding binding;
    binding.id = item.Get("id").As<Napi::String>().Utf8Value();
    binding.prefix_vk = item.Get("prefixVk").As<Napi::Number>().Int32Value();
    binding.final_vk = item.Get("finalVk").As<Napi::Number>().Int32Value();
    binding.shift = item.Get("shift").ToBoolean().Value();
    binding.ctrl = item.Get("ctrl").ToBoolean().Value();
    binding.alt = item.Get("alt").ToBoolean().Value();
    binding.meta = item.Get("meta").ToBoolean().Value();
    bindings.push_back(binding);
  }
  return bindings;
}

void TriggerFromHook(const std::string& id) {
  if (!g_trigger) return;
  g_trigger.NonBlockingCall([id](Napi::Env env, Napi::Function callback) {
    callback.Call({Napi::String::New(env, id)});
  });
}

Napi::Value Install(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() > 0) HookSetBindings(ParseBindings(info[0]));
  HookSetTrigger(TriggerFromHook);
  return Napi::Boolean::New(env, HookInstall());
}

Napi::Value UpdateBindings(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() > 0) HookSetBindings(ParseBindings(info[0]));
  return env.Undefined();
}

Napi::Value Uninstall(const Napi::CallbackInfo& info) {
  HookUninstall();
  if (g_trigger) {
    g_trigger.Release();
    g_trigger = Napi::ThreadSafeFunction();
  }
  return info.Env().Undefined();
}

Napi::Value IsInstalled(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), HookIsInstalled());
}

Napi::Value IsSupported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), HookSupported());
}

Napi::Value GetHealth(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const HookHealth health = HookGetHealth();
  Napi::Object result = Napi::Object::New(env);
  result.Set("hookSilentMs", Napi::Number::New(env, health.hook_silent_ms));
  result.Set("systemIdleMs", Napi::Number::New(env, health.system_idle_ms));
  return result;
}

Napi::Value SetTriggerHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_trigger) {
    g_trigger.Release();
    g_trigger = Napi::ThreadSafeFunction();
  }
  if (info.Length() > 0 && info[0].IsFunction()) {
    g_trigger = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "hook-trigger", 0,
                                              1);
  }
  return env.Undefined();
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("install", Napi::Function::New(env, Install));
  exports.Set("updateBindings", Napi::Function::New(env, UpdateBindings));
  exports.Set("uninstall", Napi::Function::New(env, Uninstall));
  exports.Set("isInstalled", Napi::Function::New(env, IsInstalled));
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("getHealth", Napi::Function::New(env, GetHealth));
  exports.Set("setTriggerHandler", Napi::Function::New(env, SetTriggerHandler));
  return exports;
}

}  // namespace

NODE_API_MODULE(input_hook, Initialize)
