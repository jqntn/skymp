#include "HostOwnerBinding.h"
#include "NapiHelper.h"

Napi::Value HostOwnerBinding::Get(Napi::Env env, ScampServer& scampServer,
                                  uint32_t formId)
{
  auto& hostOwners = scampServer.GetPartOne()->worldState.hostOwners;
  auto it = hostOwners.find(formId);
  return Napi::Number::New(env, it == hostOwners.end() ? 0 : it->second);
}

void HostOwnerBinding::Set(Napi::Env env, ScampServer& scampServer,
                           uint32_t formId, Napi::Value newValue)
{
  auto owner = NapiHelper::ExtractUInt32(newValue, "newValue");
  auto& hostOwners = scampServer.GetPartOne()->worldState.hostOwners;
  if (owner) {
    hostOwners[formId] = owner;
  } else {
    hostOwners.erase(formId);
  }
}
