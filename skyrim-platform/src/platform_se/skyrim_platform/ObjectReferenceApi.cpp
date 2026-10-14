#include "ObjectReferenceApi.h"

#include "NullPointerException.h"

namespace {
RE::TESObjectREFR* GetArgObjectReference(const Napi::Value& arg)
{
  auto formId = NapiHelper::ExtractUInt32(arg, "refrFormId");
  auto refr = RE::TESForm::LookupByID<RE::TESObjectREFR>(formId);

  if (!refr) {
    throw NullPointerException("refr");
  }

  return refr;
}
}

Napi::Value ObjectReferenceApi::SetCollision(const Napi::CallbackInfo& info)
{
  auto refr = GetArgObjectReference(info[0]);
  refr->SetCollision(NapiHelper::ExtractBoolean(info[1], "collision"));
  return info.Env().Undefined();
}

Napi::Value ObjectReferenceApi::GetReferenceAliasQuests(
  const Napi::CallbackInfo& info)
{
  auto refr = GetArgObjectReference(info[0]);
  auto result = Napi::Array::New(info.Env());
  auto aliases = refr->extraList.GetByType<RE::ExtraAliasInstanceArray>();
  if (!aliases) {
    return result;
  }
  RE::BSReadLockGuard lock(aliases->lock);
  for (auto data : aliases->aliases) {
    if (data && data->quest) {
      result.Set(result.Length(),
                 Napi::Number::New(info.Env(), data->quest->GetFormID()));
    }
  }
  return result;
}

Napi::Value ObjectReferenceApi::GetQuestAliasReference(
  const Napi::CallbackInfo& info)
{
  auto questId = NapiHelper::ExtractUInt32(info[0], "questFormId");
  auto aliasId = NapiHelper::ExtractUInt32(info[1], "aliasId");
  auto quest = RE::TESForm::LookupByID<RE::TESQuest>(questId);
  if (!quest) {
    throw NullPointerException("quest");
  }
  RE::BSReadLockGuard lock(quest->aliasAccessLock);
  auto it = quest->refAliasMap.find(aliasId);
  auto refr = it != quest->refAliasMap.end() ? it->second.get() : nullptr;
  return Napi::Number::New(info.Env(), refr ? refr->GetFormID() : 0);
}

Napi::Value ObjectReferenceApi::GetInventoryReferences(
  const Napi::CallbackInfo& info)
{
  auto refr = GetArgObjectReference(info[0]);
  auto result = Napi::Array::New(info.Env());
  auto changes = refr->GetInventoryChanges(true);
  if (!changes || !changes->entryList) {
    return result;
  }
  for (auto entry : *changes->entryList) {
    if (!entry || !entry->extraLists) {
      continue;
    }
    for (auto extraList : *entry->extraLists) {
      auto handle =
        extraList ? extraList->GetByType<RE::ExtraReferenceHandle>() : nullptr;
      auto item = handle ? handle->containerRef.get() : nullptr;
      if (item) {
        auto link = Napi::Object::New(info.Env());
        link.Set("ref", Napi::Number::New(info.Env(), item->GetFormID()));
        link.Set("baseId",
                 Napi::Number::New(info.Env(), entry->object
                                     ? entry->object->GetFormID()
                                     : 0));
        result.Set(result.Length(), link);
      }
    }
  }
  return result;
}

Napi::Value ObjectReferenceApi::GetRunningQuests(const Napi::CallbackInfo& info)
{
  auto result = Napi::Array::New(info.Env());
  auto dataHandler = RE::TESDataHandler::GetSingleton();
  if (!dataHandler) {
    return result;
  }
  for (auto quest : dataHandler->GetFormArray<RE::TESQuest>()) {
    if (quest && quest->IsEnabled()) {
      auto entry = Napi::Array::New(info.Env(), 2);
      entry.Set(0u, Napi::Number::New(info.Env(), quest->GetFormID()));
      entry.Set(1u, Napi::Number::New(info.Env(), quest->GetCurrentStageID()));
      result.Set(result.Length(), entry);
    }
  }
  return result;
}
