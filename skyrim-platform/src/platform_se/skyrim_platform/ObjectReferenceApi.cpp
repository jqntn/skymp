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
