#include "DevApi.h"
#include "CallNativeApi.h"
#include "FileUtils.h"
#include "InvalidArgumentException.h"
#include "NullPointerException.h"
#include "PapyrusTESModPlatform.h"
#include "Settings.h"
#include "Validators.h"
#include <set>

DevApi::NativeExportsMap DevApi::nativeExportsMap;

extern CallNativeApi::NativeCallRequirements g_nativeCallRequirements;

namespace {
bool CreateDirectoryRecursive(const std::string& dirName, std::error_code& err)
{
  err.clear();
  if (!std::filesystem::create_directories(dirName, err)) {
    if (std::filesystem::exists(dirName)) {
      // The folder already exists:
      err.clear();
      return true;
    }
    return false;
  }
  return true;
}
}

Napi::Value DevApi::Require(
  const Napi::CallbackInfo& info,
  const std::vector<std::filesystem::path>& pluginLoadDirectories)
{
  auto fileName = NapiHelper::ExtractString(info[0], "fileName");

  if (!ValidateRelativePath(fileName)) {
    throw InvalidArgumentException("fileName", fileName);
  }

  for (const std::filesystem::path& dir : pluginLoadDirectories) {
    std::filesystem::path filePath = dir / (fileName + ".js");

    if (!std::filesystem::exists(filePath)) {
      continue; // Throws in the end of the function if nothing found
    }

    std::ifstream t(filePath);
    if (!t.is_open()) {
      throw std::runtime_error("Failed to open '" + filePath.string() +
                               "' for reading");
    }

    std::stringstream src;
    src << t.rdbuf();

    auto runScriptResult =
      JsEngine::GetSingleton()->RunScript(info.Env(), src.str(), fileName);
    auto exports =
      NapiHelper::ExtractObject(runScriptResult, "runScriptResult");

    if (auto& f = DevApi::nativeExportsMap[fileName]) {
      exports = f(exports);
    }

    return exports;
  }

  throw std::runtime_error("'" + fileName + "' doesn't exist");
}

Napi::Value DevApi::AddNativeExports(const Napi::CallbackInfo& info)
{
  auto fileName = NapiHelper::ExtractString(info[0], "fileName");
  auto exports = NapiHelper::ExtractObject(info[1], "exports");

  for (auto& [moduleName, f] : DevApi::nativeExportsMap) {
    if (moduleName == fileName ||
        std::filesystem::path(fileName).filename().string() == moduleName)
      exports = f(exports);
  }

  return exports;
}

namespace {
std::filesystem::path GetPluginPath(const std::string& pluginName,
                                    std::optional<std::string> folderOverride)
{
  if (!ValidateFilename(pluginName, /*allowDots*/ false)) {
    throw InvalidArgumentException("pluginName", pluginName);
  }

  // Folder override is alowed to be not in list of plugin folders
  // In this case it will be writable, but SkyrimPlatform will not monitor and
  // load plugins from it.
  if (folderOverride) {
    if (!ValidateFilename(folderOverride->data(), /*allowDots*/ false)) {
      throw InvalidArgumentException("folderOverride", *folderOverride);
    }

    return std::filesystem::path("Data/Platform") / *folderOverride /
      (pluginName + ".js");
  }

  auto pluginFolders = Settings::GetPlatformSettings()->GetPluginFolders();

  if (!pluginFolders) {
    throw NullPointerException("pluginFolders");
  }

  if (pluginFolders->empty()) {
    throw std::runtime_error("No plugin folders found");
  }

  auto folder = pluginFolders->front();

  return folder / (pluginName + ".js");
}
}

Napi::Value DevApi::GetPluginSourceCode(const Napi::CallbackInfo& info)
{
  // Multifile plugins unsupported
  auto pluginName = NapiHelper::ExtractString(info[0], "fileName");

  std::optional<std::string> overrideFolder;
  if (info.Length() >= 2) {
    auto overrideFolderCandidate = info[1];
    if (!overrideFolderCandidate.IsNull() &&
        !overrideFolderCandidate.IsUndefined()) {
      overrideFolder =
        NapiHelper::ExtractString(overrideFolderCandidate, "overrideFolder");
    }
  }

  return Napi::String::New(
    info.Env(),
    Viet::ReadFileIntoString(GetPluginPath(pluginName, overrideFolder)));
}

Napi::Value DevApi::WritePlugin(const Napi::CallbackInfo& info)
{
  // Multifile plugins unsupported
  auto pluginName = NapiHelper::ExtractString(info[0], "pluginName");
  auto newSources = NapiHelper::ExtractString(info[1], "newSources");

  std::optional<std::string> overrideFolder;
  if (info.Length() >= 3) {
    auto overrideFolderCandidate = info[2];
    if (!overrideFolderCandidate.IsNull() &&
        !overrideFolderCandidate.IsUndefined()) {
      overrideFolder =
        NapiHelper::ExtractString(overrideFolderCandidate, "overrideFolder");
    }
  }

  auto path = GetPluginPath(pluginName, overrideFolder);

  std::error_code err;
  CreateDirectoryRecursive(path.parent_path().string(), err);
  if (err) {
    throw std::runtime_error("Failed to create directory " +
                             path.parent_path().string() + ": " +
                             err.message());
  }

  std::ofstream f(path);
  f << newSources;
  f.close();
  if (!f) {
    throw std::runtime_error("Failed to write into " + path.string());
  }
  return info.Env().Undefined();
}

Napi::Value DevApi::GetPlatformVersion(const Napi::CallbackInfo& info)
{
  constexpr auto kSkyrimPlatformVersion = "2.9.0";
  return Napi::String::New(info.Env(), kSkyrimPlatformVersion);
}

Napi::Value DevApi::GetJsMemoryUsage(const Napi::CallbackInfo& info)
{
  return Napi::Number::New(info.Env(),
                           JsEngine::GetSingleton()->GetMemoryUsage());
}

Napi::Value DevApi::BlockPapyrusEvents(const Napi::CallbackInfo& info)
{
  bool block = NapiHelper::ExtractBoolean(info[0], "block");
  TESModPlatform::BlockPapyrusEvents(nullptr, -1, nullptr, block);
  return info.Env().Undefined();
}

Napi::Value DevApi::AllowQuestPapyrusEvents(const Napi::CallbackInfo& info)
{
  bool allow = NapiHelper::ExtractBoolean(info[0], "allow");
  TESModPlatform::AllowQuestPapyrusEvents(allow);
  return info.Env().Undefined();
}

Napi::Value DevApi::SetPapyrusEventsAllowedForms(
  const Napi::CallbackInfo& info)
{
  auto formIds = NapiHelper::ExtractArray(info[0], "formIds");
  std::vector<uint32_t> ids;
  ids.reserve(formIds.Length());
  for (uint32_t i = 0; i < formIds.Length(); ++i) {
    ids.push_back(NapiHelper::ExtractUInt32(formIds.Get(i), "formIds[i]"));
  }
  TESModPlatform::SetPapyrusEventsAllowedForms(ids);
  return info.Env().Undefined();
}

Napi::Value DevApi::GetPapyrusEventsAllowedForms(
  const Napi::CallbackInfo& info)
{
  auto result = Napi::Array::New(info.Env());
  for (auto formId : TESModPlatform::GetPapyrusEventsAllowedForms()) {
    result.Set(result.Length(), Napi::Number::New(info.Env(), formId));
  }
  return result;
}

Napi::Value DevApi::UpdateAnimations(const Napi::CallbackInfo& info)
{
  std::set<uint32_t> driven;
  if (info.Length() > 0 && !info[0].IsUndefined()) {
    auto formIds = NapiHelper::ExtractArray(info[0], "drivenFormIds");
    for (uint32_t i = 0; i < formIds.Length(); ++i) {
      driven.insert(
        NapiHelper::ExtractUInt32(formIds.Get(i), "drivenFormIds[i]"));
    }
  }
  g_nativeCallRequirements.gameThrQ->AddTask([driven](Viet::Void) {
    auto processLists = RE::ProcessLists::GetSingleton();
    if (!processLists) {
      return;
    }
    float delta = RE::GetSecondsSinceLastFrame();
    processLists->ForAllActors([delta, &driven](RE::Actor* actor) {
      if (actor && !actor->IsPlayerRef() && actor->Is3DLoaded() &&
          !actor->IsAIEnabled()) {
        RE::BSTSmartPointer<RE::BSAnimationGraphManager> manager;
        std::vector<RE::BSTSmartPointer<RE::BSAnimationGraphChannel>> detached;
        if (driven.count(actor->GetFormID()) &&
            actor->GetAnimationGraphManager(manager) && manager) {
          auto& channels = manager->boundChannels;
          for (uint32_t i = 0; i < channels.size();) {
            const char* name =
              channels[i] ? channels[i]->channelName.c_str() : "";
            if (!_stricmp(name, "speed") || !_stricmp(name, "Direction")) {
              detached.push_back(channels[i]);
              channels.erase(channels.begin() + i);
            } else {
              ++i;
            }
          }
        }
        actor->UpdateAnimation(delta);
        for (auto& channel : detached) {
          manager->boundChannels.push_back(channel);
        }
      }
      return RE::BSContainer::ForEachResult::kContinue;
    });
  });
  return info.Env().Undefined();
}

Napi::Value DevApi::IsAnimationGraphReady(const Napi::CallbackInfo& info)
{
  auto formId = NapiHelper::ExtractUInt32(info[0], "formId");
  auto actor = RE::TESForm::LookupByID<RE::Actor>(formId);
  RE::BSTSmartPointer<RE::BSAnimationGraphManager> manager;
  if (!actor || !actor->GetAnimationGraphManager(manager) || !manager) {
    return Napi::Boolean::New(info.Env(), false);
  }
  RE::BSSpinLockGuard guard{ manager->GetRuntimeData().updateLock };
  auto active = manager->GetRuntimeData().activeGraph;
  auto graph = active < manager->graphs.size() ? manager->graphs[active].get()
                                               : nullptr;
  return Napi::Boolean::New(info.Env(),
                            graph && graph->behaviorGraph &&
                              graph->behaviorGraph->rootGenerator.get());
}

Napi::Value DevApi::GetSubtitles(const Napi::CallbackInfo& info)
{
  auto result = Napi::Array::New(info.Env());
  auto manager = RE::SubtitleManager::GetSingleton();
  if (!manager) {
    return result;
  }
  RE::BSSpinLockGuard guard{ manager->lock };
  for (auto& subtitle : manager->subtitles) {
    auto speaker = subtitle.speaker.get();
    auto obj = Napi::Object::New(info.Env());
    obj.Set("speakerId",
            Napi::Number::New(info.Env(), speaker ? speaker->GetFormID() : 0));
    obj.Set("text", Napi::String::New(info.Env(), subtitle.subtitle.c_str()));
    result.Set(result.Length(), obj);
  }
  return result;
}

Napi::Value DevApi::GetDialogueTopic(const Napi::CallbackInfo& info)
{
  uintptr_t id = 0;
  std::string text;
  if (auto manager = RE::MenuTopicManager::GetSingleton()) {
    REX::W32::EnterCriticalSection(&manager->criticalSection);
    if (auto dialogue = manager->lastSelectedDialogue) {
      id = reinterpret_cast<uintptr_t>(dialogue);
      text = dialogue->topicText.c_str();
    }
    REX::W32::LeaveCriticalSection(&manager->criticalSection);
  }
  auto result = Napi::Object::New(info.Env());
  result.Set("id", Napi::Number::New(info.Env(), static_cast<double>(id)));
  result.Set("text", Napi::String::New(info.Env(), text));
  return result;
}

Napi::Value DevApi::SpeakSound(const Napi::CallbackInfo& info)
{
  auto formId = NapiHelper::ExtractUInt32(info[0], "formId");
  auto voiceFile = NapiHelper::ExtractString(info[1], "voiceFile");
  g_nativeCallRequirements.gameThrQ->AddTask([formId, voiceFile](Viet::Void) {
    auto actor = RE::TESForm::LookupByID<RE::Actor>(formId);
    if (!actor) {
      return;
    }
    using func_t = bool (*)(RE::Actor*, const char*, uint32_t*, uint32_t,
                            uint32_t, uint32_t, uint64_t, uint64_t, uint64_t,
                            bool, uint64_t, bool, bool, bool);
    REL::Relocation<func_t> speak{ Offsets::Hooks::SpeakSound.address() };
    uint32_t handle[3]{ 0xFFFFFFFF, 0, 0 };
    speak(actor, voiceFile.data(), handle, 0, 0x32, 0, 0, 0, 0, false, 0,
          false, true, true);
  });
  return info.Env().Undefined();
}

namespace {
class WrapperScreenShotEventHandler : public RE::MenuEventHandler
{
public:
  WrapperScreenShotEventHandler(RE::MenuEventHandler* originalHandler_)
    : originalHandler(originalHandler_)
  {
  }

  bool CanProcess(RE::InputEvent* e) override
  {
    if (e->eventType == RE::INPUT_EVENT_TYPE::kButton) {
      if (strcmp(e->QUserEvent().c_str(), "Screenshot") == 0) {
        return originalHandler->CanProcess(e);
      }
    }

    return false;
  }
  bool ProcessKinect(RE::KinectEvent* e) override { return false; }
  bool ProcessThumbstick(RE::ThumbstickEvent* e) override { return false; }
  bool ProcessMouseMove(RE::MouseMoveEvent* e) override { return false; }
  bool ProcessButton(RE::ButtonEvent* e) override
  {
    if (strcmp(e->QUserEvent().c_str(), "Screenshot") == 0) {
      return originalHandler->ProcessButton(e);
    }

    return false;
  }

  RE::MenuEventHandler* originalHandler;
};
}

void DevApi::DisableCtrlPrtScnHotkey()
{
  auto mc = RE::MenuControls::GetSingleton();

  RE::MenuEventHandler* originalHandler =
    (RE::MenuEventHandler*)mc->screenshotHandler.get();
  RE::MenuEventHandler* handler =
    (RE::MenuEventHandler*)new WrapperScreenShotEventHandler(originalHandler);

  mc->RemoveHandler(originalHandler);
  mc->AddHandler(handler);
}
