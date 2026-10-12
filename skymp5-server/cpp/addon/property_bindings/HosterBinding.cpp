#include "HosterBinding.h"

Napi::Value HosterBinding::Get(Napi::Env env, ScampServer& scampServer,
                               uint32_t formId)
{
  auto& hosters = scampServer.GetPartOne()->worldState.hosters;
  auto it = hosters.find(formId);
  return Napi::Number::New(env, it == hosters.end() ? 0 : it->second);
}
