#include "PapyrusQuest.h"
#include "script_objects/EspmGameObject.h"
#include "spdlog/spdlog.h"

VarValue PapyrusQuest::GetStage(VarValue self,
                                const std::vector<VarValue>& arguments)
{
  return GetCurrentStageID(self, arguments);
}

VarValue PapyrusQuest::GetCurrentStageID(
  VarValue self, const std::vector<VarValue>& arguments)
{
  static std::once_flag g_flag;

  std::call_once(g_flag, [&] {
    espm::CompressedFieldsCache cache;

    const auto& quest = GetRecordPtr(self);
    const char* editorId =
      quest.rec ? quest.rec->GetEditorId(cache) : "<null>";

    spdlog::warn(
      "GetCurrentStageID - Not implemented, returning 0 (quest was {})",
      editorId ? editorId : "<null>");
    spdlog::warn("GetCurrentStageID - Won't output further warnings due to "
                 "performance reasons");
  });

  return VarValue(0);
}

VarValue PapyrusQuest::IsRunning(VarValue self,
                                 const std::vector<VarValue>& arguments)
{
  return ExecuteSpSnippetAndGetPromise(
    GetName(), "IsRunning", compatibilityPolicy, self, arguments, true,
    SpSnippetMode::kReturnResult, VarValue(false));
}

VarValue PapyrusQuest::SetStage(VarValue self,
                                const std::vector<VarValue>& arguments)
{
  return ExecuteSpSnippetAndGetPromise(
    GetName(), "SetCurrentStageID", compatibilityPolicy, self, arguments,
    true,
    SpSnippetMode::kReturnResult, VarValue(false));
}

void PapyrusQuest::Register(
  VirtualMachine& vm, std::shared_ptr<IPapyrusCompatibilityPolicy> policy)
{
  compatibilityPolicy = policy;

  AddMethod(vm, "GetStage", &PapyrusQuest::GetStage);
  AddMethod(vm, "GetCurrentStageID", &PapyrusQuest::GetCurrentStageID);
  AddMethod(vm, "IsRunning", &PapyrusQuest::IsRunning);
  AddMethod(vm, "SetStage", &PapyrusQuest::SetStage);
}
